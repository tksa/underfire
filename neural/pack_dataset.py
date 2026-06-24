#!/usr/bin/env python3
"""
pack_dataset.py — turn raw Under Fire exports into Pix2PixHD train/val pairs.

Reads frames produced by capture_dataset.mjs (NNNN_rgb/depth/unit/team/id/
terrain.png) plus a realistic NNNN_target.png, and writes paired folders:

    <out>/train_A, train_B, val_A, val_B

A = the conditioning image (input), B = the realistic target.

  --mode falsecolor : A = terrain class mask with the unit-type mask composited
                      on top (clean semantic control). Recommended.
  --mode rgb        : A = the abstract low-poly render (simplest baseline).
  --mode stack3     : A = R:unit  G:terrain-luma  B:depth (false-colour pack).

Usage:
  python pack_dataset.py --raw ./dataset/raw --out ./dataset --mode falsecolor --size 512 --val 0.1
"""
import argparse
import os
import glob
import random

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow required: pip install -r requirements.txt")


def load(p, size):
    return Image.open(p).convert("RGB").resize((size, size), Image.BICUBIC)


def luma(img):
    return img.convert("L")


def build_A(stem, mode, size):
    rgb = stem + "_rgb.png"
    terrain = stem + "_terrain.png"
    unit = stem + "_unit.png"
    depth = stem + "_depth.png"
    if mode == "rgb":
        return load(rgb, size)
    if mode == "falsecolor":
        base = load(terrain, size)
        u = load(unit, size)
        # composite units over terrain where the unit mask is not near-black
        um = luma(u).point(lambda v: 255 if v > 12 else 0)
        base.paste(u, (0, 0), um)
        return base
    if mode == "stack3":
        from PIL import ImageChops  # noqa
        r = luma(load(unit, size))
        g = luma(load(terrain, size))
        b = luma(load(depth, size))
        return Image.merge("RGB", (r, g, b))
    raise ValueError("unknown mode " + mode)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", default="falsecolor", choices=["falsecolor", "rgb", "stack3"])
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--val", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    stems = sorted({p[: -len("_rgb.png")] for p in glob.glob(os.path.join(args.raw, "*_rgb.png"))})
    if not stems:
        raise SystemExit(f"No *_rgb.png found in {args.raw}. Run capture_dataset.mjs first.")

    paired, missing = [], 0
    for s in stems:
        if os.path.exists(s + "_target.png"):
            paired.append(s)
        else:
            missing += 1
    if missing:
        print(f"WARNING: {missing}/{len(stems)} frames have no _target.png and are skipped. "
              f"Targets are required (see neural/README.md).")
    if not paired:
        raise SystemExit("No frames with targets. Add NNNN_target.png images, then re-run.")

    random.seed(args.seed)
    random.shuffle(paired)
    n_val = max(1, int(len(paired) * args.val)) if len(paired) > 10 else 0
    val, train = paired[:n_val], paired[n_val:]

    for split, items in (("train", train), ("val", val)):
        da = os.path.join(args.out, f"{split}_A")
        db = os.path.join(args.out, f"{split}_B")
        os.makedirs(da, exist_ok=True)
        os.makedirs(db, exist_ok=True)
        for i, s in enumerate(items):
            name = f"{i + 1:05d}.png"
            build_A(s, args.mode, args.size).save(os.path.join(da, name))
            load(s + "_target.png", args.size).save(os.path.join(db, name))
        print(f"{split}: {len(items)} pairs -> {da} , {db}")

    print("Done. Train with: bash train_poc.sh")


if __name__ == "__main__":
    main()
