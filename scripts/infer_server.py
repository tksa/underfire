#!/usr/bin/env python3
"""Neural terrain render server for Under Fire.

Runs the published ControlNet (https://huggingface.co/tstruk/under-fire-terrain-controlnet)
locally; the game talks to it on http://127.0.0.1:8788 via the debug panel
(backtick). Runs on a CUDA GPU (~8GB+ free), on Apple Silicon through MPS
(float16, batch size 1; a 512 tile takes roughly 10-20 s on an M-series Max,
so a full map bake is an hour or two), or on the CPU as a last resort.
Pick with --device cuda|mps|cpu (default: the best available).

Environment (Python 3.12 recommended; the system Python 3.9 cannot host spandrel):
    uv venv -p 3.12 .venv && uv pip install --python .venv/bin/python \
        torch diffusers transformers accelerate safetensors pillow numpy
    .venv/bin/python scripts/infer_server.py

POST /render with a JPEG game frame (reference mode, zoom 20) as the raw body.
The frame is resized to the training-canonical 1718x915, the centre 512x512
crop is fed through the trained ControlNet, and the response is a JPEG of
[conditioning | generated] side by side, with timing in X-Prep-Ms / X-Infer-Ms
headers. GET / is a health check.
"""
import argparse
import glob
import io
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import torch
from PIL import Image
from diffusers import (
    ControlNetModel,
    StableDiffusionControlNetImg2ImgPipeline,
    StableDiffusionControlNetPipeline,
    StableDiffusionImg2ImgPipeline,
    UniPCMultistepScheduler,
)

MODEL = "stable-diffusion-v1-5/stable-diffusion-v1-5"
CAPTION = "ultra realistic aerial photograph of rural french countryside terrain, drone photo, neutral daylight"
CANON = (1718, 915)   # canonical pair size used by slice_patches.py

ap = argparse.ArgumentParser()
ap.add_argument("--checkpoint", default="tstruk/under-fire-terrain-controlnet",
                help="HF model id or a local save_pretrained folder")
ap.add_argument("--port", type=int, default=8788)
ap.add_argument("--steps", type=int, default=25)
ap.add_argument("--device", default="auto", choices=["auto", "cuda", "mps", "cpu"],
                help="compute device (auto = cuda, else mps, else cpu)")
args = ap.parse_args()


def pick_device(name):
    if name == "auto":
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        return "cpu"
    return name


DEVICE = pick_device(args.device)
# bf16 is the CUDA choice; MPS is float16 (bf16 support there is partial and
# slow), and the CPU path stays float32 for correctness.
dtype = {"cuda": torch.bfloat16, "mps": torch.float16, "cpu": torch.float32}[DEVICE]
# diffusers warns that MPS batch inference can produce wrong images: one tile
# per pipeline call there, eight on CUDA (bounded by VRAM), one on CPU.
BATCH = 8 if DEVICE == "cuda" else 1


def make_generator():
    # torch.Generator has no MPS variant in every release; the CPU generator
    # seeds the sampler identically on all devices.
    return torch.Generator("cuda" if DEVICE == "cuda" else "cpu").manual_seed(SEED)


def empty_cache():
    if DEVICE == "cuda":
        torch.cuda.empty_cache()
    elif DEVICE == "mps" and hasattr(torch, "mps"):
        torch.mps.empty_cache()


print(f"loading {args.checkpoint} on {DEVICE} ({dtype}) ...", flush=True)
cn = ControlNetModel.from_pretrained(args.checkpoint, torch_dtype=dtype)
pipe = StableDiffusionControlNetPipeline.from_pretrained(
    MODEL, controlnet=cn, torch_dtype=dtype, safety_checker=None)
pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)
pipe.set_progress_bar_config(disable=True)
pipe.to(DEVICE)
if DEVICE != "cuda":
    # Attention slicing trades a little speed for a lot less memory headroom
    # on unified-memory machines and CPUs.
    pipe.enable_attention_slicing()
# same weights, img2img entry point — used by the refinement pass
pipe_i2i = StableDiffusionControlNetImg2ImgPipeline(**pipe.components)
pipe_i2i.set_progress_bar_config(disable=True)
_plain = {k: v for k, v in pipe.components.items() if k != "controlnet"}
pipe_plain = StableDiffusionImg2ImgPipeline(**_plain, requires_safety_checker=False)
pipe_plain.set_progress_bar_config(disable=True)

_esrgan = None


