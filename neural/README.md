# neural/ — Neural Renderer pipeline tools

Scaffolding for training a small conditional image-to-image model that turns
Under Fire's low-poly render into a realistic WW2 frame. Full design:
[../docs/neural-renderer/README.md](../docs/neural-renderer/README.md).

Nothing here ships in the game build. It is a separate offline toolchain.

## Files

| File | What it does |
|------|--------------|
| `capture_dataset.mjs` | Drives the in-game `Game.NeuralExport` headlessly to save many input frames (rgb + masks + depth + meta). |
| `pack_dataset.py` | Turns raw exports + targets into Pix2PixHD `train_A`/`train_B` pairs. |
| `train_poc.sh` | Wrapper to train NVIDIA/pix2pixHD on the packed dataset. |
| `export_onnx.py` | Export a trained generator to ONNX (then build a TensorRT engine). |
| `infer.py` | Minimal inference: run the model on an exported control image. |
| `requirements.txt` | Python deps for the offline tools. |

## Quick start

```bash
# 0. serve the game (separate terminal, from repo root)
python3 -m http.server 8741

# 1. generate input frames (rgb + masks), no targets yet
cd neural
npm install playwright            # one-time; or use the repo's playwright-core
node capture_dataset.mjs --out ./dataset/raw --count 500 --height 540

# 2. add a realistic target for each frame as dataset/raw/NNNN_target.png
#    (teacher renderer, or AI img2img — see "Targets" below)

# 3. pack into Pix2PixHD pairs
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python pack_dataset.py --raw ./dataset/raw --out ./dataset --mode falsecolor --size 512 --val 0.1

# 4. train (clones NVIDIA/pix2pixHD on first run)
bash train_poc.sh

# 5. export + run
python export_onnx.py --weights checkpoints/ww2_rts_poc/latest_net_G.pth --out ww2_renderer.onnx
python infer.py --onnx ww2_renderer.onnx --input dataset/val_A/0001.png --out out.png
```

## Targets (the part that needs real input)

For every `NNNN_rgb.png` you need a layout-true realistic `NNNN_target.png`.

AI-teacher prompt (img2img / ControlNet, keep denoise low and use depth or the
masks as control):

```
Transform this top-down low-poly WW2 RTS battlefield screenshot into a realistic
cinematic aerial battlefield. Preserve the exact camera angle, unit positions,
silhouettes, terrain layout, roads, fields, forests, tanks, infantry and
artillery. No modern vehicles, no UI, no text, no fantasy. Gritty 1940s European
front, muddy fields, dust, smoke, realistic lighting.
```

Curate hard. Delete any target that moves a unit, changes the camera, invents
units, or adds modern/UI elements. Layout fidelity beats prettiness.

## Notes
- The constrained RTS camera means far less data is needed than a general model.
- Start on 512px crops, not full screen. Prove it small, then scale.
- `dataset/`, `checkpoints/`, `*.onnx`, `*.trt`, weights are git-ignored.
