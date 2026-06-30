# CLAUDE.md — working on Under Fire with Claude

This file orients an AI coding assistant (Claude Code, claude.ai/code, etc.) to this repository. If you are Claude: read this first, then the relevant file in the map below. There are task-specific skills in `.claude/skills/` for the common jobs.

Under Fire is a free, community-built World War II real-time tactics game, built in the open with AI assistance. It runs in the browser with **no build step**.

## Run it

```bash
python3 -m http.server 8741   # then open http://localhost:8741
```

Edit a file in `js/`, refresh, see the change. See the `run-and-test` skill for the headless smoke test.

## Golden rules (do not break these)

1. **No build step.** Plain HTML/CSS/JS. Do not add bundlers, transpilers, or a runtime npm dependency. ESM deps (Three.js r180 + addons, postprocessing, ez-tree, fflate) are **vendored locally in `/vendor`** and wired via the importmap in `index.html`. (They used to load from CDNs, but intermittent CDN 404s broke the fatal top-level imports in `main.js` and the game wouldn't boot, so they're now served from the same origin — still no build step.) Exception: the Draco decoder still loads from a CDN at runtime (`js/engine.js`), used only for Draco-compressed models.
2. **Assets are CC0 / public-domain only.** Every bundled model/texture/sound must be CC0 and listed in `CREDITS.md`. Never add ripped or unlicensed assets.
3. **Don't rename the `Game` global** (the whole codebase hangs off `window.Game`) or the `underFire` unit property (different thing from the game name "Under Fire").
4. **Keep it degradable.** Prefer procedural defaults so the game still runs if an optional asset is missing.
5. **Match the surrounding style.** 4-space indent, small functions on `Game`, comment the *why*. Avoid em dashes in UI copy.
6. **Cite a source** in the PR when changing a stat for realism.

## Architecture map

Everything is attached to the global `Game` object (`js/config.js`). Files load as classic scripts from `index.html`; `js/main.js` is the ES-module entry that boots the game.

| File | Responsibility |
|------|----------------|
| `js/config.js` | `Game` namespace, constants, shared state |
| `js/utils.js` | Math/grid helpers (`rand`, `clamp`, `dist`, `getTile`, LOS) |
| `js/engine.js` | Three.js scene, camera, lighting, fog, loaders |
| `js/terrain.js` | Map gen, heightmap, terrain mesh, buildings, props |
| `js/units.js` | `UNIT_STATS` baseline, `makeUnit`, unit meshes, model loading; **data-driven roster loader** (`loadUnitsCSV`/`applyUnitsCSV`, `unitsForYear`) that merges `data/units.csv` over the baseline |
| `js/weapons.js` | `WEAPONS` table (range, damage, penetration, suppression) |
| `js/combat.js` | `applyShot`, damage/penetration model, hit effects |
| `js/ai.js` | Per-unit FSM + squad coordination + threat propagation |
| `js/pathfinding.js` | A* over the tile grid |
| `js/camera.js` | Pan / zoom / follow |
| `js/input.js` | Mouse + keyboard, selection, orders |
| `js/renderer.js` | Per-frame mesh sync, tracers, smoke, animation, minimap, HUD |
| `js/audio.js` | Pooled SFX, ambient loops, voice barks (`Game.Audio`) |
| `js/mission.js` | Scenario: spawns, objective, win/lose, reinforcements |
| `js/unit_modules.js` | The per-unit update loop (`Game.uMod`): `frame · morale · health · supply · deploy · scan · bombard · engage · fire · move`, plus the `Game.updateUnit` orchestrator. (Was the monolithic `updateUnit` in `main.js`.) |
| `js/main.js` | Boot, game loop, fog of war, menu → game start, supply/towing/mines/deploy helpers (`updateUnit` now lives in `unit_modules.js`) |

## Data

| Path | What |
|------|------|
| `data/units.csv` | Editable unit roster (~614 units incl. the full RWM library). Merged over the `UNIT_STATS` baseline at boot. Each unit has a `year` for per-map era gating (`Game.unitsForYear`). See `data/README.md`. |
| `data/changelog.json` | Generated from git (`scripts/gen-changelog.mjs`) for the menu's "Latest Updates". |
| `docs/reference/rwm/` | Public-domain RWM (Sudden Strike) logic/asset reference + mechanics-code RE. |

## Where to add things → use a skill

- New unit (infantry/support/vehicle) → `.claude/skills/add-unit`
- Terrain, scenery, fields, props, map features → `.claude/skills/add-scenery`
- Sound effects / ambient loops → `.claude/skills/add-sound`
- New mission / scenario → `.claude/skills/new-scenario`
- Run locally + verify a change → `.claude/skills/run-and-test`

## Conventions for new code

- New file in `js/`? Add its basename to the **inline script loader array** in `index.html` (the `classic = [...]` list), in dependency order, before `main.js`. (The loader appends a per-load `?v=` cache-buster — that's why deploys are picked up immediately. No `<script>` tags by hand.)
- New tile type? Update `Game.TILE_COLORS` and `Game.makeTile` in `js/terrain.js` **and** the minimap palette in `js/renderer.js`.
- New unit? Prefer **adding a row to `data/units.csv`** (key `"{team}_{kind}"`, e.g. `french_hmg`; reference a `Game.WEAPONS` key or synthesize one via the `w_*` columns; set a `year`). The `UNIT_STATS` table in `js/units.js` is the built-in fallback. See `data/README.md`.
- New per-unit behavior? Add/extend a module in `js/unit_modules.js` (`Game.uMod.*`) rather than growing `updateUnit`.
- Refresh the menu's "Latest Updates" before deploy: `node scripts/gen-changelog.mjs`.
- Test before you finish: run the game, watch the console, and run `node scripts/smoke-test.mjs` if you can.

See `CONTRIBUTING.md` for the human-facing version and the PR workflow, and `vision.md` for direction.