def esrgan_x2(img):
    """Real-ESRGAN 2x on a PIL image, tiled to bound VRAM."""
    global _esrgan
    if _esrgan is None:
        import os
        from spandrel import ModelLoader
        if not os.path.exists("models/RealESRGAN_x2plus.pth"):
            raise RuntimeError(
                "models/RealESRGAN_x2plus.pth missing - download from the "
                "Real-ESRGAN releases or bake with upscale=1")
        _esrgan = ModelLoader().load_from_file("models/RealESRGAN_x2plus.pth").model
        _esrgan = _esrgan.to(DEVICE).eval()
        if DEVICE != "cpu":
            _esrgan = _esrgan.half()
    a = np.asarray(img, np.float32) / 255.0
    H, W = a.shape[:2]
    out = np.zeros((H * 2, W * 2, 3), np.float32)
    T, OV = 512, 16
    with torch.no_grad():
        for y in range(0, H, T):
            for x in range(0, W, T):
                y0, x0 = max(0, y - OV), max(0, x - OV)
                y1, x1 = min(H, y + T + OV), min(W, x + T + OV)
                t = torch.from_numpy(a[y0:y1, x0:x1].transpose(2, 0, 1)).unsqueeze(0).to(DEVICE)
                if DEVICE != "cpu":
                    t = t.half()
                r = _esrgan(t)[0].float().clamp(0, 1).cpu().numpy().transpose(1, 2, 0)
                iy0, ix0 = (y - y0) * 2, (x - x0) * 2
                oy1, ox1 = min(H, y + T), min(W, x + T)
                out[y * 2:oy1 * 2, x * 2:ox1 * 2] = r[iy0:iy0 + (oy1 - y) * 2, ix0:ix0 + (ox1 - x) * 2]
    return Image.fromarray((out * 255).astype(np.uint8))


GUIDANCE = 5.0   # overwritten per request via ?guidance=
SEED = 7         # overwritten per request via ?seed=
CNSCALE = 1.0    # controlnet conditioning scale via ?cnscale= (how hard the layout steers)
STYLE = ""       # optional style suffix appended to the caption via ?style=
PROMPT = ""      # full prompt override via ?prompt= (empty = built-in caption)
NEGP = ""        # full negative override via ?neg= (empty = built-in NEG)


def caption():
    if PROMPT:
        return PROMPT
    return CAPTION + (", " + STYLE if STYLE else "")


def negp():
    return NEGP if NEGP else NEG
NEG = ("blurry, low quality, oversharpened, noisy, grainy, jpeg artifacts, "
       "painting, cartoon, illustration, oversaturated, high contrast, hdr")


def render(cond, steps):
    gen = make_generator()
    return pipe(caption(), negative_prompt=negp(), image=cond, num_inference_steps=steps,
                generator=gen, guidance_scale=GUIDANCE,
                controlnet_conditioning_scale=CNSCALE).images[0]


# Same 4x2 grid slice_patches.py cut the training pairs with.
XS = [0, 402, 804, 1206]
YS = [0, 403]
OX, OY = 110, 109   # patch overlaps for seam blending


def _positions(total, stride):
    """Tile start offsets covering [0, total] with 512 patches: fixed stride,
    last patch pinned to the end so coverage is exact."""
    xs = [0]
    while xs[-1] + 512 < total:
        xs.append(min(xs[-1] + stride, total - 512))
    return sorted(set(xs))


def render_tiled(img, steps, xs, ys):
    """Generate every (x, y) 512 tile of img in GPU batches of 8, stitch back
    with linear blending across the overlaps."""
    tiles = [(x, y) for y in ys for x in xs]
    conds = [img.crop((x, y, x + 512, y + 512)) for x, y in tiles]
    outs = []
    for i in range(0, len(conds), BATCH):
        gen = make_generator()   # fixed seed: stable output
        n = len(conds[i:i + BATCH])
        outs += pipe([caption()] * n, negative_prompt=[negp()] * n, image=conds[i:i + BATCH],
                     num_inference_steps=steps, generator=gen, guidance_scale=GUIDANCE,
                     controlnet_conditioning_scale=CNSCALE).images
        print(f"  tiles {min(i + BATCH, len(conds))}/{len(conds)}", flush=True)
    W, H = img.size
    acc = np.zeros((H, W, 3), np.float32)
    wacc = np.zeros((H, W, 1), np.float32)
    for k, (x, y) in enumerate(tiles):
        a = np.asarray(outs[k], np.float32)
        wx = np.ones(512, np.float32)
        wy = np.ones(512, np.float32)
        if x > 0:
            wx[:OX] = np.linspace(0, 1, OX)
        if x + 512 < W:
            wx[-OX:] = np.linspace(1, 0, OX)
        if y > 0:
            wy[:OY] = np.linspace(0, 1, OY)
        if y + 512 < H:
            wy[-OY:] = np.linspace(1, 0, OY)
        w = (wy[:, None] * wx[None, :])[..., None]
        acc[y:y + 512, x:x + 512] += a * w
        wacc[y:y + 512, x:x + 512] += w
    return Image.fromarray(np.clip(acc / np.maximum(wacc, 1e-6), 0, 255).astype(np.uint8))


