#!/usr/bin/env bash
# train_poc.sh — train the Pix2PixHD proof-of-concept on the packed dataset.
# Clones NVIDIA/pix2pixHD on first run. See ../docs/neural-renderer/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DATASET="${DATASET:-$HERE/dataset}"
NAME="${NAME:-ww2_rts_poc}"
FINE="${FINE:-512}"
GPU="${GPU:-0}"
P2P_DIR="${P2P_DIR:-$HERE/.pix2pixHD}"

if [ ! -d "$P2P_DIR" ]; then
  echo ">> Cloning NVIDIA/pix2pixHD into $P2P_DIR"
  git clone https://github.com/NVIDIA/pix2pixHD "$P2P_DIR"
  echo ">> Install its deps in your venv (torch, dominate, etc.) per that repo's README."
fi

if [ ! -d "$DATASET/train_A" ]; then
  echo "!! $DATASET/train_A not found. Run pack_dataset.py first." >&2
  exit 1
fi

# Pix2PixHD expects train_A (input) / train_B (target) under --dataroot.
cd "$P2P_DIR"
python train.py \
  --name "$NAME" \
  --dataroot "$DATASET" \
  --label_nc 0 \
  --no_instance \
  --resize_or_crop crop \
  --fineSize "$FINE" \
  --gpu_ids "$GPU" \
  "$@"

echo ">> Checkpoints in $P2P_DIR/checkpoints/$NAME"
echo ">> Next: python export_onnx.py --weights $P2P_DIR/checkpoints/$NAME/latest_net_G.pth --out ww2_renderer.onnx"
