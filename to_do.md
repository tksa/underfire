# TO DO / Work in progress

Status file for the terrain + boundaries workstream (last updated 2026-07-03).
Everything up to and including the river/water work is **committed (f2e8f82)
and deployed**. The field-boundaries guide implementation below is
**uncommitted** on branch `public`.

## Done this session (working, screenshot-verified)

Files touched: `js/terrain.js`, `js/camera.js`, `js/renderer.js`, `js/main.js`,
`scripts/smoke-test.mjs`, `CREDITS.md`, `models/dividers/*`, `models/bridge_stone.glb`,
`docs/CODE_REVIEW_2026-07-03.md`, `docs/reference/french-field-boundaries.md`.

- **Terrain realism rework**: per-texel warped field classification, per-field
  tints and crop rows, wavy dark seams between fields, 35% rough / 65%
  straight-ish boundary zoning (`Game._getTerrainPaint`, tunable sliders).
- **Tree varieties**: Scots pine (large + medium, conical EZ-Tree evergreens,
  stand-clustered) and birch (edge-biased in oak woods), with per-species bark.
- **Field dividers**: 4 dry-stone wall variants + wooden farm fence
  (`models/dividers/`, optimized from ~2.5 MB to ~80-120 KB each, CC0, made by
  tksa with ChatGPT + Sam3D). Instanced, tank-crushable (knockdown), infantry
  pass. Per-run single wall variant; per-enclosure light/mid/dark grey tint;
  procedural dark fieldstone texture; 12% piece overlap so no visible joins;
  walls 20% smaller (Y/Z only); fences trimmed into walls at junctions (no gaps,
  no pass-through). ~930 pieces on the default map.
- **Roadside dividers**: walls/fences follow road contours (incl. diagonals) in
  coherent stretches, offset 0.68 tiles, walls favored near the village.
- **Camera**: view yawed 23 degrees right (`Game.camYawDeg`), pan input rotated
  to screen space.
- **Stone bridge model**: `models/bridge_stone.glb` (753 KB, was 10.5 MB)
  replaces the procedural causeway; procedural bridge kept as fallback; ends
  now bedded deep into the banks (sink constant 0.55 in the bridge block).
- **River de-squared + water effect** (just finished, verified in
  `v5_river_bridge.png`): shoreline follows the smooth jittered ribbon mask
  instead of tile rectangles (reclassification in `Game._getTerrainPaint`),
  water removed from the HARD material-map set (sheen now blends by the same
  mask), muddy bank strips meander, and a new animated water surface plane
  (`Game._buildWaterSurface` + `Game.updateWaterFX`) scrolls a tiling ripple
  normal map with depth-tinted translucent color.
- **Smoke test fix**: replaced input clicks with a polled in-page DOM click
  (`domClick` via `page.waitForFunction`) in `scripts/smoke-test.mjs` — on
  software-GL runners the map builds behind the menu and starves the main
  thread, so Playwright input clicks time out (verified via CDP profile; it
  was an environment flake, not a code regression).

## Field-boundaries guide implementation (DONE, uncommitted)

Guide saved at `docs/reference/french-field-boundaries.md`; a "how the guide
maps to code" appendix at the end of that file documents each mechanic. All in
`Game._addFieldDividers` (js/terrain.js), verified in-game 2026-07-03
(70 units, water present, zero errors; v6_*.png screenshots in scratchpad):

- [x] **Scored boundary-type selection** (sec. 11): additive `sWall`/`sFence`/
  `sOpen` scores from farmNear, cropProt, pastureEdge, wet, rough; softmax
  pick (temp 0.55) with an explicit open outcome.
- [x] **Gates / access gaps** (sec. 15.3, 19.2): 1-tile gap in long runs; every
  enclosure guaranteed at least one gate (`st.hasGate`).
- [x] **Fence length caps** (sec. 14.3): runs > 4 tiles capped to 3/5/8/13-tile
  segments, remainder open; fences cluster near farms.
- [x] **Wall condition states** (sec. 12.4, 18.3): farmNear-driven condition;
  worn walls sag (per-piece hMul), drop pieces, spill stones. Village intact,
  remote worn.
- [x] **Wetness rule** (sec. 6.3, 16.2): river-ribbon wetness suppresses walls
  near water (also gates the roadside pass); wet meadows go open or fence.
- [x] **Corner details / pierriers** (sec. 19.1): instanced stone piles at
  collapse points and worn wall ends (`divider-pierrier`).
