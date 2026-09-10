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

---

## State of the art as of 2026-09-10 (update to the 2026-06-24 survey)

### What this repo actually built since June
The shipped pipeline is not the Pix2PixHD-on-G-buffers plan described above. It is a
terrain-only SD1.5 ControlNet (https://huggingface.co/tstruk/under-fire-terrain-controlnet,
0.4B params, 600 reference/gpt-image-2 pairs at 512 patches, checkpoints 18k/30k/84k,
OpenRAIL-M) run offline by scripts/infer_server.py (CUDA, 20 to 25 UniPC steps) and shipped
as maps/default/bake.jpg (8192x8192). The paired dataset is public and CC0
(https://huggingface.co/datasets/tstruk/under-fire-terrain-pairs, 600 pairs, 30 maps x 20
views, targets not pixel-aligned). js/neural_export.js still exports rgb/depth/unit/team/id/
terrain masks that nothing consumes. Nothing runs neurally in the browser.

### Real-time photorealism enhancement
- NVIDIA DLSS 5 "3D-Guided Neural Rendering": announced GTC 2026-03-16, detailed at SIGGRAPH
  2026, shipped 2026-09-03/04 in NBA 2K27, RTX 50 only. Runtime inputs are colour, motion
  vectors and temporal state; G-buffers and semantic masks are used in training and masking.
  About 8 ms per 4K frame on an RTX 5090 with a 41 to 58 percent native FPS loss. Control
  surface worth copying: Structure and Tone sliders, per-class masks, model tiers.
  https://www.nvidia.com/en-us/geforce/news/dlss-5-3d-guided-neural-rendering/ ,
  https://research.nvidia.com/labs/adlr/DLSS5/ ,
  https://www.notebookcheck.net/First-DLSS-5-game-tested-DLSS-5-humbles-RTX-5090-with-over-50-performance-loss.1391978.0.html
- HyPER-GAN (MIT, 2026): RGB-only U-Net (about 6.2M params), 12.3 ms at 720p and 29.6 ms at
  1080p on an RTX 4070 Super in PyTorch without TensorRT; README quotes above 20 FPS at 1080p
  inside UE5 on a 4090; ONNX export scripts included; GTA-V and CARLA only, no temporal
  handling. Replaces Pix2PixHD as the reference student architecture.
  https://arxiv.org/abs/2603.10604 , https://github.com/stefanos50/HyPER-GAN
- REGEN (IEEE ToG 2026): runtime is RGB-only Pix2PixHD (BSD-2), 32 ms at 960x540 on an RTX
  4090, trained on 15,011 CARLA frames; also ships a CARLA student taught by FLUX.2 klein 4B
  and reports colour drift and flicker from that teacher.
  https://arxiv.org/html/2508.17061v2 , https://github.com/stefanos50/REGEN
- EPE remains the offline reference (2.58 FPS at 960x540 on a 3090). https://arxiv.org/pdf/2105.04619

### G-buffer neural forward rendering (offline references only)
- RenderFlow (CVPR 2026, Disney Research): single-step flow matching on a 1.3B Wan2.1 base,
  1.4B to 1.7B params, 0.19 to 0.24 s per 512x512 on a 4090, UE5 PBR G-buffers, no code or
  weights released. https://arxiv.org/abs/2601.06928 ,
  https://studios.disneyresearch.com/2026/05/31/renderflow-single-step-neural-rendering-via-flow-matching/
- FrameDiffuser (2025-12): SD1.5 plus 10-channel ControlNet including irradiance, ControlLoRA
  rank 64, about 1 FPS on a 4090, MIT code, OpenRAIL-M weights, per-environment models, style
  drift out of distribution. https://arxiv.org/abs/2512.16670 ,
  https://github.com/cgtuebingen/FrameDiffuser
- Neither is a runtime path; transfer to a low-poly oblique RTS is unverified. Adding normal
  and albedo channels to the exporter is cheap groundwork for them.

