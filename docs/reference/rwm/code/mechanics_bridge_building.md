# Mechanic deep-dive: bridge building (pontoon) & repair

How bridges work in the engine, assembled from data params + code location +
disassembly. Two distinct mechanics: **building a pontoon bridge** over water, and
**repairing a damaged bridge/rail**.

## Data layer (per-unit params)

A unit that can build pontoons (a `gruz` supply/engineer truck) carries:
| Field | Meaning |
|---|---|
| `anibuildpont` | animation played while building |
| `pontbuildcost` | resource cost per pontoon segment |
| `pontbuildtime` | time per segment |
| `idlesnd_buildpont` | looping build sound |
| `AIF_HOLDFIRE` (on `AI_GRUZ_RELOAD`) | flag that makes a supply truck **build pontoon bridges** under AI |

Repairing existing structures (engineer):
| Field | Meaning |
|---|---|
| `fixmost` / `fixmostcost` / `anifixmost` / `idlesnd_fixmost` | repair a **bridge** ("most") |
| `fixrail` / `fixrailcost` / `fixrailtime` / `fixrailradius` / `anifixrail` | repair **railway** |

The finished bridge is a dynamic terrain object handled by `land/land_pont.cpp`
(see `desc_explosion`/`land_descdata` for how it can be destroyed).

## Code layer

| Item | Value |
|---|---|
| Build function | **`0x10024B01`** in `n2Game_Dll.dll` |
| Source file | `units/unit_gruz/unit_gruz_buidpont.cpp` |
| Pontoon object | `land/land_pont.cpp`, referenced at `0x1007483A` |
| Command dispatch | `unit_gruz_commands.cpp` (`0x100F87F0`) |
| AI driver | `unit_gruz_AI.cpp` (`0x100F91E0`) |

Full disassembly: `disasm/excerpt_buidpont_0x10024b01.asm` (and the complete
`disasm/n2Game_Dll.asm`).

## Annotated disassembly (function entry, `0x10024B01`)

```asm
10024b01: push ebp                      ; ebp = caller-supplied target cell/point
10024b02: push 0x1
10024b04: mov  ecx, edi                 ; ecx = this (the gruz unit object)
10024b06: call 0x10033280              ; helper (set state / begin action)
10024b0b: jmp  0x10024c71              ; -> common exit

; --- bounds asserts (file=unit_gruz_buidpont.cpp, line 30) ---
10024b10: push 0x1e                     ; line 30
10024b12: push 0x100f87b4              ; "...unit_gruz_buidpont.cpp"
10024b17: push 0xff
10024b1c: call 0x1007acc0             ; assert handler
10024b21: cdq
10024b22: mov  ecx, 0x3
10024b29: idiv ecx                      ; (value)/3   <- iso-rhomb coordinate math
10024b2b: movsx eax, word [edi+0x35]    ; unit field @0x35 (grid Y?)
...
10024b48: add  esp, 0x18
10024b54: add  dx,  word [edi+0x33]     ; unit field @0x33 (grid X?)  -> target cell
10024b58: dec  edx
10024b5e: lea  edx, [esp+0x14]          ; build a {x,y} cell struct on stack
10024b62: push edx
10024b63: push 0x1
10024b65: call 0x10033280              ; place next pontoon segment toward target

; --- state checks ---
10024b6f: mov  al, byte [edi+0xe1]      ; flag @0xE1 (already building?)
10024b75: test al, al
10024b77: je   0x10024b85
10024b7b: call 0x100333a0              ; continue/advance build
...
10024b85: test byte [edi+0x1a], 0x2    ; capability bit @0x1A (can build here?)
10024b89: jne  0x10024c71              ; -> abort if set
10024b8f: movsx ecx, word [ebp]         ; target cell X
10024b93: fld  dword [0x100eb330]       ; const (segment spacing) -> FPU
10024b99: fadd st(0), st                ; *2
10024b9b: mov  ebx, [0x1010f264]        ; global map/view offset X
10024ba1: mov  edx, [0x1010f268]        ; global map/view offset Y
10024ba7: movsx eax, word [edi+0x2b]    ; unit field @0x2B
10024baf: shl  ecx, 0x5                 ; cellX * 32  (cell -> world px, 32px grid)
10024bb2: sub  ecx, ebx                 ; - viewX
10024bbd: shl  eax, 0x5                 ; *32
...                                     ; computes screen/world position of segment
```

## Reconstructed behavior *(inferred from the above)*

1. Order issued (`unit_gruz_commands`) with a **target cell** (the far bank).
2. The build function steps the truck's cursor from its current grid cell
   (fields `@0x33`,`@0x35`) toward the target, **one pontoon segment per tick**;
   the `/3` and `*32` math converts between iso-rhomb cells and the 32px world grid.
3. For each segment it checks a "can build here / is water" capability bit
   (`@0x1A & 2`) and an "already building" flag (`@0xE1`); if OK it spends
   `pontbuildcost`, waits `pontbuildtime`, plays `anibuildpont`, and instantiates a
   `land_pont` segment at the computed world position.
4. When the cursor reaches the far bank the bridge is complete and becomes passable
   terrain; it can later be destroyed (explosion descriptors) or repaired
   (`fixmost`).

## Notes for reuse
- Bridges are **segment-by-segment**, grid-aligned, water-only.
- Unit object fields used: `@0x1A` (capability bits), `@0x2B`/`@0x33`/`@0x35`
  (grid position), `@0xE1` (build-in-progress flag). Constants: spacing at
  `.rdata 0x100EB330`, world grid = 32px/cell.
- To fully recover the formula, single-step `0x10024B01` in a debugger/Ghidra and
  watch `[edi+0x33/0x35]` and the FPU stack.
