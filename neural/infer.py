#!/usr/bin/env python3
"""
infer.py — run the exported neural renderer on one control image (scaffold).

  python infer.py --onnx ww2_renderer.onnx --input dataset/val_A/00001.png --out out.png

Uses onnxruntime if available. For real-time in-engine use, run the TensorRT
engine instead and feed the game's control buffers each frame.
"""
import argparse


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default="out.png")
    ap.add_argument("--size", type=int, default=512)
    args = ap.parse_args()

    try:
        import numpy as np
        import onnxruntime as ort
        from PIL import Image
    except ImportError:
        raise SystemExit("Needs: pip install -r requirements.txt (onnxruntime, pillow, numpy)")

    img = Image.open(args.input).convert("RGB").resize((args.size, args.size), Image.BICUBIC)
    x = (np.asarray(img).astype("float32") / 127.5 - 1.0).transpose(2, 0, 1)[None]  # NCHW, [-1,1]

    sess = ort.InferenceSession(args.onnx, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    y = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
    y = ((y.transpose(1, 2, 0) + 1.0) * 127.5).clip(0, 255).astype("uint8")
    Image.fromarray(y).save(args.out)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