### Teachers and one-step translators
- FLUX.2 [klein] 4B (2026-01-15, Apache 2.0, https://huggingface.co/black-forest-labs/FLUX.2-klein-4B):
  text-to-image and reference editing only, no depth/canny/segmentation conditioning, no
  strength or guidance knob in diffusers Flux2KleinPipeline. Measured Apple Silicon speed is
  7.5 s (M3 Max, 512) to 21 s (M1 Max, 1024) per image, so 20 to 45 s per 1 MP edit on an M4
  Max is the realistic figure. Structural control for klein (Diffusion Templates,
  https://arxiv.org/abs/2604.24351) has no released weights. Not a drop-in replacement for
  gpt-image-2 (REGEN's authors rank it below paid models for consistency).
- LBM is demoted from the runtime slot: SDXL-sized and CC BY-NC 4.0. Pix2Pix-Turbo (MIT code,
  SD-Turbo weights, 0.11 s per 512 on an A100) stays a bake or photo-mode option.

### Colour and material side
- Image-adaptive 3D LUT (Zeng et al., TPAMI, Apache-2.0): under 600K params, under 2 ms at
  4K on a Titan RTX; the blend is linear so mean weights bake exactly to a static 33^3 LUT.
  https://arxiv.org/abs/2009.14468 , https://github.com/HuiZeng/Image-Adaptive-3DLUT
- StableMaterials (CVPR 2026, openrail family, 8.9 GB): 512x512 tileable PBR sets, 4-step LCM
  in 0.6 s on a 4090; usable on MPS; only relevant for procedural fallback materials because
  every house, divider, bridge and tank is a textured GLB with atlas UVs.
  https://huggingface.co/gvecchio/StableMaterials , https://arxiv.org/abs/2406.09293
- Marigold IID-Appearance and Normals v1-1 are indoor-trained (InteriorVerse) and scene-level;
  wrong tool for flat tileable textures. https://arxiv.org/html/2505.09358

### Screen-space passes with learned components
- N8AO 2.0 (2026-07-12, CC0 per LICENSE): adds Neural-Low/Medium/High denoise modes as GLSL
  with baked int8 attention weights (617 params, up to 11.5 kFLOPs per pixel, up to 3x the
  standard cost, recommended at 720p to 1080p), orthographic cameras supported in code.
  https://github.com/N8python/n8ao
- realism-effects (SSGI, SSR, TRAA) still excludes OrthographicCamera. three r180 TRAA/GTAO
  nodes are WebGPU/TSL only.

### Browser inference stack
- WebGPU: Chrome/Edge 113+ (Linux Intel Gen12+ from 144, NVIDIA Wayland from 147), Firefox
  141 Windows / 145 Apple Silicon / 147 all Macs (Linux Nightly), Safari 26 default-on.
  Chrome 146 shipped compatibility mode. shader-f16 on about 95 percent of reporting adapters.
  https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- WebGL to WebGPU handoff is copyExternalImageToTexture from the canvas in the same task as
  the render (no cross-API shared texture). GPU path only in Chromium on macOS and Windows
  D3D; Firefox and shipping Safari read back on the CPU. WebKit's GPU path merged 2026-09-09.
  https://gpuweb.github.io/gpuweb/#dom-gpuqueue-copyexternalimagetotexture ,
  https://github.com/gpuweb/gpuweb/issues/5330 , https://bugs.webkit.org/show_bug.cgi?id=294602 ,
  https://github.com/WebKit/WebKit/pull/72866
- onnxruntime-web 1.29.0 (MIT, npm latest, 2026-08-24): native WebGPU EP (JSEP and WebGL
  deprecated), graph capture, GPU-buffer IO binding; 3 vendored files (66 KB ESM plus 25.7 MB
  asyncify wasm plus loader); ort.env.webgpu.device setter not honoured (#26107); Safari 26
  failures re-reported 2026-09-02 (#26827); JSPI bundle throws without WebAssembly.Suspending.
  https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html ,
  https://github.com/microsoft/onnxruntime/issues/26107 ,
  https://github.com/microsoft/onnxruntime/issues/26827
- LiteRT.js @litertjs/core 2.5.3 (Apache-2.0): two ESM files plus about 18.7 MB of wasm
  (plain and compat), float32/int32 I/O only, unsupported WebGPU ops fall back to wasm (whole
  model without JSPI), open unanswered WebGPU correctness bugs on Apple M4 Max (#9661, #9662)
  and a Linux-first litert-torch converter. Not adopted yet.
  https://github.com/google-ai-edge/LiteRT/tree/main/litert/js
- WebNN: W3C Candidate Recommendation 2026-01, Chromium origin trial only (146 to 149). Not a
  dependency.
- Dispatch overhead: 33 to 67 us per kernel in Chrome, about 32 us in Safari, about 1 ms in
  Firefox; kernel fusion is the dominant lever at batch 1. https://arxiv.org/html/2604.02344v1

### Display-resolution decoupling (pattern, not code)
DLSS 4/4.5 transformer SR, AMD FSR Redstone (2025-12) and Intel XeSS 3 (2026-01) are all
proprietary or signed binaries; FSR1 (MIT, ffx_fsr1.h) is the only piece with usable source
and needs gather4 emulated with four texelFetch calls in GLSL ES 3.00. The repo already has
the reduced-resolution composer path (Game.setUpscale, off by default) to hang it on.
https://gpuopen.com/fidelityfx-superresolution/ ,
https://github.com/GPUOpen-Effects/FidelityFX-FSR

### Not applicable to Under Fire (record and move on)
Neural Texture Compression, Neural Materials, Neural Radiance Cache, Cooperative Vectors
(DX12 SM 6.10 still preview), three r186 GaussianSplatMesh (WebGPURenderer/TSL only),
streaming video diffusion (MirageLSD, StreamDiffusionV2, server-side), OIDN-web (path-traced
noise). None run in WebGL2 or fit the ortho RTS.

---

The implementation plan derived from this survey is in `PLAN_2026-09.md`.
