# Changelog

All notable changes to Under Fire. Newest first. Versioning is SemVer-ish while pre-1.0 (see `docs/DEPLOYMENT.md`).

The start-mission screen's "Latest Updates" panel is generated from the git commit
log (`scripts/gen-changelog.mjs` → `data/changelog.json`), so it stays current
without hand-editing.

## v0.6.0-dev

- **Data-driven roster:** `data/units.csv` (614 units, incl. the full public-domain RWM/Sudden Strike library) merged over the built-in table at boot. Each unit has an introduction `year`; `Game.unitsForYear` gates per-map availability (a 1940 map won't field the StG-44, Tiger, Panther…).
- **Orders:** Move / Attack-Move stance switch, Attack-Ground, and a double-right-click **Retreat** (break off; infantry sprint, tanks reverse).
- **New systems:** towed-gun deploy/limber (siege), officer morale aura + chain-of-command succession, mine warfare (lay/clear/splash), sapper sandbag emplacements, troop transport and gun towing.
- **Smarter enemy AI:** infantry under fire break for cover, a tree line, or the lee of a friendly tank instead of standing in the open; engagement no longer jitters at the edge of sight (sticky targeting).
- **Refactor:** the monolithic `updateUnit` is split into per-unit modules (`js/unit_modules.js`).
- Always-fresh deploys via a per-load cache-buster on the script loader.

## Unreleased — feature/neural-renderer

- Neural Renderer pipeline (turn the low-poly render into a realistic WW2 frame via conditional image-to-image).
- In-game multi-channel exporter `Game.NeuralExport` (`js/neural_export.js`): aligned rgb / depth / unit-type / team / instance-id / terrain-class buffers, UI hidden. Debug-panel "Export Frame" button.
- Offline toolchain in `neural/` (headless dataset capture, Pix2PixHD packing/training wrappers, ONNX/TensorRT export, inference) and full design docs in `docs/neural-renderer/`.

## v0.5.0-dev — Initial public build

- First public, community-buildable release of Under Fire.
- 3D procedural battlefield: a French village of patchwork hedgerow fields, church, windmill, river and stone bridge.
- Individual-unit tactics: cover, concealment, line-of-sight, suppression, stance (stand/crouch/prone/crawl), armour penetration with facing and obliquity.
- Squad AI: cover-seeking, fire-and-maneuver, and squad-wide threat alerts when a unit is hit.
- Tactical pause, fog of war, procedural effects and audio (CC0 / public-domain).
- New welcome gate, start-mission menu, contributor docs, license, and Claude skills.
