# Model pipeline — Meshy → Blender (MCP) → game

A repeatable pipeline for turning a prompt into a game-ready unit model, the same
way every time, so we can churn through the many units in `data/units.csv`.

```
prompt ─▶ Meshy (low-poly text-to-3D) ─▶ Blender (MCP refine to the rules) ─▶ models/{team}_{kind}.glb ─▶ game auto-loads
```

The game's model loader (`js/units.js`) already auto-loads `models/{team}_{kind}.glb`
then `models/{kind}.glb`, normalizes/orients/ground-snaps, wires turret/gun nodes,
and creates animation actions for named GLB clips. The pipeline's job is to make
an asset **conform to the rules the loader expects**, so a model drops in without
unit-specific scene surgery.

## Scope (what gets a model vs stays procedural)

- **Static models via the Meshy/refine pipeline:** vehicles, towed guns, AA, emplacements, static
  support weapons. These are **static bodies with wired sub-parts** (rotating
  turret, recoiling gun) — exactly what the loader supports, and they need no
  walk cycle.
- **Rigged characters use a separate preservation path.** The shared foot soldier
  and Polish `mounted_ulan` are skinned GLBs driven by an `AnimationMixer`. Never
  send these assets through a static-only refinement pass that removes an armature,
  changes bind transforms, or drops/renames animation clips.
- **Polish mounted cavalry:** the supplied horse-and-rider source has 17 named
  animation clips. Its runtime path is `models/polish_mounted_ulan.glb`; the
  existing `models/soldier.glb` remains the source for dismounted `ulan` infantry.

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
| Horse and rider | mounted_ulan | preserve the supplied source proportions | horizontal footprint |
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
- Rigged locomotion cycles must be authored in place. World translation belongs
  to unit movement; baked root travel would move the render away from its collision
  and selection position.

## Rule 3 — Poly budget & cleanliness
- **Decimate** to a low budget — vehicles ≲ 4–6k tris, guns/infantry ≲ 2–3k —
  these render in quantity.
- Use a small material/texture set; **strip embedded lights/cameras** (the loader
  strips them, Blender should too).
- Triangulated, no n-gons, no loose geometry.
- For animated characters, keep the armature, skin weights, inverse bind matrices,
  clip names, and all required keyframes intact. Optimisation must be checked
  against the rig rather than treated as ordinary static decimation.

## Rule 4 — Wired sub-parts (so the loader can animate them)
The loader looks up child nodes by name:
- **Turret** → name a node one of: `turret`, `tower`, `turm`, `tourelle`. It will
  be rotated to track the target (origin at the turret ring).
- **Gun / barrel** → name it `gun`, `barrel`, `cannon`, or `kanone`. It gets the
  **recoil** slide (origin at the breech, barrel pointing +Z).
- Infantry: no sub-parts needed.

So a tank must export as a hierarchy: hull (root) → turret (rotates) → gun
(recoils), with correct origins. The Blender step renames/parents these.

## Rule 5 — Rigged character and cavalry clips

An animated character ships as one coherent GLB scene containing its skinned
mesh, skeleton, and named animation clips. The loader clones the rig per unit and
builds an action for every exported clip. Preserve the original names instead of
merging the 17 cavalry clips into a single timeline.

The mounted-cavalry controller selects the appropriate actions from the supplied
set and synchronises walk/run playback to measured movement speed. Acceleration,
braking, and turn limits are simulation behavior; animation should follow that
speed rather than provide root motion. The supplied base is one fused skinned
horse-and-rider mesh, but its triangles have clean horse-only or rider-only bone
influences. At dismount completion the runtime clones the already loaded wrapper,
keeps triangles influenced by `Root`, the horse body/neck/head/tail, and the four
horse-leg bones, removes the separate sabre and other rider geometry, and retains
the complete armature so the riderless horse can idle in place without a second
GLB download. The `mounted_ulan` asset is rendered at 85% of its earlier tuning.
The riderless clone retains that exact wrapper transform, so the horse does not
grow or shrink when the rider dismounts; only the foot `ulan` returns to normal
infantry scale. Mount/dismount remains a state transition between those three
presentations. It is not a horse-limber or gun-hitch system, and no animation
should imply an anti-tank cavalry charge.

The Polish 75 mm Armata is a static gun GLB paired at runtime with two
SkeletonUtils clones of the shared soldier rig. Each clone receives the Polish
infantry skin/tint, hides the complete rifle slot, and owns its own mixer so bone
bindings cannot cross between duplicate skeleton names. The source soldier
timeline is split once and the resulting idle/walk/crouch clips are shared; each
crew member then uses the normal speed-synchronised procedural gait. The crew is
guarded by the gun model's async generation and falls back to lightweight
articulated figures if the shared soldier model cannot load.

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

The three steps above describe static equipment. For an already-rigged character
such as the supplied Polish cavalry model, begin with the source GLB in Blender,
preserve its skeleton and all 17 clips, apply only rig-safe orientation/material/
texture optimisation, and export directly to `models/polish_mounted_ulan.glb`.
Do not use `scripts/blender_refine.py` unchanged for this asset: that helper is
written for static meshes and turret/gun hierarchy cleanup, not animation-rig
preservation.

## Blender MCP setup (one-time, your machine)

1. Install **Blender 4.x** and **`uv`** (`brew install uv`).
2. Install the **BlenderMCP** addon (github.com/ahujasid/blender-mcp), enable it,
   and in its panel click **Connect**.
3. Add the server to the repo `.mcp.json` (the entry runs `uvx blender-mcp`).

Once connected, the refine step is driven by `scripts/blender_refine.py` through
the MCP — no manual Blender work per unit.
