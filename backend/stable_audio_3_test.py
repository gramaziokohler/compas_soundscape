"""
Stable Audio 3 - Small-SFX trial script (standalone, no codebase integration).

Modes:
  text        Text-to-audio (default):          --prompt "..." [--duration 8]
  a2a         Audio-to-audio restyle:           --init-audio in.wav --prompt "..."
  inpaint     Regenerate a masked region:       --inpaint-audio in.wav --inpaint-start 4 --inpaint-end 8 --prompt "..."
  continue    Extend a clip beyond its length:  --inpaint-audio in.wav --duration 12 --prompt "..."

Requirements:
    conda env: compas-sa3  (Python 3.10, torch 2.7.1+cu126, stable-audio-3 editable)
    Run:  mamba activate compas-sa3; python backend/stable_audio_3_test.py --hf-token <token>

The StabilityAI/stable-audio-3-small-sfx model is GATED on HuggingFace —
accept the license on https://huggingface.co/stabilityai/stable-audio-3-small-sfx
and pass a token via --hf-token or the HF_TOKEN env var (preferred).
"""

import argparse
import os
import time

import numpy as np
import soundfile as sf
import torch

from stable_audio_3 import StableAudioModel


# --- 1. CONFIG / AUTH ---
DEFAULT_PROMPTS = ["a door closing"]
DEFAULT_INIT_NOISE_LEVEL = 0.9

# NOT under backend/temp: a live `uvicorn --reload` backend wipes backend/temp on every
# file change (main.py lifespan -> cleanup_all_temp_directories). Use a stable location.
OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "stable_audio_3_test")

MODES = ("text", "a2a", "inpaint", "continue")


def parse_args():
    p = argparse.ArgumentParser(description="Stable Audio 3 Small-SFX trial (text / a2a / inpaint / continue)")
    p.add_argument("--hf-token", default=os.getenv("HF_TOKEN"), help="HF token, or set HF_TOKEN env var")
    p.add_argument("--model", default="small-sfx", help="Model id (default: small-sfx)")
    p.add_argument("--mode", choices=MODES, default="text", help="Inference mode (default: text)")
    p.add_argument("--prompt", action="append", help="Prompt(s) (repeatable; defaults to SFX samples)")
    p.add_argument("--negative-prompt", default=None, help="Negative prompt for classifier-free guidance")
    p.add_argument("--duration", type=float, default=8.0, help="Output length in seconds (default: 8)")
    p.add_argument("--steps", type=int, default=50, help="Diffusion steps (default: 50)")
    p.add_argument("--cfg-scale", type=float, default=3.0, help="Classifier-free guidance scale")
    p.add_argument("--seed", type=int, default=1234, help="Seed (default: 1234)")
    # Audio-to-audio inputs
    p.add_argument("--init-audio", default=None, help="Source audio file to restyle (mode=a2a)")
    p.add_argument("--init-noise-level", type=float, default=DEFAULT_INIT_NOISE_LEVEL,
                   help="Noise level for a2a: 0 = keep source exactly, 1 = full rewrite (default: 0.9)")
    # Inpaint / continuation inputs
    p.add_argument("--inpaint-audio", default=None, help="Source audio file to inpaint/continue (mode=inpaint|continue)")
    p.add_argument("--inpaint-start", type=float, default=None,
                   help="Inpaint region start in seconds (default for inpaint: 25%% of source; continue: end of source)")
    p.add_argument("--inpaint-end", type=float, default=None,
                   help="Inpaint region end in seconds (default for inpaint: 50%% of source)")
    p.add_argument("--out", default=OUTPUT_DIR, help="Output directory (default: ~/Downloads/stable_audio_3_test)")
    return p.parse_args()


def load_audio(path: str):
    """Load a WAV/FLAC/OGG into (sample_rate, float32 numpy [samples, channels]); downmix to mono/stereo."""
    data, sr = sf.read(path, dtype="float32", always_2d=True)  # (samples, channels)
    if data.shape[1] > 2:
        data = data[:, :2]
    return sr, np.ascontiguousarray(data)


