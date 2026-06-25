# Mechanic deep-dive: movement

How units move, from data params + code location + disassembly. Movement is split
into **pathfinding** (route over the iso grid) and per-unit-type **locomotion +
walk/drive animation**.

## Data layer (per-unit params)

| Field | Meaning |
|---|---|
| `movespeed` (two values) | forward speed (normal / ?) |
| `backmovespeed` | reverse speed |
| `crouchmovespeed` | infantry crouched speed |
| `siegespeed` | deploy/dig-in move speed |
| `turnspeed`, `turndelay`, `gunturndelay` | hull / turret rotation |
| `walkonground`, `walkonshallows`, `walkonwater` | terrain passability |
| `marchenabled`, `marchsightbonus` | road-march bonus |
| `soldtomove`, `cannotmove`, `canmovebackward`, `stop`/`stopped` | state gates |
| `groundtrace`/`watertrace`/`doubletrace`, `track` | movement tracks |
| `falldownspeed`/`fallspeed`, `flyspeed` | falling / flying |

## Code layer

| Item | Value |
|---|---|
| Infantry locomotion | source `units/unit_sold/unit_sold_moving.cpp`; asserts `0x10021C15`, `0x10021C8A` |
| Gun locomotion | `units/unit_gun/unit_gun_moving.cpp` (`0x100F89A8`) |
| Rider locomotion | `units/unit_ezd/unit_ezd_moving.cpp` (`0x100F8C88`) |
| Pathfinding | `pathfind/wrapper.cpp`, xref `0x1008F6ED` |

Excerpts: `disasm/excerpt_unit_sold_moving.asm`,
`disasm/excerpt_pathfind_wrapper.asm`.

## Annotated disassembly (infantry move/animation update)

```asm
10021bb7: and  al, 0x3f                 ; facing &= 63  -> 64-step direction
10021bb9: mov  [esi+0xbc], al           ; store facing  (esi = this soldier)
10021bcb: mov  byte [esi+0xec], 0x2     ; movement sub-state = 2 (moving)
10021bd9: or   byte [esi+0x1a], 0x2     ; set MOVING flag (bit1 @0x1A)
10021bdd: test byte [0x1010f2bd], 0x4   ; global setting (animate?) 
10021be4: je   ...                      ; skip anim if off
10021bf8: call 0x1004a5b0              ; sub: advance position by movespeed
; --- per-direction animation frame stepping (loop x8) ---
10021bff: lea  ebx, [esi+0x3d]          ; ebx -> 8x uint16 frame counters
10021c02: mov  ebp, [esi+0x4]           ; ebp -> unit descriptor (anim tables)
10021c07: mov  dx, word [ebx]           ; current frame for this direction
10021c0a: cmp  edx, [edi+ebp+0xcd]      ; vs frame count for this dir
10021c11: jge  ...                      ; clamp
10021c13: push 0x5e                     ; assert line 94 ...
10021c15: push 0x100f8778              ; "...unit_sold_moving.cpp"
10021c1f: call 0x1007acc0
10021c24: imul eax, [edi+ebp+0x295]     ; frame * per-frame-duration
10021c2c: mov  ecx, [ebp+0x301]         ; anim speed / threshold
10021c35: cmp  eax, ecx
10021c39: inc  word [ebx]               ; advance animation frame
10021c42: cmp  edi, 0x8                 ; 8 directions
10021c45: jl   0x10021c02              ; loop
```

## Reconstructed behavior *(inferred)*

1. **Pathfinding** (`pathfind/wrapper.cpp`, `0x1008F6ED`) plans a route of grid
   cells respecting `walkonground/shallows/water` and `ignoremines`.
2. Each tick the unit's `_moving` module:
   - sets facing (`@0xBC`, 64-step), movement sub-state (`@0xEC=2`), and the
     **MOVING flag** (`@0x1A |= 2` - the same object flag word the bridge code
     reads);
   - advances world position by `movespeed` (helper `sub_1004A5B0`);
   - steps the **8-direction walk animation** using per-direction frame counters at
     `@0x3D[8]` against the unit descriptor's frame tables (`+0xCD`, `+0x295`,
     `+0x301`).
3. Stop/halt clears the moving flag and sets the idle state; reverse uses
   `backmovespeed`; crouched infantry uses `crouchmovespeed`.

## Notes for reuse
- Facing is quantized to **64 steps**; walk animation has **8 base directions**.
- Object flag word at **`@0x1A`** carries movement/capability bits (bit1 = moving);
  position/grid in fields `@0x33/@0x35` (see bridge doc).
- World grid = 32px/cell (the `shl x,5` seen across the code).
- To recover exact speed integration, step `sub_1004A5B0` (called at `0x10021BF8`).
