"""
Stable Audio 3 (StabilityAI) service — text-to-audio, audio-to-audio (restyle)
and inpainting/continuation.

IMPORTANT — execution environment
---------------------------------
`stable_audio_3` requires Python >= 3.10, torch == 2.7.1 and transformers >= 5
(small-sfx's text conditioner is T5GemmaEncoderModel). Those versions are
incompatible with the main backend env (compas-toy: torch 2.4 / transformers
4.44, pinned by TangoFlux). This module must therefore ONLY be imported by a
process running inside the isolated env (workers/sa3_runner.py, --role sa3) —
never by the FastAPI process.

It intentionally avoids importing `utils.audio_processing` (which pulls librosa
/ noisereduce, not installed in the isolated env) and implements RMS
normalization / dBFS calibration inline with torch only.
"""
from __future__ import annotations

import os
import time

import numpy as np
import soundfile as sf
import torch

from config.constants import (
    STABLE_AUDIO_MODEL_NAME,
    STABLE_AUDIO_DEFAULT_STEPS,
    STABLE_AUDIO_DEFAULT_GUIDANCE,
    STABLE_AUDIO_GUIDANCE_MIN,
    STABLE_AUDIO_GUIDANCE_MAX,
    STABLE_AUDIO_DEFAULT_INIT_NOISE_LEVEL,
    STABLE_AUDIO_DEFAULT_DURATION_PADDING_S,
    STABLE_AUDIO_MODE_RESTYLE,
    STABLE_AUDIO_MODE_INPAINT,
    STABLE_AUDIO_MODE_EXTEND,
    DEFAULT_DURATION_SECONDS,
    TARGET_RMS,
    CLIPPING_THRESHOLD,
    DBFS_CLIPPING_THRESHOLD,
    DEFAULT_DBFS,
    AUDIO_SAMPLE_RATE,
)


class StableAudioCancelled(Exception):
    """Raised inside the sampler callback when should_stop() becomes true."""


def _to_mono_np(audio: torch.Tensor) -> np.ndarray:
    """(batch, channels, samples) model output -> float32 mono (samples,)."""
    arr = audio[0].detach().to(torch.float32).cpu().numpy()  # (channels, samples)
    if arr.ndim == 1:
        return np.ascontiguousarray(arr)
    return np.ascontiguousarray(arr.mean(axis=0))


def _normalize_rms(audio: torch.Tensor, target_rms: float = TARGET_RMS) -> torch.Tensor:
    current_rms = torch.sqrt(torch.mean(audio ** 2) + 1e-12)
    if float(current_rms) < 1e-8:
        return audio
    out = audio * (target_rms / current_rms)
    max_val = torch.max(torch.abs(out))
    if float(max_val) > CLIPPING_THRESHOLD:
        out = out * (CLIPPING_THRESHOLD / max_val)
    return out


def _apply_dbfs(audio: torch.Tensor, target_dbfs: float, base_dbfs: float = DEFAULT_DBFS) -> torch.Tensor:
    scale = 10.0 ** ((target_dbfs - base_dbfs) / 20.0)
    out = audio * scale
    max_val = torch.max(torch.abs(out))
    if float(max_val) > DBFS_CLIPPING_THRESHOLD:
        out = out * (DBFS_CLIPPING_THRESHOLD / max_val)
    return out


