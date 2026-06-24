#!/usr/bin/env python3
"""
export_onnx.py — export a trained Pix2PixHD generator to ONNX (scaffold).

This is a starting point; adapt the import/model-construction lines to match the
exact pix2pixHD generator you trained (global vs local enhancer, ngf, etc.).
After exporting, build a TensorRT engine with `trtexec` for real-time inference.

  python export_onnx.py --weights .pix2pixHD/checkpoints/ww2_rts_poc/latest_net_G.pth \
      --out ww2_renderer.onnx --size 512
  # then, e.g.:  trtexec --onnx=ww2_renderer.onnx --saveEngine=ww2_renderer.trt --fp16
"""
import argparse


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--out", default="ww2_renderer.onnx")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--in-ch", type=int, default=3, help="input channels of the generator")
    args = ap.parse_args()

    try:
        import torch
    except ImportError:
        raise SystemExit("torch required: pip install -r requirements.txt")

    # NOTE: replace this with the actual pix2pixHD generator definition you trained.
    # from models.networks import GlobalGenerator   # (from the pix2pixHD repo)
    # netG = GlobalGenerator(input_nc=args.in_ch, output_nc=3, ngf=64, n_downsampling=4, n_blocks=9)
    # netG.load_state_dict(torch.load(args.weights, map_location="cpu"))
    # netG.eval()
    raise SystemExit(
        "Scaffold: wire up your trained pix2pixHD generator here, then:\n"
        "  dummy = torch.randn(1, %d, %d, %d)\n"
        "  torch.onnx.export(netG, dummy, '%s', opset_version=17,\n"
        "      input_names=['input'], output_names=['output'],\n"
        "      dynamic_axes={'input': {2:'h',3:'w'}, 'output': {2:'h',3:'w'}})\n"
        % (args.in_ch, args.size, args.size, args.out)
    )


if __name__ == "__main__":
    main()
