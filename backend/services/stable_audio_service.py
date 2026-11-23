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
/ noisereduce, not installed in the isolated env) and calibrates loudness with
`utils.loudness` (numpy + scipy only), the same step every other input uses.
"""
from __future__ import annotations

import os
import time

import numpy as np
import soundfile as sf
import torch

from config.constants import (
    STABLE_AUDIO_MODEL_NAME,
    STABLE_AUDIO_MAX_DURATION_S,
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
    DEFAULT_DBFS,
    AUDIO_SAMPLE_RATE,
)
from utils.loudness import calibrate_loudness
from utils.resampling import resample_to


class StableAudioCancelled(Exception):
    """Raised inside the sampler callback when should_stop() becomes true."""


def _to_mono_np(audio: torch.Tensor) -> np.ndarray:
    """(batch, channels, samples) model output -> float32 mono (samples,)."""
    arr = audio[0].detach().to(torch.float32).cpu().numpy()  # (channels, samples)
    if arr.ndim == 1:
        return np.ascontiguousarray(arr)
    return np.ascontiguousarray(arr.mean(axis=0))


class StableAudioService:
    """Resident wrapper around StableAudioModel. One instance per worker process."""

    def __init__(self):
        self.model = None
        self.sample_rate = AUDIO_SAMPLE_RATE
        self._offloaded = False  # weights in system RAM (offload / restore)

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

    @property
    def on_gpu(self) -> bool:
        return self.model is not None and not self._offloaded

    def gpu_bytes(self) -> int:
        """GPU memory this process's allocator holds (what an offload releases, the CUDA context aside)."""
        return int(torch.cuda.memory_reserved()) if torch.cuda.is_available() else 0

    def offload(self) -> None:
        """Move the weights to system RAM (incl. T5Gemma's encoder, kept outside the module tree)."""
        if self.model is None or self._offloaded:
            return
        from utils.gpu_offload import move_model

        t0 = time.time()
        free0 = torch.cuda.mem_get_info()[0]
        n_hidden = move_model(self.model.model, "cpu")
        self._offloaded = True
        print(f"[sa3] weights moved to system RAM in {time.time() - t0:.1f}s ({n_hidden} hidden module(s)); "
              f"GPU free {free0 / 1e9:.2f} -> {torch.cuda.mem_get_info()[0] / 1e9:.2f} GB")

    def restore(self) -> None:
        """Move the weights back to the GPU (before a generation)."""
        if self.model is None or not self._offloaded:
            return
        from utils.gpu_offload import move_model

        t0 = time.time()
        move_model(self.model.model, self.model.device)
        self._offloaded = False
        print(f"[sa3] weights back on the GPU in {time.time() - t0:.1f}s")

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
        self.restore()  # no-op unless offloaded; the worker restores first when memory allows

        # stable-audio-3-small-sfx runs classifier-free guidance over a distilled
        # pingpong sampler. Feeding it a negative prompt while guidance is > ~3
        # overflows the guided prediction to NaN, which after PCM write becomes an
        # all -1.0 (silent / "flat") file. The negative prompt in this app is a
        # TangoFlux/AudioLDM2 concept, so Stable Audio 3 deliberately ignores it.
        if negative_prompt:
            print("[sa3] ignoring negative prompt (destabilizes the distilled small-sfx model)")

        if float(duration) > STABLE_AUDIO_MAX_DURATION_S:
            print(f"[sa3] duration {duration}s clamped to the model's {STABLE_AUDIO_MAX_DURATION_S:g}s window")
            duration = STABLE_AUDIO_MAX_DURATION_S

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
        # Model-native rate -> master output rate, then (1, samples)
        mono = resample_to(_to_mono_np(audio), self.sample_rate)
        mono, loudness = calibrate_loudness(mono, AUDIO_SAMPLE_RATE, target_dbfs=dbfs)

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        sf.write(output_path, mono, AUDIO_SAMPLE_RATE)
        print(f"[sa3] wrote {output_path} ({AUDIO_SAMPLE_RATE} Hz, {duration}s target; {loudness.describe()})")
