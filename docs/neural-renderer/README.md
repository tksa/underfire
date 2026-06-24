# Under Fire — Neural Renderer Pipeline

Turn the low-poly RTS render into a realistic WW2 frame using a small,
controllable, real-time-capable model. This is **not** a text-to-image problem.
Treat it as **conditional image-to-image / semantic-to-image rendering**:

```
game render + masks + depth  ->  small conditional img2img model  ->  realistic frame  ->  (optional) upscale / temporal stabilize
```

The whole point of the low-poly game is that we own perfect, layout-true
conditioning (unit positions, classes, teams, terrain, depth). That lets a
small model succeed with very little data, where a giant general model would
not preserve the battle.

> Status on this branch: the **in-game data exporter is built and working**.
> The training/inference scripts are scaffolding (see `neural/`). The missing
> ingredient is realistic **target** images, which is the part that needs you
> (see "What we need from you").

---

## Pipeline at a glance

| Stage | Where | Status |
|-------|-------|--------|
| 1. Render abstract frame + G-buffers/masks | `js/neural_export.js` (in-game) | ✅ built |
| 2. Generate a small dataset (input + target pairs) | `neural/capture_dataset.mjs` + target generation | ✅ inputs / ⚠️ targets needed |
| 3. Pack into Pix2PixHD A/B pairs | `neural/pack_dataset.py` | ✅ scaffold |
| 4. Train small model (Pix2PixHD / SPADE) | `neural/train_poc.sh` | ✅ scaffold |
| 5. Export ONNX / TensorRT, run real-time | `neural/export_onnx.py`, `neural/infer.py` | ✅ scaffold |
| 6. Upscale (Real-ESRGAN) + temporal pass | docs below | 📋 planned |

---

## 1. The in-game exporter (built)

`Game.NeuralExport` renders, for the current camera, every conditioning channel
the model needs, all pixel-aligned:

- `rgb` — the normal low-poly render (the "abstract" input)
- `depth` — depth buffer (near = bright)
- `unit` — unit-**type** semantic mask (infantry / support / vehicle / recon)
- `team` — team/faction mask (french / german)
- `id` — per-unit **instance** id mask (unique colour per unit)
- `terrain` — ground-class mask (grass/wheat/road/forest/water/...) + structures

UI (selection rings, health bars, objective ring) is hidden during capture so
the model never learns to hallucinate UI. Render UI **after** the neural pass.

**Try it:** open the debug panel in-game → "Neural Renderer" → *Export Frame
(RGB + masks)*. It downloads 6 PNGs + a `meta.json` (camera + unit list).

**From code / headless:**
```js
const d = Game.NeuralExport.captureFrameData({ height: 540 }); // data URLs
// d.rgb, d.depth, d.unit, d.team, d.id, d.terrain, d.meta
```

## 2. Generating a dataset

Drive the exporter headlessly to produce many input frames quickly:
```bash
cd neural
node capture_dataset.mjs --out ./dataset/raw --count 500 --height 540
```
This roams the camera across the battlefield (varying position, zoom, tilt) and
saves `NNNN_rgb.png`, `NNNN_depth.png`, `NNNN_unit.png`, `NNNN_team.png`,
`NNNN_id.png`, `NNNN_terrain.png`, `NNNN_meta.json` per frame.

### Targets (the realistic B images) — the hard part
Each input frame needs a **realistic target** that preserves the exact layout.
Pick one (best to easiest long-term):

1. **Teacher renderer (best):** a second, asset-rich scene (real WW2 models,
   better textures, smoke/dust, good lighting) rendered from the *same* camera
   and object transforms. Highest fidelity, most work.
2. **AI teacher (fastest):** transform each `rgb.png` with FLUX.1 Kontext /
   SDXL-Turbo img2img / SDXL+ControlNet (depth or the masks as control) using a
   prompt that forbids moving units, changing camera, or adding UI/modern items.
   Curate hard: delete any sample that moves a tank or invents units.
3. **Hybrid (best long-term):** teacher renderer for geometry consistency, then
   light AI style-enhancement on top. Train the fast runtime model on those.

Save the target as `NNNN_target.png` next to the inputs.

See `neural/README.md` for the exact prompt and target-generation notes.

## 3. Pack into training pairs
```bash
python pack_dataset.py --raw ./dataset/raw --out ./dataset --mode falsecolor --size 512 --val 0.1
```
Produces `dataset/train_A`, `train_B`, `val_A`, `val_B`. `--mode falsecolor`
composites terrain + unit masks into a 3-channel semantic control image (A);
`--mode rgb` uses the abstract render as A. B is the realistic target.

## 4. Train (Pix2PixHD POC)
```bash
bash train_poc.sh   # wraps NVIDIA/pix2pixHD
# roughly: python train.py --name ww2_rts_poc --dataroot ./dataset \
#   --label_nc 0 --no_instance --resize_or_crop crop --fineSize 512 --gpu_ids 0
```
Phase plan:

| Phase | Res | Pairs | Steps | Goal |
|-------|-----|-------|-------|------|
| 1 (1 day) | 256–384 | 100–300 | 5k–20k | Validate: units/terrain land in the right place |
| 2 (2–3 days) | 512 | 500–2,000 | 30k–100k | Usable stylized WW2 result |
| 3 | 512+ | 2k–10k | — | Pix2Pix-Turbo / SDXL-Turbo adapter if realism is weak |