def render_full(img, steps):
    """One canonical frame: the training 4x2 grid."""
    return render_tiled(img, steps, XS, YS)


def refine_tiled(ref_img, init_img, steps, strength, xs, ys):
    """Second img2img pass: same tile grid, the pass-1 stitch as init image.
    Low strength keeps layout/colour and adds coherent micro-detail."""
    tiles = [(x, y) for y in ys for x in xs]
    outs = []
    for i in range(0, len(tiles), BATCH):
        chunk = tiles[i:i + BATCH]
        conds = [ref_img.crop((x, y, x + 512, y + 512)) for x, y in chunk]
        inits = [init_img.crop((x, y, x + 512, y + 512)) for x, y in chunk]
        gen = make_generator()
        outs += pipe_i2i([caption()] * len(chunk), negative_prompt=[negp()] * len(chunk),
                         image=inits, control_image=conds, strength=strength,
                         num_inference_steps=steps, generator=gen,
                         guidance_scale=GUIDANCE,
                         controlnet_conditioning_scale=CNSCALE).images
        print(f"  refine {min(i + BATCH, len(tiles))}/{len(tiles)}", flush=True)
    W, H = ref_img.size
    acc = np.zeros((H, W, 3), np.float32)
    wacc = np.zeros((H, W, 1), np.float32)
    for k, (x, y) in enumerate(tiles):
        a = np.asarray(outs[k], np.float32)
        wx = np.ones(512, np.float32)
        wy = np.ones(512, np.float32)
        if x > 0:
            wx[:OX] = np.linspace(0, 1, OX)
        if x + 512 < W:
            wx[-OX:] = np.linspace(1, 0, OX)
        if y > 0:
            wy[:OY] = np.linspace(0, 1, OY)
        if y + 512 < H:
            wy[-OY:] = np.linspace(1, 0, OY)
        w = (wy[:, None] * wx[None, :])[..., None]
        acc[y:y + 512, x:x + 512] += a * w
        wacc[y:y + 512, x:x + 512] += w
    return Image.fromarray(np.clip(acc / np.maximum(wacc, 1e-6), 0, 255).astype(np.uint8))


def detail_pass(img, strength, steps):
    """Very-low-strength plain img2img over the (upscaled) texture, tiled:
    the model invents fine grass/soil/gravel detail at the finer scale while
    the low strength pins layout and colour. The classic SD-upscale trick."""
    W, H = img.size
    xs, ys = _positions(W, 402), _positions(H, 403)
    tiles = [(x, y) for y in ys for x in xs]
    outs = []
    for i in range(0, len(tiles), BATCH):
        chunk = tiles[i:i + BATCH]
        inits = [img.crop((x, y, x + 512, y + 512)) for x, y in chunk]
        gen = make_generator()
        outs += pipe_plain([caption()] * len(chunk), negative_prompt=[negp()] * len(chunk),
                           image=inits, strength=strength, num_inference_steps=steps,
                           generator=gen, guidance_scale=GUIDANCE).images
        print(f"  detail {min(i + BATCH, len(tiles))}/{len(tiles)}", flush=True)
    acc = np.zeros((H, W, 3), np.float32)
    wacc = np.zeros((H, W, 1), np.float32)
    for k, (x, y) in enumerate(tiles):
        a = np.asarray(outs[k], np.float32)
        wx = np.ones(512, np.float32)
        wy = np.ones(512, np.float32)
        if x > 0:
            wx[:OX] = np.linspace(0, 1, OX)
        if x + 512 < W:
            wx[-OX:] = np.linspace(1, 0, OX)
        if y > 0:
            wy[:OY] = np.linspace(0, 1, OY)
        if y + 512 < H:
            wy[-OY:] = np.linspace(1, 0, OY)
        w = (wy[:, None] * wx[None, :])[..., None]
        acc[y:y + 512, x:x + 512] += a * w
        wacc[y:y + 512, x:x + 512] += w
    return Image.fromarray(np.clip(acc / np.maximum(wacc, 1e-6), 0, 255).astype(np.uint8))


def render_bake(img, steps):
    """Whole-map texture at arbitrary size: same stride as the training grid."""
    return render_tiled(img, steps, _positions(img.size[0], 402), _positions(img.size[1], 403))


