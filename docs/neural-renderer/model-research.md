# Neural Renderer — Model Research Notes

Research snapshot: **2026-06-24**. This records why the pipeline picks the models
it does, what the current state of the art is, and what to revisit later. Treat
it as a dated note, not gospel; re-check before a serious training run.

Scope: turning Under Fire's low-poly render into a realistic WW2 frame is a
**conditional image-to-image / semantic-to-image** problem with layout-true
conditioning (G-buffers + masks). It is **not** text-to-image, and it is **not**
a world model that invents the scene.

---

## Verdict on the original shortlist

The original plan (Pix2PixHD first, SPADE second, Pix2Pix-Turbo for more realism,
FLUX/SDXL/Hyper-SD as teachers only) is **still sound in mid-2026** for a
low-data, controllable, real-time proof of concept:

- **Pix2PixHD** remains a legitimate first model: paired, semantic→image,
  ~20–30 ms inference, and straightforward to export to ONNX/TensorRT. It is
  still used as a baseline in current papers.
- **"Teachers only" for FLUX/SDXL** is correct — they are too heavy and too
  non-deterministic to be the in-game renderer.

Two substantive updates since then (below): anchor on the **EPE/REGEN** line as
the architectural reference, and prefer **LBM** over Pix2Pix-Turbo for the
one-step realism step.

---

## Reference architectures — read these first

This is a named research area, not new ground.

- **Intel — Enhancing Photorealism Enhancement (EPE, 2021).** The canonical
  template: enhances rendered frames using **G-buffers + semantic segmentation**
  while preserving layout (their demo: GTA V → Cityscapes realism). Our exporter
  produces exactly these inputs, so EPE's design maps directly onto our problem.
- **REGEN (2025).** A modern, **real-time, dual-stage** successor to EPE that
  enhances game frames from G-buffers + semantic data and benchmarks against
  Pix2PixHD and CycleGAN. The closest published match to this pipeline; the
  dual-stage split (content preservation vs. style) is worth copying.

Practical takeaway from both: feed the model rendered **intermediate buffers**
(depth, normals, class/instance masks), not just RGB. That is what makes a small
model preserve the battle.

---

## Model tiers (updated)

| Use | Model | Notes |
|-----|-------|-------|
| First POC (real-time) | **Pix2PixHD** | Paired semantic→image, fast, easy ONNX/TensorRT. Start here. |
| Architectural reference | **EPE / REGEN** | G-buffer + segmentation → realistic; REGEN is the real-time version. |
| Stronger semantic control | SPADE / GauGAN | Built for semantic-mask synthesis; older codebase. |
| Better realism, still ~1 step | **Latent Bridge Matching (LBM)** | ICCV 2025 highlight, public code, single-step latent img2img, SOTA. Prefer over Pix2Pix-Turbo. |
| Alt one-step translation | TReFT (2025) | Distilled from rectified-flow models. |
| Target / reference generation | **FLUX.2** (Nov 2025), SDXL-Turbo, SD3.5 + ControlNet | Teachers only. FLUX.2 now beats FLUX.1 Kontext. |
| Temporal tricks to borrow | StreamDiffusionV2, CausVid, Self-Forcing, Rolling Forcing | For the temporal pass, not the renderer. |
| Upscaling | Real-ESRGAN / FSR / DLSS | Final sharpness/resolution. |

---

## What changed vs. the original list

- **Pix2Pix-Turbo → LBM** for "better realism, still fast." LBM is a single-step
  latent bridge-matching method with SOTA image-to-image quality and released
  code; it is the stronger modern choice for that slot.
- **FLUX.1 Kontext → FLUX.2** as the heavy teacher/target generator.
- Added **EPE/REGEN** as the architectural reference (was absent and is the most
  directly relevant prior work).
- Noted the **real-time world-model frontier** (Matrix-Game 3.0, Decart/Oasis,
  Genie-3, StreamDiffusionV2). These *generate* worlds rather than render ours,
  so they are not the renderer — but their temporal techniques (causal
  autoregression, rolling KV cache, distillation) are what we would lift for the
  temporal-stability pass.

---

## Recommended order (unchanged spine, upgraded parts)

1. **Pix2PixHD** on 512px crops — prove layout fidelity with 300–500 pairs.
2. Move toward an **EPE/REGEN-style** G-buffer-conditioned net once Pix2PixHD validates.
3. **LBM** for the realism step if the GAN looks too "GAN-ish."
4. **FLUX.2 / SDXL-Turbo** strictly as teachers for target generation.
5. Borrow **StreamDiffusionV2 / Self-Forcing** ideas for temporal stability.
6. **TensorRT** only after it works visually; render UI/particles after the AI pass.

The hardest part remains **layout-true targets**, not the model (see the main
pipeline doc, "Practical warning").

---

## Sources (as of 2026-06-24)

- REGEN: Real-Time Photorealism Enhancement in Games — https://arxiv.org/pdf/2508.17061
- LBM: Latent Bridge Matching (ICCV 2025) — https://arxiv.org/abs/2503.07535 · code https://github.com/gojasper/LBM
- TReFT: Taming Rectified Flow for One-Step Image Translation — https://arxiv.org/pdf/2511.20307
- StreamDiffusionV2 — https://streamdiffusionv2.github.io/
- Matrix-Game 3.0 (interactive world model) — https://github.com/SkyworkAI/Matrix-Game
- Open-source image-generation guide 2026 (FLUX.2 context) — https://www.bentoml.com/blog/a-guide-to-open-source-image-generation-models
- Intel EPE (background, 2021): "Enhancing Photorealism Enhancement," Richter et al.