- [x] **Document mapping**: appendix added to the guide doc.
- [ ] **Hedgerows on banks** (sec. 3.4): hedge tiles still flat; low earth bank
  in the heightmap pass + denser shrub meshes for a bocage read. Bigger job,
  deliberately last. (Terraces sec. 13 and era modifiers sec. 17: out of scope
  for the current lowland-1940 map.)

**Density note**: guide rules (open boundaries + fence caps) thinned dividers
from ~930 to ~570 pieces on the default map. If that reads too sparse (user
previously asked for more walls), raise `sWall`/`sFence` base constants or
lower `sOpen` in the score block.

**Minor river tuning**: ~~squarish notches where the ribbon halfWidth steps
between tile columns~~ — fixed by the profile blur + smoothstep interpolation
in the meander/blend follow-up below.

## River bank realism pass (DONE, uncommitted, 2026-07-03)

User feedback: water level too low, trench-like banks, uniform depth, no stone
wash. Implemented (all screenshot-verified, v7_*.png in scratchpad):

- **Floodplain banks** (`_applyWaterBedDepth` rewrite): meadows ease down to a
  low lip just above the waterline over `WATER_FLOOD_TILES` (2.6) instead of a
  1-unit trench wall; noise-picked minority of banks stays high (undercuts);
  yard/house/wall pads exempt. Bed is now carved to ABSOLUTE depth below
  `WATER_LEVEL` (old base-relative sink left the bed poking above the surface).
- **Pools and riffles**: `Game._waterPool01` along-river noise drives the bed
  carve, water colour and alpha together — riffles shallow/translucent
  (gravel bed shows through), pools deep/dark. Waterline foam fringe in the
  surface bake.
- **Gravel wash bars**: new paint-only `wash` type (`Game._waterWashAt` mask,
  shared by paint, pebble speckle, and instanced cobbles `river-wash-stones`,
  ~130 instances). Bars concentrate on riffle stretches; occasional patches
  reach up the bank ("too high for water, too rocky for grass").
- **Riparian meadow strip**: row crops (wheat/plowed/vineyard/garden/stubble)
  give way to grass on the floodplain strip, wandering width 1.7-3.1 tiles.
- **Varied bank width**: mud strip width wanders (`bankWv` noise).
- Config: `WATER_BED_DEPTH` now = pool depth below waterline (0.55),
  `WATER_BED_EDGE` = shore depth (0.18), new `WATER_FLOOD_TILES` (2.6);
  `WATER_BED_VARIATION` removed (superseded by pool/riffle noise).

### Follow-up: meanders + bank blending (DONE, uncommitted, same day)

User feedback on the pass above: not enough curves, and the bank needed to
blend into the terrain rather than end on a clean painted line. Implemented
(screenshot-verified, v7_*.png; smoke test OK):

- **Meandering course**: river centreline in `generateMap` is now a 4-term
  composition (two long sines + short sine + fbm wobble), envelope rows
  ~63-86, replacing the old 2-sine near-straight course. Spawns (z <= 27)
  unaffected.
- **Ribbon smoothing**: `_waterRibbonProfile` runs a 2-pass [.25 .5 .25] blur
  over per-column centre/halfWidth, and `_waterRibbonAt` interpolates columns
  with smoothstep easing — this also fixes the "squarish notches" item that
  was listed under minor river tuning (now resolved, note removed below).
- **Dithered bank edge**: outer edge of the mud band is per-texel hash-dithered
  over the last half of the band, so mud speckles into grass instead of a
  hard boundary; field seam grooves skip mud/wash texels.
- **Wet-bank gradient**: terrain bake darkens toward wet soil within a
  noise-wandering 1.05-1.9 tile reach above the waterline, strongest at the
  water's edge.

### Follow-up 2: bank variation + riparian vegetation + rolling hills (DONE, uncommitted, same day)

User feedback: bank edges too uniform, needed height variation and natural
trees/bushes; then "more smaller bushes and trees, especially dense bush";
separately "quite a few parts of the terrain are flat, needs some rolling
hills". Implemented (v9_*.png screenshots in scratchpad; smoke test OK):

- **Riparian strip de-uniformed** (`_getTerrainPaint`): grass strip width now
  pinches and bulges (0.8-3.4 tiles, pow-skewed 0.055-freq noise) and the
  outer edge hash-dithers into the crop rows over ~1 tile.
- **Bank height variation** (`_applyWaterBedDepth`): per-location flood width
  (0.55-1.5x) so short steep cut banks alternate with long ramps; waterline
  lip gets a second higher-freq noise term; mid-slope hummocks/hollows
  (t(1-t) envelope keeps the waterline and field join fixed).
