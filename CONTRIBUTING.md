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

Everything hangs off a single global object, `Game` (defined in `js/config.js`). Files are loaded as classic scripts from `index.html`, except `js/main.js`, which is the ES-module entry point that boots the game. To add a new file, drop it in `js/` and add its basename to the inline `classic = [...]` loader array in `index.html`, in dependency order, before `main.js` (the loader appends a cache-busting version; do not add `<script>` tags by hand).

If you use Claude Code, `CLAUDE.md` and the task guides in `.claude/skills/` (add-unit, add-scenery, add-sound, new-scenario, run-and-test, neural-renderer) already encode these conventions.

| File | What lives here |
|------|-----------------|
| `js/config.js` | The `Game` namespace, global constants, shared state (map size, teams, arrays) |
| `js/utils.js` | Math/grid helpers: `rand`, `clamp`, `lerp`, `dist`, `getTile`, `angleTo`, line-of-sight |
| `js/engine.js` | Three.js scene, camera, lighting, fog, model/texture loaders |
| `js/terrain.js` | Map generation, heightmap, terrain mesh, buildings, props (church, windmill, bridge, fields) |
| `js/units.js` | Unit factory (`makeUnit`), unit meshes, model loading, the infantry rig |
| `js/weapons.js` | Weapon definitions (range, damage, penetration, suppression, accuracy) |
| `js/combat.js` | `applyShot`, the damage/penetration model, hit effects |
| `js/fire_control.js` | Weapon alignment, aim settling, motion-dependent steadiness and shot events |
| `js/ai.js` | Enemy AI: per-unit state machine + squad coordination (fire-and-maneuver), armor-threat helpers shared with the player side |
| `js/unit_modules.js` | The per-unit update loop (`Game.uMod`: frame, morale, health, supply, deploy, scan, bombard, engage, takeCover, fire, posture, move) and the `updateUnit` orchestrator |
| `js/ai_tactics.js` | Idle / at-ease / guard postures (`Game.uMod.ambient`) |
| `js/pathfinding.js` | A* pathfinding over the tile grid |
| `js/camera.js` | Camera panning, zoom, follow |
| `js/input.js` | Mouse and keyboard handling, selection, orders |
| `js/renderer.js` | Per-frame sync of game state to meshes, tracers, smoke, animation, minimap, HUD |
| `js/audio.js` | Pooled sound effects, ambient loops, voice barks |
| `js/mission.js` | Default scenario (Advance to the Dyle): spawns, objective, win/lose, reinforcements |
| `js/scenarios/mokra.js` | The Mokra: Hold the Railway scenario (authored map, waves, objectives) |
| `js/buildings.js`, `js/garrison_ui.js` | Enterable buildings and the garrison UI |
| `js/soldier_model.js`, `js/fieldgun_model.js`, `js/cavalry_model.js` | Rigged soldier, crewed gun and horse-and-rider model handling |
| `js/gun_model.js` | Original procedural gun carriages, recoil and folding trails |
| `js/weapon_mounts.js` | Geometry/bone muzzle anchors, model aim correction and recoil axes |
| `js/aircraft.js` | Fighters, bombers, air strikes |
| `js/valor.js` | The VALOR finishing post-process pass |
| `js/editor.js`, `js/ruler.js` | In-game map maker and the debug ruler |
| `js/neural_export.js` | G-buffer / mask exporter for the neural-renderer pipeline |
| `data/units.csv` | The editable unit roster, merged over `js/units.js` at boot (see `data/README.md`) |
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

### New units
- Prefer adding a row to `data/units.csv` (key `{team}_{kind}`, a `year` for era gating, a weapon key from `js/weapons.js`). `js/units.js` holds the built-in fallback table. See `data/README.md` and the `add-unit` skill.

### New scenarios / maps
- Two scenarios ship today: Advance to the Dyle (`js/mission.js`) and Mokra (`js/scenarios/mokra.js`, with its map under `maps/mokra/`). Use Mokra as the template for an authored scenario, or the in-game Map Maker (debug panel) to paint a map and export it.

---

## 4. Asset rules (please read)

Under Fire ships only assets that are safe for everyone to use and redistribute.

- **CC0 / public domain is preferred** for art, audio, models, and fonts. Compatible attribution-licensed assets such as CC BY 4.0 may be accepted when their license permits the intended use. No ripped game assets, no "found on Google", and no AI-generated art trained on a specific artist's work.
- Add every asset to [CREDITS.md](CREDITS.md) with its creator, exact source, license, affected files, and any modifications. Keep third-party material clearly excluded from the contribution's Under Fire Community License grant.
- If you are unsure whether something is allowed, assume it is not and ask in your PR.

This protects the project and every contributor. A great-looking asset we cannot legally ship is worthless to us.

---

## 5. Coding conventions

- Match the surrounding style. 4-space indent, `const`/`let`, small focused functions hung off `Game`.
- Keep it dependency-free and build-free. No npm packages in the runtime path; Three.js and the other ES-module libraries are vendored under `/vendor` and wired through the importmap in `index.html`.
- Comment the *why*, not the *what*. Historical or design rationale is especially welcome.
- Don't break the no-asset-needed promise: prefer procedural defaults so the game still runs if an optional asset is missing.

---

## 6. Testing your change

Manual testing is the baseline: run the server, play the scenario, watch the browser console for errors.

There is also a headless regression suite (the same one CI runs) built on Playwright. One-time setup, then run any script against your local server:

```bash
npm install --no-save playwright && npx playwright install chromium
python3 -m http.server 8741 &
node scripts/smoke-test.mjs                 # boots the game, fails on runtime errors
node scripts/tactical-behavior-test.mjs      # weapon handling, infantry paths, low poses, gun crews
node scripts/supporting-fire-test.mjs        # observed friendly fire, small bursts, orders and obstruction
node scripts/infantry-actions-test.mjs       # magazines, interrupted actions, pistols and mortar crews
node scripts/squad-coordination-test.mjs    # bounds, occupied cover, friendly lanes and contact memory
node scripts/infantry-asset-test.mjs         # skin palette, complete clips, safe crossfade scales
node scripts/infantry-locomotion-test.mjs    # move orders, carry poses, gait selection and aim-to-move
node scripts/infantry-visibility-test.mjs    # actual body pixels while running/turning near camera edges
node scripts/model-weapon-audit.mjs --assert # every active ground weapon, muzzle markers and regression report
node scripts/weapon-actors-test.mjs         # aircraft, cavalry aiming and railway artillery mounts
node scripts/tank-approach-test.mjs --assert # infantry / AT-gun behaviour under armor
node scripts/tow-move-test.mjs               # towed guns; see scripts/ for the rest
```

`node --check js/yourfile.js` catches syntax errors before you open the browser. A good PR says what you tested and includes a before/after screenshot for anything visual.

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