t = time.time()
render(Image.new("RGB", (512, 512)), 2)
print(f"warmup {time.time() - t:.1f}s", flush=True)


def load_checkpoint(path):
    """Hot-swap the ControlNet; the frozen SD base stays resident."""
    global cn
    new = ControlNetModel.from_pretrained(path, torch_dtype=dtype).to(DEVICE)
    pipe.controlnet = new
    pipe_i2i.controlnet = new
    old, cn = cn, new
    del old
    empty_cache()
    args.checkpoint = path
    print(f"checkpoint swapped -> {path}", flush=True)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Expose-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _json(self, obj, code=200):
        import json
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/checkpoints":
            self._json({"checkpoints": sorted(glob.glob("runs/*/checkpoint-*")),
                        "current": args.checkpoint})
            return
        self._json({"ok": True, "checkpoint": args.checkpoint})

    def do_POST(self):
        q = parse_qs(urlparse(self.path).query)
        if urlparse(self.path).path == "/checkpoint":
            path = (q.get("path") or [""])[0]
            if path not in glob.glob("runs/*/checkpoint-*"):
                self._json({"ok": False, "error": "unknown checkpoint"}, 400)
                return
            try:
                load_checkpoint(path)
                self._json({"ok": True, "current": args.checkpoint})
            except Exception as e:
                self._json({"ok": False, "error": str(e)}, 500)
            return
        mode = (q.get("mode") or ["crop"])[0]
        steps = int((q.get("steps") or [args.steps])[0])
        global GUIDANCE, SEED, CNSCALE, STYLE
        GUIDANCE = float((q.get("guidance") or [5.0])[0])
        SEED = int((q.get("seed") or [7])[0])
        CNSCALE = float((q.get("cnscale") or [1.0])[0])
        STYLE = (q.get("style") or [""])[0]
        global PROMPT, NEGP
        PROMPT = (q.get("prompt") or [""])[0]
        NEGP = (q.get("neg") or [""])[0]
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        t0 = time.time()
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        if mode not in ("bake", "tile"):
            # match the training distribution: canonical size, same patch scale
            img = img.resize(CANON, Image.LANCZOS)
        t1 = time.time()
        refine = float((q.get("refine") or [0])[0])
        upscale = int((q.get("upscale") or [1])[0])
        if mode == "tile":
            # battle-damage patch: one 512 conditioning tile in, one tile out
            result = render(img, steps)
            if refine > 0:
                gen = make_generator()
                result = pipe_i2i(caption(), negative_prompt=negp(), image=result,
                                  control_image=img, strength=refine,
                                  num_inference_steps=steps, generator=gen,
                                  guidance_scale=GUIDANCE,
                                  controlnet_conditioning_scale=CNSCALE).images[0]
            if upscale == 2:
                result = esrgan_x2(result)
        elif mode == "bake":
            # whole-map texture, already at training pixel density
            result = render_bake(img, steps)
            xs, ys = _positions(img.size[0], 402), _positions(img.size[1], 403)
        elif mode == "full":
            # whole frame, tiled + batched + stitched
            result = render_full(img, steps)
            xs, ys = XS, YS
        if mode in ("bake", "full"):
            if refine > 0:
                result = refine_tiled(img, result, steps, refine, xs, ys)
            if upscale == 2:
                result = esrgan_x2(result)
                if max(result.size) > 8192:   # keep GPU texture size sane
                    f = 8192 / max(result.size)
                    result = result.resize((round(result.size[0] * f), round(result.size[1] * f)), Image.LANCZOS)
            detail = float((q.get("detail") or [0])[0])
            if detail > 0:
                result = detail_pass(result, detail, steps)
        else:
            # quick test: centre 512 crop, returned beside its input
            cx, cy = CANON[0] // 2, CANON[1] // 2
            cond = img.crop((cx - 256, cy - 256, cx + 256, cy + 256))
            out = render(cond, steps)
            result = Image.new("RGB", (1024, 512))
            result.paste(cond, (0, 0))
            result.paste(out, (512, 0))
        t2 = time.time()
        buf = io.BytesIO()
        result.save(buf, "JPEG", quality=92)
        body = buf.getvalue()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("X-Prep-Ms", str(round((t1 - t0) * 1000)))
        self.send_header("X-Infer-Ms", str(round((t2 - t1) * 1000)))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        print(f"render mode={mode} steps={steps} prep={round((t1 - t0) * 1000)}ms "
              f"infer={round((t2 - t1) * 1000)}ms", flush=True)


print(f"listening :{args.port} device={DEVICE} checkpoint={args.checkpoint} steps={args.steps}", flush=True)
ThreadingHTTPServer(("0.0.0.0", args.port), H).serve_forever()
