#!/usr/bin/env python3
"""Slice reference/realistic image pairs into aligned 512x512 training patches.

Stage 3 of the reference-dataset pipeline. Takes the paired folders produced
by capture (stage 1) and generation (stage 2) and emits:

    <out>/
      train/input/<stem>_crop_NNN.png   (from the reference render)
      train/target/<stem>_crop_NNN.png  (from the realistic counterpart)
      val/...
      test/...
      manifest.json

Key decisions:
- BOTH images are resized (Lanczos) to one canonical --size before cropping,
  so every pair covers the same content window and every image gets the same
  crop grid. Default 1718x915 = the generations' native size (keep the target
  un-upscaled; the higher-res reference downscales onto it). Captures share
  one aspect ratio with the generations, so this is a uniform scale.
- Crop positions are evenly spaced so no two patches are near-duplicates:
  n = ceil((dim - patch) / max_stride) + 1 positions per axis, overlap stays
  in the 64-128px band for the default sizes.
- Split is BY MAP (the m<hash> in the capture filename), never by crop or by
  image: different shots of one map overlap in content and would leak across
  train/val otherwise. Map hashes are sorted and dealt into train/val/test
  by the --split ratios.
- Patches whose reference side is mostly off-map white are skipped (both
  sides), with the count reported. Use --white-frac 1.1 to disable.
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def crop_positions(dim, patch, max_stride):
    """Evenly spaced positions covering [0, dim-patch], stride <= max_stride."""
    span = dim - patch
    if span <= 0:
        return [0]
    n = math.ceil(span / max_stride) + 1
    return [round(i * span / (n - 1)) for i in range(n)]


def is_mostly_white(img, frac, level=235):
    g = img.convert("L")
    hist = g.histogram()
    white = sum(hist[level:])
    return white / (img.width * img.height) >= frac


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ref", default="dataset/reference", help="reference images folder (.jpg)")
    ap.add_argument("--real", default="dataset/realistic", help="realistic images folder (.png)")
    ap.add_argument("--out", default="dataset/patches", help="output folder")
    ap.add_argument("--patch", type=int, default=512)
    ap.add_argument("--size", default="1718x915", help="canonical WxH both images are resized to before cropping")
    ap.add_argument("--max-stride", type=int, default=448, help="max distance between crop origins (patch - min overlap)")
    ap.add_argument("--split", default="3,1,1", help="train,val,test ratio in MAPS (dealt over sorted map hashes)")
    ap.add_argument("--white-frac", type=float, default=0.85, help="skip patch if >= this fraction of the reference side is near-white")
    args = ap.parse_args()

    ref_dir, real_dir, out_dir = Path(args.ref).expanduser(), Path(args.real).expanduser(), Path(args.out).expanduser()
    pairs = []
    for ref in sorted(ref_dir.glob("*.jpg")):
        real = real_dir / (ref.stem + ".png")
        if real.exists():
            pairs.append((ref, real))
    if not pairs:
        sys.exit(f"No pairs found between {ref_dir} and {real_dir}")

    # split maps, not images
    map_of = {}
    for ref, _ in pairs:
        m = re.match(r"ref_m([0-9a-f]+)_", ref.name)
        map_of[ref] = m.group(1) if m else "unknown"
    hashes = sorted(set(map_of.values()))
    ratios = [int(x) for x in args.split.split(",")]
    names = ["train", "val", "test"]
    split_of_map = {}
    # deal maps into splits proportionally (largest remainder on sorted hashes)
    total = sum(ratios)
    counts = [max(0, round(len(hashes) * r / total)) for r in ratios]
    while sum(counts) > len(hashes):
        counts[counts.index(max(counts))] -= 1
    while sum(counts) < len(hashes):
        counts[0] += 1
    i = 0
    for name, c in zip(names, counts):
        for h in hashes[i:i + c]:
            split_of_map[h] = name
        i += c

    for name in names:
        (out_dir / name / "input").mkdir(parents=True, exist_ok=True)
        (out_dir / name / "target").mkdir(parents=True, exist_ok=True)

    size = tuple(int(v) for v in args.size.lower().split("x"))
    xs = crop_positions(size[0], args.patch, args.max_stride)
    ys = crop_positions(size[1], args.patch, args.max_stride)

    written = {n: 0 for n in names}
    skipped_white = 0
    for ref_path, real_path in pairs:
        split = split_of_map[map_of[ref_path]]
        real = Image.open(real_path).convert("RGB").resize(size, Image.LANCZOS)
        ref = Image.open(ref_path).convert("RGB").resize(size, Image.LANCZOS)
        idx = 0
        for y in ys:
            for x in xs:
                box = (x, y, x + args.patch, y + args.patch)
                ref_patch = ref.crop(box)
                if is_mostly_white(ref_patch, args.white_frac):
                    skipped_white += 1
                    idx += 1
                    continue
                name = f"{ref_path.stem}_crop_{idx:03d}.png"
                ref_patch.save(out_dir / split / "input" / name)
                real.crop(box).save(out_dir / split / "target" / name)
                written[split] += 1
                idx += 1

    manifest = {
        "pairs": len(pairs),
        "size": args.size,
        "grid": {"xs": xs, "ys": ys},
        "patch": args.patch,
        "max_stride": args.max_stride,
        "white_frac": args.white_frac,
        "maps": {h: split_of_map[h] for h in hashes},
        "patches": written,
        "skipped_mostly_white": skipped_white,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
