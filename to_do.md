# TO DO / Work in progress

Status file for the terrain + boundaries workstream (last updated 2026-07-03).
All changes below are **uncommitted** on branch `public` and **not deployed**.

## Done this session (working, screenshot-verified, uncommitted)

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
- **Smoke test fix**: welcome-gate force-clicks in `scripts/smoke-test.mjs`.

## Next up (not started / in progress)

1. **Final verification pass**: run `node scripts/smoke-test.mjs` after the
   river change; view `v5_river_west.png` / `v5_river_east.png` (captured, in
   scratchpad) to check the full river length; tune mud bank width
   (`bankW = TT * 0.55` in `_getTerrainPaint`) if the brown strip reads heavy.
2. **Commit decision**: everything above is one coherent feature set; needs a
   commit (or split commits: terrain paint / dividers / camera / bridge /
   river) and `node scripts/gen-changelog.mjs` before deploy.

## Field-boundaries guide implementation (requested, not started)

Guide saved at `docs/reference/french-field-boundaries.md` (user-provided,
2026-07-03). Current divider system already matches parts of it (roads as
boundary magnets, walls near village/yards, short fence segments, open rough
zones left unenclosed, run-level consistency). Concrete gaps to implement, in
suggested order:

- **Scored boundary-type selection** (guide sec. 11): replace the current
  wallP/fence coin flips with additive scores per run (pasture edge, road edge,
  farm/village proximity, wetness = near river, crop protection for
  garden/orchard/vineyard) and a soft weighted pick incl. an explicit
  `open_boundary` outcome. Keep tuning constants at the top of
  `Game._addFieldDividers`.
- **Gates / access gaps** (sec. 15.3, 19.2): every fully-enclosed parcel gets
  at least one 1-tile gap, preferably on the road-facing side; occasional gap
  pieces elsewhere (cart entrances). Currently runs can seal a field shut.
- **Fence length caps** (sec. 14.3): cap fence runs to short segments
  (8-40 m equivalent) and let the rest of the edge go open; fences should
  cluster near the village/farmyards (farm_proximity term).
- **Wall condition states** (sec. 12.4, 18.3): distance-from-village drives
  worn/collapsed runs: random missing pieces, lower bulk scale, maybe a stone
  scatter prop at collapse points. Remote walls rougher, village walls intact.
- **Wetness rule** (sec. 6.3, 16.2): suppress stone walls within ~4 tiles of
  the river; prefer fences (plank/ditch feel) or nothing on wet meadow edges.
- **Corner details** (sec. 19.1): small stone piles (pierriers) at some field
  corners in wall country; a tree or bramble bush at others. Could reuse the
  existing shrub/prop system in `js/terrain.js`.
- **Hedgerows on banks** (sec. 3.4): existing `hedge` tile type is flat; give
  hedge lines a low earth bank in the heightmap pass + denser shrub meshes for
  a bocage read. Bigger job, do last.
- **Document mapping**: add a short "how the guide maps to code" section to
  `docs/reference/french-field-boundaries.md` once implemented.

## Backlog (known, user aware)

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