- **Riparian scrub, two bands** (hedge-shrub block): dense small bushes right
  at the waterline (feet ~0.06 above WL, 1-2 per sample in strong clumps) +
  looser full-size bushes up the floodplain; clump noise leaves open bank
  stretches; skips bridges/water; registered in `foliageKD` (tank-crushable).
  ~1.2k shrub instances total on the default map (was ~650).
- **Riparian trees**: saplings + small oaks/birches (oaks read as
  willows/alders) dotted in clumps just behind the scrub line. Tuned down
  after first pass read as woodland: keep-prob 0.38, 55% saplings, heights
  capped 2.6 — the dense layer at the river is bush, not canopy.
- **Rolling swell** (`loadHeightmap`): two-frequency fbm undulation
  (wavelengths ~10-25 tiles, amp `Game.TERRAIN_SWELL_AMP` = 0.11 -> +-0.4
  world units) layered over the heavily smoothed base so open farmland rolls
  instead of reading dead flat. Safe: `shapeHeightmap` re-flattens
  roads/buildings afterwards and the river bed is carved to absolute depth.
  Relief over open ground now min 0.25 / max 3.24 / sd 0.52.

## Reference mode + capture (DONE, uncommitted, 2026-07-03/04)

Debug-panel tooling (backtick panel, "Reference" section) for producing
annotated map reference images. Verified via scratchpad `ref-mode.mjs` and
`ref-capture.mjs`; smoke test OK.

- **Reference Mode checkbox** (`Game.setReferenceMode`): hides units, effects,
  fog, trees, bushes, buildings, bridges, menu button and bottom HUD bar;
  keeps terrain, water and walls/fences. Per-frame `Game._refEnforceSweep`
  keeps hiding anything async loaders attach late (bridge/windmill models).
  Exact restore on toggle-off (per-object saved visibility).
- **Markers** (screen-fixed THREE.Points, built from `Game.treeSpots` /
  `shrubSpots` / `damageSpots` captured at map build): purple 5px dot = tree,
  blue 5px dot = bush, red circle = crater (bigger dot = bigger crater), red
  triangle = small shell/round impact. Plus one AREA marker: bright pink
  overlay (`ref-town-overlay`, 0xff69b4, merged tile quads) over
  yard/house/wall tiles = cobbled village ground. (Was yellow; generators
  confused wheat/stubble fields with the marker, so it moved to pink.)
- **Cobbled village ground in the real bake** (terrain.js yard branch):
  yard/house/wall tiles paint grey sett stones on a global jittered grid
  (seamless across tiles, fbm worn patches show dust joints), so towns no
  longer read as grass in-game either.
- **Fallen dividers**: ~18% of wall/fence pieces tipped over at the base and
  tinted red (collapsed = terrain damage). Stable pick per map; re-picks when
  async divider batches register; skips pieces tanks already crushed.
- **Capture** (`Game.startRefCapture(perMap, total)`, inputs + Start/Stop
  button in the panel): asks once for an output folder (Chrome/Edge File
  System Access API), then unattended loop: random camera spot + zoom (16-44),
  render, save JPEG q0.92 named `ref_m<8-hex map hash>_<epoch-ms>_<8-hex>.jpg`
  plus a same-name `.json` sidecar (map hash, camera x/z/zoom/yaw, canvas
  w/h/dpr, and every near-view tree/bush/damage/fallen-wall spot in world AND
  image pixel coords via `Game._refCapMeta`). After every `perMap` images it
  disposes the old map's GPU resources and regenerates a brand-new procedural
  map (waits for divider batches to register before shooting). Game paused
  during capture; canvas-only capture so DOM UI never appears in images.
  Intended for large ML training datasets: the map hash exists so train/val
  splits can go by map (crops of one map are near-duplicates), the sidecar so
  pipelines never have to recover 5px markers from compressed JPEGs.

## Dataset stage 2: realistic-image generation (DONE, uncommitted, 2026-07-04)

`scripts/ref-pipeline.mjs` (no npm deps) + "Generate Realistic" button in the
debug panel. Flow: capture writes reference JPEGs + JSON sidecars to
`dataset/reference/` (pick that folder in the capture dialog); the sidecar
turns each into a same-stem PNG in `dataset/realistic/` via OpenAI
images/edits (prompt in `scripts/ref-prompt.txt`).

