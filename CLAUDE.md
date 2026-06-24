# CLAUDE.md — working on Under Fire with Claude

This file orients an AI coding assistant (Claude Code, claude.ai/code, etc.) to this repository. If you are Claude: read this first, then the relevant file in the map below. There are task-specific skills in `.claude/skills/` for the common jobs.

Under Fire is a free, community-built World War II real-time tactics game, built in the open with AI assistance. It runs in the browser with **no build step**.

## Run it

```bash
python3 -m http.server 8741   # then open http://localhost:8741
```

Edit a file in `js/`, refresh, see the change. See the `run-and-test` skill for the headless smoke test.

## Golden rules (do not break these)

1. **No build step.** Plain HTML/CSS/JS. Do not add bundlers, transpilers, or a runtime npm dependency. Three.js loads from a pinned CDN importmap in `index.html`.
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
| `js/units.js` | `UNIT_STATS`, `makeUnit`, unit meshes, model loading |
| `js/weapons.js` | `WEAPONS` table (range, damage, penetration, suppression) |
| `js/combat.js` | `applyShot`, damage/penetration model, hit effects |
| `js/ai.js` | Per-unit FSM + squad coordination + threat propagation |
| `js/pathfinding.js` | A* over the tile grid |
| `js/camera.js` | Pan / zoom / follow |
| `js/input.js` | Mouse + keyboard, selection, orders |
| `js/renderer.js` | Per-frame mesh sync, tracers, smoke, animation, minimap, HUD |
| `js/audio.js` | Pooled SFX, ambient loops, voice barks (`Game.Audio`) |
| `js/mission.js` | Scenario: spawns, objective, win/lose, reinforcements |
| `js/main.js` | Boot, game loop, fog of war, menu → game start |

## Where to add things → use a skill

- New unit (infantry/support/vehicle) → `.claude/skills/add-unit`
- Terrain, scenery, fields, props, map features → `.claude/skills/add-scenery`
- Sound effects / ambient loops → `.claude/skills/add-sound`
- New mission / scenario → `.claude/skills/new-scenario`
- Run locally + verify a change → `.claude/skills/run-and-test`

## Conventions for new code

- New file in `js/`? Add a `<script>` tag to `index.html` in dependency order (after `config.js`/`utils.js`, before `main.js`).
- New tile type? Update `Game.TILE_COLORS` and `Game.makeTile` in `js/terrain.js` **and** the minimap palette in `js/renderer.js`.
- New unit? Key `Game.UNIT_STATS` as `"{team}_{kind}"` (e.g. `french_hmg`) and make sure its `weapon` exists in `Game.WEAPONS`.
- Test before you finish: run the game, watch the console, and run `node scripts/smoke-test.mjs` if you can.

See `CONTRIBUTING.md` for the human-facing version and the PR workflow, and `vision.md` for direction.
