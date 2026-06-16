"""
Test harness for apply_denoising().

Feed it an audio file and it will run the improved noise-reduction pipeline,
writing the denoised result next to the source file.

Usage:
    python test_denoising.py path/to/audio.wav
    python test_denoising.py path/to/audio.wav --trim-silence
    python test_denoising.py path/to/audio.wav --output-dir ./denoised_output
"""

import argparse
import os
import sys
import time

import numpy as np
import torch
import torchaudio

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from utils.audio_processing import apply_denoising


def load_audio(file_path: str) -> tuple[torch.Tensor, int]:
    """Load an audio file into a (channels, samples) torch tensor.

    Supports any format that torchaudio's SoX backend can read (wav, mp3, flac, …).
    """
    waveform, sr = torchaudio.load(file_path)  # shape: (channels, samples)
    print(f"Loaded: {file_path}")
    print(f"  Shape:  {waveform.shape}  |  dtype: {waveform.dtype}  |  SR: {sr} Hz")
    return waveform, sr


def rms_db(signal: torch.Tensor) -> float:
    """RMS level in dBFS of a float tensor."""
    sig = signal.detach().cpu().float()
    rms = torch.sqrt(torch.mean(sig ** 2)).item()
    if rms < 1e-12:
        return -120.0
    return float(20.0 * np.log10(rms))


def main():
    parser = argparse.ArgumentParser(description="Test the improved apply_denoising function")
    parser.add_argument("input", help="Path to the input audio file")
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directory for the denoised output (default: same directory as input)",
    )
    parser.add_argument(
        "--sample-rate",
        type=int,
        default=None,
        help="Force a resample to this sample rate before denoising (default: keep original)",
    )
    parser.add_argument(
        "--trim-silence",
        action="store_true",
        help="Trim the leading silence/noise preamble before denoising",
    )
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    print("=" * 60)
    print("  DENOISING TEST")
    print("=" * 60)

    waveform, sr = load_audio(args.input)

    # Resample if requested
    sample_rate = sr
    if args.sample_rate and args.sample_rate != sr:
        resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=args.sample_rate)
        waveform = resampler(waveform)
        sample_rate = args.sample_rate
        print(f"  Resampled to {sample_rate} Hz — shape: {waveform.shape}")

    before_rms = rms_db(waveform)
    before_samples = waveform.shape[-1]
    print(f"  RMS before: {before_rms:.2f} dBFS  |  samples: {before_samples}")

    t0 = time.perf_counter()
    denoised = apply_denoising(
        waveform, sample_rate=sample_rate, trim_silence=args.trim_silence
    )
    elapsed = time.perf_counter() - t0

    after_rms = rms_db(denoised)
    after_samples = denoised.shape[-1]
    delta_db = after_rms - before_rms
    trimmed = before_samples - after_samples
    extra = ""
    if trimmed > 0:
        extra = f"  |  trimmed: {trimmed} samples ({trimmed / sample_rate:.3f}s)"
    print(f"  RMS after:  {after_rms:.2f} dBFS  (delta: {delta_db:+.2f} dB)  |  samples: {after_samples}{extra}")
    print(f"  Processing time: {elapsed:.2f} s")

    # Determine output path
    suffix = "_trimmed_denoised" if args.trim_silence else "_denoised"
    if args.output_dir:
        os.makedirs(args.output_dir, exist_ok=True)
        base = os.path.splitext(os.path.basename(args.input))[0]
        output_path = os.path.join(args.output_dir, f"{base}{suffix}.wav")
    else:
        root, ext = os.path.splitext(args.input)
        output_path = f"{root}{suffix}.wav"

    torchaudio.save(output_path, denoised.cpu().unsqueeze(0) if denoised.ndim == 1 else denoised.cpu(), sample_rate)
    print(f"\n  Denoised file saved to: {output_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
