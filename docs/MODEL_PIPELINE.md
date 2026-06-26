# Model pipeline — Meshy → Blender (MCP) → game

A repeatable pipeline for turning a prompt into a game-ready unit model, the same
way every time, so we can churn through the many units in `data/units.csv`.

```
prompt ─▶ Meshy (low-poly text-to-3D) ─▶ Blender (MCP refine to the rules) ─▶ models/{team}_{kind}.glb ─▶ game auto-loads
```

The game's model loader (`js/units.js`) already auto-loads `models/{team}_{kind}.glb`
then `models/{kind}.glb`, normalizes/orients/ground-snaps, and wires turret/gun
nodes. The pipeline's job is to make Meshy output **conform to the rules the
loader expects**, so a model just drops in.

## Scope (what gets a model vs stays procedural)

- **Models via this pipeline:** vehicles, towed guns, AA, emplacements, static
  support weapons. These are **static bodies with wired sub-parts** (rotating
  turret, recoiling gun) — exactly what the loader supports, and they need no
  walk cycle.
- **Infantry stay procedural** for now. They animate (walk/crouch/prone/fire) via
  code; a static mesh can't run convincingly, and rigging hundreds of them isn't
  worth it. Rigged infantry is an optional later branch (Meshy/Mixamo rig +
  an engine `AnimationMixer`), tracked separately — not part of the core pipeline.

## Rule 1 — Sizing (proportional, anchored to infantry)

Single source of truth: `Game.SCALE` in `js/config.js`.
- **1 metre = `unitsPerMeter` (1.35) world units**, anchored so a 1.8 m soldier ≈
  2.45 units tall (matches existing infantry). A 3-unit tile ≈ 2.2 m.
- **Vehicles** are multiplied by `vehicleCompression` (0.65) for grid playability;
  infantry/guns are 1:1.
- **Blender exports every model at TRUE METRE scale** (set the real size below).
  The loader then applies one uniform factor — no per-model scale hacks.

Real-world reference dimensions (metres) used by the Blender step:

| Unit | kind | L × W × H (m) | scale by |
|---|---|---|---|
| Infantry | fusilier/grenadier/… | 0.6 × 0.6 × 1.8 | height |
| Hotchkiss H35 | h35 | 4.22 × 1.95 × 2.13 | length |
| Renault R35 | r35 | 4.02 × 1.87 × 2.13 | length |
| Somua S35 | s35 | 5.45 × 2.12 × 2.62 | length |
| Char B1 bis | b1 | 6.52 × 2.50 × 2.79 | length |
| Panhard 178 | panhard | 4.79 × 2.01 × 2.31 | length |
| Panzer I | panzer1 | 4.02 × 2.06 × 1.72 | length |
| Panzer II | panzer2 | 4.81 × 2.28 × 1.99 | length |
| Panzer III | panzer3 | 5.52 × 2.95 × 2.50 | length |
| Panzer IV | panzer4 | 5.92 × 2.88 × 2.68 | length |
| Sd.Kfz. 222 | sdkfz | 4.80 × 1.95 × 2.00 | length |
| 25 mm Hotchkiss AT | at25 | 3.71 × 1.05 × 1.10 | length |
| 47 mm SA 37 | at47 | 4.10 × 1.62 × 1.10 | length |
| Pak 36 | pak36 | 3.40 × 1.65 × 1.17 | length |

(Extend this table per unit as we build them — it lives in the pipeline, not the game.)

## Rule 2 — Orientation & grounding
- **Forward = +Z.** The model must face +Z (the loader auto-rotates +X→+Z, but
  Blender should set it correctly so there's no guessing).
- **Up = +Y**, upright, **bottom at y = 0** (Blender grounds it; the loader also
  ground-snaps as a safety net).
- Origin centered on the footprint (X/Z), at the base (Y).

## Rule 3 — Poly budget & cleanliness
- **Decimate** to a low budget — vehicles ≲ 4–6k tris, guns/infantry ≲ 2–3k —
  these render in quantity.
- Single skinned material with a baked texture; **strip embedded lights/cameras**
  (the loader strips them, Blender should too).
- Triangulated, no n-gons, no loose geometry.

## Rule 4 — Wired sub-parts (so the loader can animate them)
The loader looks up child nodes by name:
- **Turret** → name a node one of: `turret`, `tower`, `turm`, `tourelle`. It will
  be rotated to track the target (origin at the turret ring).
- **Gun / barrel** → name it `gun`, `barrel`, `cannon`, or `kanone`. It gets the
  **recoil** slide (origin at the breech, barrel pointing +Z).
- Infantry: no sub-parts needed.

So a tank must export as a hierarchy: hull (root) → turret (rotates) → gun
(recoils), with correct origins. The Blender step renames/parents these.

## The steps

1. **Meshy** (`scripts/meshy_gen.mjs`-style): low-poly text-to-3D from the prompt
   structure in `meshy/PROMPTS.md` (`target_polycount`, white background; for
   wired units, prompt the turret/gun as distinct shapes). Optional PBR refine for
   texture. Output: a raw `.glb`.
2. **Blender (via MCP)**: run `scripts/blender_refine.py` with the unit's real
   dims + type. It imports, decimates, scales to metres, orients +Z, grounds,
   renames/parents turret/gun nodes, sets recoil origin, strips lights, exports
   `models/{team}_{kind}.glb`.
3. **Game**: loader auto-loads it, applies `Game.SCALE`, wires turret/gun. Verify
   in-engine (size vs infantry, facing, turret tracks, recoil).

## Blender MCP setup (one-time, your machine)

1. Install **Blender 4.x** and **`uv`** (`brew install uv`).
2. Install the **BlenderMCP** addon (github.com/ahujasid/blender-mcp), enable it,
   and in its panel click **Connect**.
3. Add the server to the repo `.mcp.json` (the entry runs `uvx blender-mcp`).

Once connected, the refine step is driven by `scripts/blender_refine.py` through
the MCP — no manual Blender work per unit.
