"""
Per-item TTS generation — rate-limited Gemini TTS calls with retry/backoff and
loudness calibration.

``generate_tts_item`` is async: every attempt waits for the shared RPM budget
(``services.rate_limiter.TTS_LIMITER``) and nothing else, then awaits the
async Gemini call (no thread held while waiting on the network). Only the
short CPU-bound calibration runs in the threadpool (services.io_jobs.run_blocking).
"""
from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Optional

from services.io_jobs import run_blocking
from services.rate_limiter import TTS_LIMITER
from services.tts_service import TTSService
from utils.audio_processing import calibrate_audio_loudness
from utils.gemini_quota import classify_quota_error
from utils.resampling import resample_to
from config.constants import (
    DEFAULT_TTS_MODEL,
    FILENAME_MAX_LENGTH,
    WINDOWS_ILLEGAL_FILENAME_CHARS,
    AUDIO_SAMPLE_RATE,
    TTS_MAX_QUOTA_RETRIES,
    TTS_RATE_LIMIT_DEFAULT_BACKOFF_S,
)

# The Gemini TTS API can return 400 INVALID_ARGUMENT or empty content when
# rate-limited (rather than a clean 429) — retry with backoff so the quota
# has time to recover. A per-minute 429 waits on the shared limiter instead;
# a per-day 429 is not retried (TtsDailyQuotaError).
TTS_MAX_RETRIES = 4
TTS_RETRY_DELAYS_S = [3, 6, 12, 24]


class TtsDailyQuotaError(RuntimeError):
    """Gemini's per-day TTS quota for the project is used up (resets at
    midnight Pacific time). Retrying before then cannot succeed."""


class TtsCancelled(Exception):
    """The user cancelled the TTS job while a line waited for quota."""


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


async def generate_tts_item(
    tts_service: TTSService,
    text: str,
    output_path: str,
    voice_name: str,
    language_code: str | None,
    tts_model: str,
    dbfs: float,
    style: str | None = None,
    on_wait: Optional[Callable[[float], Awaitable[None]]] = None,
) -> float:
    """Generate one TTS clip with rate limiting and retry/backoff, then
    calibrate to dbfs.

    ``on_wait(seconds)`` is called about once a second while this item waits
    for the RPM budget, so the job can show a countdown, then with 0 when the
    call starts. It may raise to abandon the item (e.g. on cancel).

    Returns the real measured clip duration (seconds) reported by the API —
    used downstream to space out dependent sounds/dialogue via
    after()/alignEnd() links, so it must reflect the actual audio length, not
    a nominal guess. Raises TtsDailyQuotaError at once on a per-day 429, and
    the last exception after exhausting retries otherwise.
    """
    other_failures = 0
    quota_retries = 0
    while True:
        await TTS_LIMITER.acquire(on_wait)
        if on_wait is not None:
            await on_wait(0.0)
        try:
            _, real_duration_seconds = await tts_service.generate_speech(
                text=text,
                output_path=output_path,
                voice_name=voice_name,
                language_code=language_code,
                model=tts_model or DEFAULT_TTS_MODEL,
                style=style,
            )
            break
        except Exception as exc:
            kind, retry_delay_s = classify_quota_error(exc)
            if kind == "daily":
                raise TtsDailyQuotaError(
                    "Daily Gemini TTS quota reached (resets at midnight Pacific time)"
                ) from exc
            if kind == "minute":
                # Pause every TTS call, not just this one; the next attempt
                # waits on the limiter (with countdown).
                quota_retries += 1
                if quota_retries > TTS_MAX_QUOTA_RETRIES:
                    raise
                TTS_LIMITER.back_off(retry_delay_s or TTS_RATE_LIMIT_DEFAULT_BACKOFF_S)
                continue
            other_failures += 1
            if other_failures >= TTS_MAX_RETRIES:
                raise
            await asyncio.sleep(TTS_RETRY_DELAYS_S[other_failures - 1])

    await run_blocking(_calibrate_wav_to_dbfs, output_path, dbfs)
    return real_duration_seconds
