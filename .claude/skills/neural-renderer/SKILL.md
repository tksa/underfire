---
name: neural-renderer
description: Work on the Neural Renderer pipeline that turns Under Fire's low-poly render into a realistic WW2 frame (in-game multi-channel exporter, dataset generation, Pix2PixHD/SPADE training, ONNX/TensorRT inference). Use when someone asks about the AI renderer, G-buffer/mask export, training data, or making the game look photorealistic.
---

# Neural Renderer pipeline

Treat this as **conditional image-to-image / semantic-to-image**, not text-to-image.
The game owns layout-true conditioning (unit positions, classes, teams, terrain,
depth), so a small model trained on little data can work. Full design:
`docs/neural-renderer/README.md`.

## The pieces
- **In-game exporter** (`js/neural_export.js`, `Game.NeuralExport`): renders, for
  the current camera, aligned channels: `rgb`, `depth`, `unit` (type mask),
  `team`, `id` (instance), `terrain` (ground-class + structures). UI is hidden so
  it can't bleed in. `captureFrameData({height})` returns data URLs;
  `downloadFrame(name)` saves PNGs + meta.
- **Dataset generator** (`neural/capture_dataset.mjs`): Playwright script that
  roams the camera and saves many input frames.
- **Packer** (`neural/pack_dataset.py`): builds Pix2PixHD `train_A`/`train_B`.
- **Train/export/infer** (`neural/train_poc.sh`, `export_onnx.py`, `infer.py`).

## Common tasks
- **Add a channel** to the exporter: add a render pass in `captureFrameData`
  (use `withUnitColors` for per-unit colour, `withOverride` for terrain/props,
  or `scene.overrideMaterial` for a whole-scene buffer like depth). Keep UI hidden.
- **Improve a mask**: edit the palettes at the top of `js/neural_export.js`
  (`TEAM_COLORS`, `CLASS_COLORS`, `TERRAIN_MASK_COLORS`).
- **More dataset variety**: extend the camera-roam / scene-randomisation in
  `capture_dataset.mjs` (vary units, weather, time of day).
- **Targets**: the missing ingredient is realistic target images that preserve
  layout. Use a teacher renderer or AI img2img (FLUX/SDXL+ControlNet); never let
  targets move units or change the camera.

## Rules
- The exporter is game-side JS (no build step). The `neural/` toolchain is
  offline Python/Node and must never be required to run the game.
- Do not run FLUX/SDXL as the in-game renderer; they are teachers only.
- Verify exporter changes with the `run-and-test` skill: call
  `Game.NeuralExport.captureFrameData()` after starting a mission and confirm
  every channel is a non-trivial PNG aligned to the RGB view.

## Test
```js
const d = Game.NeuralExport.captureFrameData({ height: 360 });
// expect d.rgb/d.depth/d.unit/d.team/d.id/d.terrain to be data:image/png and d.meta.units.length > 0
```