- Key handling: `OPENAI_API_KEY` in `.env` (gitignored, chmod 600, deploy is
  tracked-files-only so it can never ship). The key never reaches the browser;
  the debug button talks to the sidecar on 127.0.0.1:8742.
- Sidecar: `node scripts/ref-pipeline.mjs` (server for the button) or
  `--once --limit N` for CLI batches. Concurrency + 429/5xx backoff + skip
  already-generated stems (resume). `--dry` copies inputs for free flow tests.
  `--model/--size/--quality/--fidelity` flags; input_fidelity auto-dropped
  when the model rejects it (gpt-image-2 does, gpt-image-1 accepts high).
  OpenAI's Batch API does not cover images endpoints, so "batch" = concurrent
  + resumable, not the 50% discount.
- Verified end to end: dry run, UI button (headless status updates are just
  slow under software GL; fine on real GPU), and REAL generations with both
  gpt-image-2 and gpt-image-1 + input_fidelity high. User settled on
  gpt-image-2 (the default); fidelity flag stays for experiments.
- **Caveat noted for later**: in the two test generations, full-scene edits
  were photoreal but not pixel-aligned with the input (macro layout drift).
  If training pairs need tighter alignment, try tile-level edits and an
  automated alignment filter (edge IoU / SSIM vs input) before mass runs.
  Test artifacts were removed; dataset/ starts clean.
- Related, pre-existing: `js/neural_export.js` (June) exports per-view
  G-buffers (rgb/depth/unit/team/id/terrain masks) for pix2pix-style
  conditioning — see docs/neural-renderer/README.md.

## Dataset stage 3: patch slicing (DONE, uncommitted, 2026-07-04)

`scripts/slice_patches.py` (Pillow): resizes each reference + realistic pair
to one canonical size (default 1718x915, the generations' native size; same
aspect as captures so uniform scale), crops both with an identical evenly
spaced 512x512 grid (~110px overlap), skips mostly-white off-map patches,
and splits BY MAP HASH (never by crop/image) into train/val/test
input/target folders + manifest.json. First run: 100 pairs (fixed zoom 20,
pink town marker) -> 800 patch pairs, 480/160/160 across 3/1/1 maps, in
~/Documents/render-terrain-patches. User reviews image quality themselves
(do not open/compare dataset images).

## Next up

1. Commit the guide implementation + smoke-test fix (+ this file / guide
   appendix), regen changelog (`node scripts/gen-changelog.mjs`), deploy on
   request (rsync, see memory).

## Backlog (known, user aware)

- **Deselect-at-bottom bug (diagnosed 2026-07-03, fix not yet chosen)**:
  clicks in the bottom 160px HUD bar never reach the game — `#hudBar` itself
  is `pointer-events: none` but `#hudBar > *` re-enables it (index.html) and
  the `.hud-section` divs (flex: 1) fill the whole bar, so even visually
  empty stretches (e.g. the PACE section) swallow the mousedown before
  `#viewport` sees it. Canvas clicks deselect correctly everywhere (verified
  empirically, scratchpad `bug-deselect.mjs`). Fix options: treat clicks on
  HUD dead space as deselect, or make sections click-through except on
  interactive children. Related: edge-pan-down is dead (camera.js overHUD
  suppression at `viewH - 160` covers the entire pan-down zone; input.js
  uses `viewH - 110` — thresholds inconsistent).
- **Bug/perf fixes from the code review** (`docs/CODE_REVIEW_2026-07-03.md`):
  start with the A* pathfinding trio (root cause of BUGS.md #9), then HE splash
  zombie units, garrison teleport/LOS/occupant leak, duplicate keydown
  handlers, immobilized-vehicle glide, CSV NaN/armor wipe; perf items (scan LOS
  ordering, mousemove raycast, HUD innerHTML at 60 Hz, fog allocations, track
  marks unbounded).
- **soldier.glb licence**: confirm author + licence before any public release
  (TODO already in `CREDITS.md`).
- **Village map integration** (`village_map.glb`): parked, do not deploy yet
  (see memory note).

## How to verify visual changes quickly

Playwright scripts from this session live in the session scratchpad
(`bridge-check.mjs`, `river-check.mjs`, `visual-check.mjs`, `road-check.mjs`);
pattern: goto localhost:8741, force-click `#btnEnterGame` then
`#btnStartMission`, fill `Game.fogGrid`/`Game.fogExplored` with 1, set
`Game.cam.x/z` + `zoom`, screenshot. Dev server is the user's own on port 8741,
never kill it.
