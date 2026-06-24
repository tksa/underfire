# Contributing to Under Fire

Welcome to the squad. Under Fire is built in the open by World War II RTS fans, and a lot of it is written with the help of AI coding assistants ("vibe coding"). **You do not need to be a professional developer.** If you can describe what you want and iterate with an AI, you can contribute.

This guide explains how the game is put together, where to add things, and how to get your work merged.

---

## 1. The fastest possible start

```bash
git clone <the repo>
cd under
python3 -m http.server 8741
# open http://localhost:8741
```

Edit a file in `js/`, refresh the browser, see the change. There is **no build step and no install**. That is deliberate — it keeps the barrier to entry low.

If you use an AI assistant (Claude Code, Cursor, etc.), point it at this file and at `vision.md` first so it understands the conventions below.

---

## 2. How the code is organised

Everything hangs off a single global object, `Game` (defined in `js/config.js`). Files are loaded as classic scripts from `index.html`, except `js/main.js`, which is the ES-module entry point that boots the game. To add a new file, drop it in `js/` and add a `<script>` tag in `index.html` in the right order.

| File | What lives here |
|------|-----------------|
| `js/config.js` | The `Game` namespace, global constants, shared state (map size, teams, arrays) |
| `js/utils.js` | Math/grid helpers: `rand`, `clamp`, `lerp`, `dist`, `getTile`, `angleTo`, line-of-sight |
| `js/engine.js` | Three.js scene, camera, lighting, fog, model/texture loaders |
| `js/terrain.js` | Map generation, heightmap, terrain mesh, buildings, props (church, windmill, bridge, fields) |
| `js/units.js` | Unit factory (`makeUnit`), unit meshes, model loading, the infantry rig |
| `js/weapons.js` | Weapon definitions (range, damage, penetration, suppression, accuracy) |
| `js/combat.js` | `applyShot`, the damage/penetration model, hit effects |
| `js/ai.js` | Enemy AI: per-unit state machine + squad coordination (fire-and-maneuver) |
| `js/pathfinding.js` | A* pathfinding over the tile grid |
| `js/camera.js` | Camera panning, zoom, follow |
| `js/input.js` | Mouse and keyboard handling, selection, orders |
| `js/renderer.js` | Per-frame sync of game state to meshes, tracers, smoke, animation, minimap, HUD |
| `js/audio.js` | Pooled sound effects, ambient loops, voice barks |
| `js/mission.js` | Scenario setup: where units spawn, win/lose conditions, reinforcements |
| `js/main.js` | Boot sequence, the game loop, fog of war, menu → game start |

When in doubt, search the repo for a string you can see on screen and work backwards from there.

---

## 3. Where to add the things people most want

### Models
- Drop `.glb` files in `models/`. Loading is wired in `js/units.js` (`_loadUnitModel`) and `js/engine.js` (`loadModel`).
- Models are auto-scaled to the unit's gameplay size, so author at any sane scale. Keep them low-poly (this renders many units at once).
- A rigged model with `idle` / `walk` / `run` / `fire` animation clips will be driven automatically by the animation system in `js/renderer.js`.

### Scenery & terrain
- The map and all props are generated in `js/terrain.js` (`generateMap` and `buildTerrainMeshes`). Fields, hedgerows, the village, church, windmill, haystacks and the bridge are all there as readable functions to copy and extend.
- New tile types: add to `Game.TILE_COLORS`, `Game.makeTile` defaults, and the minimap palette in `js/renderer.js`.

### Textures
- Put them in `textures/`. **CC0 / public-domain only** (see the asset rules below). Reference them by relative path.

### Effects
- Muzzle flashes, smoke, tracers, craters and blasts live in `js/renderer.js` and `js/combat.js`. They are procedural (canvas textures + sprites), so new effects don't need art files.

### Sound
- Add clips under `sounds/` and register them in `js/audio.js`. Keep everything public-domain/CC0.

### Game mechanics & AI
- Combat math: `js/combat.js` and `js/weapons.js`. AI behaviour: `js/ai.js`. Mission scripting: `js/mission.js`.
- Balance and realism are wide open. The vision is historical plausibility — cite a source in your PR when you change a stat.

### New scenarios / maps
- Today there is one scenario. The cleanest contribution path is parameterising `js/mission.js` and `js/terrain.js` so a scenario can define its own spawns and map seed. This is a high-value first project.

---

## 4. Asset rules (please read)

Under Fire ships only assets that are safe for everyone to use and redistribute.

- **CC0 / public-domain only** for art, audio, models, fonts. No ripped game assets, no "found on Google", no AI-generated art trained on a specific artist's work.
- Add every asset to [CREDITS.md](CREDITS.md) with its source and license.
- If you are unsure whether something is allowed, assume it is not and ask in your PR.

This protects the project and every contributor. A great-looking asset we cannot legally ship is worthless to us.

---

## 5. Coding conventions

- Match the surrounding style. 4-space indent, `const`/`let`, small focused functions hung off `Game`.
- Keep it dependency-free and build-free. No npm packages in the runtime path; Three.js comes from the CDN importmap.
- Comment the *why*, not the *what*. Historical or design rationale is especially welcome.
- Don't break the no-asset-needed promise: prefer procedural defaults so the game still runs if an optional asset is missing.

---

## 6. Testing your change

Manual testing is the baseline: run the server, play the scenario, watch the browser console for errors.

For anything non-trivial there is a headless screenshot/inspection harness using `playwright-core` (see `docs/DEPLOYMENT.md` for the pattern). A good PR says what you tested and includes a before/after screenshot for anything visual.

---

## 7. The contribution workflow

1. **Fork** the repository (or create a branch if you have access).
2. Make your change on a **feature branch** named like `feat/german-faction` or `fix/bridge-scale`.
3. Test it. Include screenshots for visual changes.
4. Open a **pull request** against `main` with a clear description and, for balance/realism changes, a source.
5. A maintainer (or the community vote — see `docs/DEPLOYMENT.md`) reviews and merges.

Small, focused PRs get merged fastest. If you are planning something big, open an issue first so we can rally around it.

By contributing you agree your work is released under the project [LICENSE.md](LICENSE.md).

---

## 8. Conduct

Be generous and patient. New contributors and AI-assisted contributors are explicitly welcome here. We are all here because we love this genre and want this game to exist. Keep it friendly.
