"""
Per-item TTS generation helper — synchronous (blocking) Gemini TTS calls with
retry/backoff and dBFS calibration.

Called via services.io_jobs.run_blocking() (starlette run_in_threadpool) from
routers/tts.py's in-process asyncio job, so a slow or rate-limited TTS call
can't stall the event loop the way it would if awaited directly.
"""
from __future__ import annotations

import time

from services.tts_service import TTSService
from utils.audio_processing import apply_dbfs_calibration, normalize_audio_rms
from config.constants import (
    DEFAULT_TTS_MODEL,
    FILENAME_MAX_LENGTH,
    WINDOWS_ILLEGAL_FILENAME_CHARS,
    TARGET_RMS,
)

# The Gemini TTS API can return 400 INVALID_ARGUMENT or empty content when
# rate-limited (rather than a clean 429) — retry with backoff so the quota
# has time to recover.
TTS_MAX_RETRIES = 4
TTS_RETRY_DELAYS_S = [3, 6, 12, 24]


def _calibrate_wav_to_dbfs(input_path: str, target_dbfs: float) -> None:
    """Normalize RMS then apply dBFS calibration to a WAV in place — mirrors
    the TangoFlux/AudioLDM2 and /api/calibrate-audio post-processing so TTS
    speech sits at the same dBFS anchor as every other sound mode."""
    import soundfile as sf
    import torch
    import torchaudio

    audio_np, sample_rate = sf.read(input_path)
    if audio_np.ndim > 1:
        audio_np = audio_np.mean(axis=1)
    audio_tensor = torch.from_numpy(audio_np).float().unsqueeze(0)
    audio_tensor = normalize_audio_rms(audio_tensor, target_rms=TARGET_RMS)
    audio_tensor = apply_dbfs_calibration(audio_tensor, target_dbfs=target_dbfs)
    torchaudio.save(input_path, audio_tensor.cpu(), sample_rate)


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
    language: str | None,
    tts_model: str,
    dbfs: float,
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
                language=language,
                model=tts_model or DEFAULT_TTS_MODEL,
            )
            last_exc = None
            break
        except Exception as exc:
            last_exc = exc
    if last_exc is not None:
        raise last_exc

    _calibrate_wav_to_dbfs(output_path, dbfs)
    return real_duration_seconds