class StableAudioService:
    """Resident wrapper around StableAudioModel. One instance per worker process."""

    def __init__(self):
        self.model = None
        self.sample_rate = AUDIO_SAMPLE_RATE

    @staticmethod
    def get_service_version_info() -> dict:
        version = None
        try:
            import importlib.metadata as ilmd
            version = ilmd.version("stable-audio-3")
        except Exception:
            pass
        device = "cuda" if torch.cuda.is_available() else "cpu"
        return {"name": "Stable Audio 3 (small-sfx)", "version": version or "unknown", "device": device}

    def _ensure_model(self):
        if self.model is None:
            from stable_audio_3 import StableAudioModel

            print(f"[sa3] loading model {STABLE_AUDIO_MODEL_NAME!r}...")
            t0 = time.time()
            self.model = StableAudioModel.from_pretrained(STABLE_AUDIO_MODEL_NAME)
            self.sample_rate = int(self.model.model.sample_rate)
            print(f"[sa3] model ready in {time.time() - t0:.1f}s (sample_rate={self.sample_rate})")
        return self.model

    def warm_up(self) -> None:
        """Pay the first-inference cost once at process start (non-fatal)."""
        try:
            tmp = os.path.join(os.path.dirname(__file__), "_sa3_warmup.wav")
            self.generate_clip(
                output_path=tmp,
                prompt="a soft click",
                mode=None,
                duration=DEFAULT_DURATION_SECONDS,
                steps=STABLE_AUDIO_DEFAULT_STEPS,
            )
            try:
                os.unlink(tmp)
            except OSError:
                pass
        except Exception as exc:  # pragma: no cover - warm-up is best-effort
            print(f"[sa3] warm-up failed (non-fatal): {exc}")

    @staticmethod
    def _load_audio(path: str):
        """Load a WAV/FLAC/OGG file into the (sample_rate, float32 [samples, channels]) tuple
        expected by StableAudioModel.generate."""
        data, sr = sf.read(path, dtype="float32", always_2d=True)
        if data.shape[1] > 2:
            data = data[:, :2]
        return sr, np.ascontiguousarray(data)

    def generate_clip(
        self,
        output_path: str,
        *,
        prompt: str = "",
        mode: str | None = None,
        negative_prompt: str | None = None,
        duration: float = 8.0,
        steps: int = STABLE_AUDIO_DEFAULT_STEPS,
        cfg_scale: float = STABLE_AUDIO_DEFAULT_GUIDANCE,
        seed: int = -1,
        dbfs: float = DEFAULT_DBFS,
        init_audio_path: str | None = None,
        init_noise_level: float = STABLE_AUDIO_DEFAULT_INIT_NOISE_LEVEL,
        inpaint_audio_path: str | None = None,
        inpaint_regions: list[list[float]] | None = None,
        duration_padding_sec: float = STABLE_AUDIO_DEFAULT_DURATION_PADDING_S,
        sampler_type: str | None = None,
        progress_callback=None,
        stage_callback=None,
        should_stop=None,
    ) -> None:
        """Generate one clip and write it as a calibrated mono WAV at `output_path`.

        `mode`:
          - None / "text"  : plain text-to-audio.
          - "restyle"      : audio-to-audio via init_audio + init_noise_level.
          - "inpaint"      : regenerate the masked region(s).
          - "extend"       : continuation — mask a region reaching the source tail and
                             generate a longer clip.
        """
        model = self._ensure_model()

        # stable-audio-3-small-sfx runs classifier-free guidance over a distilled
        # pingpong sampler. Feeding it a negative prompt while guidance is > ~3
        # overflows the guided prediction to NaN, which after PCM write becomes an
        # all -1.0 (silent / "flat") file. The negative prompt in this app is a
        # TangoFlux/AudioLDM2 concept, so Stable Audio 3 deliberately ignores it.
        if negative_prompt:
            print("[sa3] ignoring negative prompt (destabilizes the distilled small-sfx model)")

        # Guidance (model CFG scale) is constrained to [0, 1].
        cfg_scale = max(STABLE_AUDIO_GUIDANCE_MIN, min(float(cfg_scale), STABLE_AUDIO_GUIDANCE_MAX))

        kwargs: dict = dict(
            prompt=prompt,
            negative_prompt=None,
            duration=float(duration),
            steps=int(steps),
            cfg_scale=float(cfg_scale),
            seed=int(seed),
            duration_padding_sec=float(duration_padding_sec),
            truncate_output_to_duration=True,
            disable_tqdm=True,
        )
        if sampler_type:
            kwargs["sampler_type"] = sampler_type

        if mode == STABLE_AUDIO_MODE_RESTYLE and init_audio_path:
            if stage_callback:
                stage_callback("Encoding source audio...")
            kwargs["init_audio"] = self._load_audio(init_audio_path)
            kwargs["init_noise_level"] = float(init_noise_level)
        elif mode in (STABLE_AUDIO_MODE_INPAINT, STABLE_AUDIO_MODE_EXTEND) and inpaint_audio_path:
            if stage_callback:
                stage_callback("Encoding source audio...")
            kwargs["inpaint_audio"] = self._load_audio(inpaint_audio_path)
            starts = [float(r[0]) for r in (inpaint_regions or [])]
            ends = [float(r[1]) for r in (inpaint_regions or [])]
            if starts and ends:
                kwargs["inpaint_mask_start_seconds"] = starts[0] if len(starts) == 1 else starts
                kwargs["inpaint_mask_end_seconds"] = ends[0] if len(ends) == 1 else ends

        # Progress + cooperative cancel via the sampler callback (one call per step).
        needs_cb = bool(progress_callback) or bool(should_stop) or bool(stage_callback)

        def _cb(info: dict):
            if should_stop is not None and should_stop():
                raise StableAudioCancelled()
            if progress_callback is not None:
                i = int(info.get("i", 0)) + 1
                progress_callback(i, int(steps))

        if needs_cb:
            kwargs["callback"] = _cb

        if stage_callback:
            stage_callback("Generating audio...")
        audio = model.generate(**kwargs)
        if should_stop is not None and should_stop():
            raise StableAudioCancelled()

        if stage_callback:
            stage_callback("Post-processing...")
        mono = torch.from_numpy(_to_mono_np(audio)).unsqueeze(0)  # (1, samples)
        mono = _normalize_rms(mono)
        mono = _apply_dbfs(mono, dbfs)

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        sf.write(output_path, mono.squeeze(0).numpy(), self.sample_rate)
        print(f"[sa3] wrote {output_path} ({self.sample_rate} Hz, {duration}s target)")
