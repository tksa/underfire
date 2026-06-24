# Changelog

All notable changes to Under Fire. Newest first. Versioning is SemVer-ish while pre-1.0 (see `docs/DEPLOYMENT.md`).

The latest entries are also shown in-game on the start-mission screen (kept in sync with the `UNDER_CHANGELOG` array in `index.html`).

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