## 5. Real-time inference
```bash
python export_onnx.py --weights <ckpt> --out ww2_renderer.onnx   # then build a TensorRT engine
python infer.py --engine ww2_renderer.trt                        # 540p/720p, upscale after
```
Runtime path: game renders control buffers at ~540p → neural model →
Real-ESRGAN / FSR / DLSS upscale → render UI/particles/icons on top.

## 6. Temporal stability (later)
Single-frame first. For video, add `previous_output_warped_by_motion_vectors`
+ current `depth`/`id` as extra inputs to a small refinement model. Fallback:
optical-flow stabilization on the single-frame output.

---

## Model shortlist

| Use | Model | Why |
|-----|-------|-----|
| First POC (real-time) | **Pix2PixHD** | Paired, semantic→image, fast, easy ONNX/TensorRT |
| Stronger semantic control | SPADE / GauGAN | Built for semantic-mask synthesis |
| Better realism, still fast | Pix2Pix-Turbo / Img2Img-Turbo | One-step diffusion img2img |
| Target generation only | FLUX.1 Kontext, SDXL-Turbo, SDXL+ControlNet | High-quality teacher / data bootstrap |
| Real-time diffusion demo | StreamDiffusion / V2 | Interactive, TensorRT paths |
| Upscaling | Real-ESRGAN / FSR / DLSS | Final sharpness/resolution |

Do **not** run FLUX/SDXL as the in-game renderer; use them only as teachers.

### Reference architectures — study these first
This exact problem (game G-buffers + semantic masks -> photorealistic frame) is a
researched field, not new ground:
- **Intel "Enhancing Photorealism Enhancement" (EPE, 2021)** — the canonical
  template: enhances rendered frames using G-buffers + segmentation while
  preserving layout. Read this first; our exporter produces the same inputs.
- **REGEN (2025)** — a modern, real-time *dual-stage* successor to EPE that
  enhances game frames from G-buffers + semantic data and benchmarks against
  Pix2PixHD/CycleGAN. The closest published match to this pipeline.

### Newer one-step options (researched June 2026)
- **Latent Bridge Matching (LBM, ICCV 2025 highlight, public code)** —
  single-step latent image-to-image, SOTA quality. Prefer it over
  Pix2Pix-Turbo for the "better realism, still fast" slot.
- **TReFT (2025)** — one-step translation distilled from rectified-flow models.
- **Teachers:** **FLUX.2** (Nov 2025) now surpasses FLUX.1 Kontext for target
  generation; SDXL-Turbo / SD3.5 + ControlNet still fine.
- **Temporal frontier to borrow from (not as the renderer):** StreamDiffusionV2
  (~30-60 FPS streaming), CausVid, Self-Forcing, Rolling Forcing, and full
  interactive world models (Matrix-Game 3.0, Decart/Oasis, Genie-3). Useful for
  the temporal-consistency pass (causal DiT, rolling KV cache, distillation), but
  they generate the world rather than deterministically render ours.

**Bottom line:** the Pix2PixHD-first plan still holds for a low-data,
controllable, real-time POC. The two upgrades worth knowing: use **EPE/REGEN**
as the architectural reference, and **LBM** as the modern one-step realism step.

Full comparison, rationale and sources (dated): [model-research.md](model-research.md).

---

## Milestones

- **M0 — Exporter** ✅ (this branch): RGB + depth + unit/team/id + terrain masks.
- **M1 — 300-pair crop model:** Pix2PixHD on 256/384/512 crops; validate layout.
- **M2 — 1,000-pair model:** better masks + better targets.
- **M3 — Real-time prototype:** ONNX/TensorRT at 540p/720p.
- **M4 — Temporal pass:** previous frame + motion vectors.
- **M5 — Production:** neural output first, then UI/particles/fog-of-war/icons.

---

## What we need from you

The model is the easy part; **good, layout-true targets are the hard part.** To
move from M0 to M1 we need a decision and/or hardware:

1. **Target strategy** — pick one: (a) you generate AI targets (FLUX/SDXL/ComfyUI)
   from the exported `rgb.png`, (b) we invest in a teacher renderer with real WW2
   assets, or (c) hybrid. (a) is fastest to validate.
2. **A GPU for training** — an RTX 4090 (or cloud equivalent) trains the Pix2PixHD
   POC in a few hours. Tell us what you have access to.
3. **~300–500 curated target images** for the first run (we generate the inputs).
4. **A realism reference** — a few example "look" images so targets stay
   consistent (lighting, palette, grit, era-correct vehicles).
5. **Confirm scope** — first prove it on 512px crops (recommended), not full
   screen real-time. Confirm that's acceptable.

Give us (1) + (4) and access to (2), and we can run M1.

---

## Practical warning

Bad targets (that move tanks, invent units, change the camera, or add modern
objects) train a bad renderer. Good targets keep the **same camera, terrain
boundaries, unit positions and classes**, and only add realistic texture,
lighting, smoke and detail. Get that right and even a small model looks great.