def save_wav(tensor, path: str, sample_rate: int) -> None:
    """tensor shape (batch, channels, samples) -> WAV (samples, channels)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    audio = tensor[0].detach().cpu().numpy()  # (channels, samples)
    audio = np.ascontiguousarray(audio.transpose(1, 0))  # (samples, channels)
    sf.write(path, audio, sample_rate)


def sanitize(s: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in s).strip("_")[:40] or "clip"


def main():
    args = parse_args()

    if not args.hf_token:
        raise SystemExit(__doc__ + "\n\nERROR: No HF token provided. Pass --hf-token or set HF_TOKEN.")
    os.environ["HF_TOKEN"] = args.hf_token

    if torch.cuda.is_available():
        print(f"CUDA available: {torch.cuda.get_device_name(0)}")
    else:
        print("CUDA not available — Small-SFX will run on CPU (slower).")

    prompts = args.prompt if args.prompt else DEFAULT_PROMPTS
    os.makedirs(args.out, exist_ok=True)

    # --- Validate mode-specific inputs ---
    if args.mode == "a2a" and not args.init_audio:
        raise SystemExit("ERROR: --mode a2a requires --init-audio <file>")
    if args.mode in ("inpaint", "continue") and not args.inpaint_audio:
        raise SystemExit(f"ERROR: --mode {args.mode} requires --inpaint-audio <file>")

    # --- 2. LOAD MODEL (first run downloads model_config.json + model.safetensors) ---
    print(f"[sa3] Loading StableAudioModel({args.model!r}) ...")
    t0 = time.time()
    model = StableAudioModel.from_pretrained(args.model)
    print(f"[sa3] Model ready in {time.time() - t0:.1f}s  device={model.device}")
    sr = model.model.sample_rate

    # --- 3. Prepare audio inputs for a2a / inpaint / continue ---
    init_audio = inpaint_audio = None
    if args.init_audio:
        in_sr, in_data = load_audio(args.init_audio)
        init_audio = (in_sr, in_data)
        print(f"[sa3] init audio  : {args.init_audio}  ({in_data.shape[0] / in_sr:.1f}s, {in_sr} Hz, {in_data.shape[1]} ch)")
    if args.inpaint_audio:
        in_sr, in_data = load_audio(args.inpaint_audio)
        inpaint_audio = (in_sr, in_data)
        src_dur = in_data.shape[0] / in_sr
        print(f"[sa3] inpaint audio: {args.inpaint_audio}  ({src_dur:.1f}s, {in_sr} Hz, {in_data.shape[1]} ch)")

    inpaint_start = inpaint_end = None
    if args.mode == "inpaint":
        inpaint_start = args.inpaint_start if args.inpaint_start is not None else 0.25 * src_dur
        inpaint_end = args.inpaint_end if args.inpaint_end is not None else 0.5 * src_dur
    elif args.mode == "continue":
        inpaint_start = args.inpaint_start if args.inpaint_start is not None else src_dur
        inpaint_end = args.inpaint_end if args.inpaint_end is not None else args.duration
        if args.duration <= src_dur:
            raise SystemExit(f"ERROR: --duration ({args.duration}s) must exceed source length ({src_dur:.1f}s) to extend it.")

    # --- 4. GENERATE / SAVE ---
    for i, prompt in enumerate(prompts):
        print(f"\n[{i + 1}/{len(prompts)}] mode={args.mode} duration={args.duration}s prompt={prompt!r}")
        kwargs = dict(
            prompt=prompt,
            negative_prompt=args.negative_prompt,
            duration=args.duration,
            steps=args.steps,
            cfg_scale=args.cfg_scale,
            seed=args.seed + i,
        )
        if args.mode == "a2a":
            kwargs.update(init_audio=init_audio, init_noise_level=args.init_noise_level)
        elif args.mode in ("inpaint", "continue"):
            kwargs.update(
                inpaint_audio=inpaint_audio,
                inpaint_mask_start_seconds=inpaint_start,
                inpaint_mask_end_seconds=inpaint_end,
            )

        ts = time.time()
        audio = model.generate(**kwargs)
        elapsed = time.time() - ts

        tag = {"text": "txt", "a2a": "a2a", "inpaint": "inp", "continue": "cont"}[args.mode]
        out = os.path.join(args.out, f"{tag}_{i + 1}_{sanitize(prompt)}.wav")
        save_wav(audio, out, sr)
        print(f"[sa3] done in {elapsed:.1f}s -> {out}  ({sr} Hz)")

    print("\nAll clips written to:", args.out)


if __name__ == "__main__":
    main()