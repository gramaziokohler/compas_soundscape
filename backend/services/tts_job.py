"""
Per-item TTS generation helper — synchronous (blocking) Gemini TTS calls with
retry/backoff and loudness calibration.

Called via services.io_jobs.run_blocking() (starlette run_in_threadpool) from
routers/tts.py's in-process asyncio job, so a slow or rate-limited TTS call
can't stall the event loop the way it would if awaited directly.
"""
from __future__ import annotations

import time

from services.tts_service import TTSService
from utils.audio_processing import calibrate_audio_loudness
from utils.resampling import resample_to
from config.constants import (
    DEFAULT_TTS_MODEL,
    FILENAME_MAX_LENGTH,
    WINDOWS_ILLEGAL_FILENAME_CHARS,
    AUDIO_SAMPLE_RATE,
)

# The Gemini TTS API can return 400 INVALID_ARGUMENT or empty content when
# rate-limited (rather than a clean 429) — retry with backoff so the quota
# has time to recover.
TTS_MAX_RETRIES = 4
TTS_RETRY_DELAYS_S = [3, 6, 12, 24]


def _calibrate_wav_to_dbfs(input_path: str, target_dbfs: float) -> None:
    """Resample to AUDIO_SAMPLE_RATE, then loudness-calibrate a WAV in place —
    the same post-processing as TangoFlux/AudioLDM2/SA3 and /api/calibrate-audio,
    so TTS speech sits at the same loudness anchor as every other sound mode."""
    import os
    import soundfile as sf
    import torch
    import torchaudio

    audio_np, sample_rate = sf.read(input_path)
    if audio_np.ndim > 1:
        audio_np = audio_np.mean(axis=1)
    audio_np = resample_to(audio_np, sample_rate)
    audio_tensor = torch.from_numpy(audio_np).float().unsqueeze(0)
    audio_tensor = calibrate_audio_loudness(
        audio_tensor, AUDIO_SAMPLE_RATE, target_dbfs=target_dbfs, label=os.path.basename(input_path),
    )
    torchaudio.save(input_path, audio_tensor.cpu(), AUDIO_SAMPLE_RATE)


def sanitize_filename(text: str) -> str:
    short_name = text[:FILENAME_MAX_LENGTH]
    for char in WINDOWS_ILLEGAL_FILENAME_CHARS:
        short_name = short_name.replace(char, "_")
    short_name = short_name.replace(" ", "_")
    return short_name or "speech"


def generate_tts_item(
    tts_service: TTSService,
    text: str,
    output_path: str,
    voice_name: str,
    language_code: str | None,
    tts_model: str,
    dbfs: float,
    style: str | None = None,
) -> float:
    """Generate one TTS clip with retry/backoff, then calibrate to dbfs.

    Returns the real measured clip duration (seconds) reported by the API —
    used downstream to space out dependent sounds/dialogue via
    after()/alignEnd() links, so it must reflect the actual audio length, not
    a nominal guess. Raises the last exception after exhausting retries.
    """
    last_exc: Exception | None = None
    real_duration_seconds = 5.0
    for attempt in range(TTS_MAX_RETRIES):
        if attempt > 0:
            time.sleep(TTS_RETRY_DELAYS_S[attempt - 1])
        try:
            _, real_duration_seconds = tts_service.generate_speech(
                text=text,
                output_path=output_path,
                voice_name=voice_name,
                language_code=language_code,
                model=tts_model or DEFAULT_TTS_MODEL,
                style=style,
            )
            last_exc = None
            break
        except Exception as exc:
            last_exc = exc
    if last_exc is not None:
        raise last_exc

    _calibrate_wav_to_dbfs(output_path, dbfs)
    return real_duration_seconds
