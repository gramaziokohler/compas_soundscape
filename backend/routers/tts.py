"""
Text-to-Speech generation endpoints.

POST /api/generate-tts
  Validates input, runs the job as an in-process asyncio task (behind
  TTS_SEMAPHORE), returns {job_id, position, total} immediately. Poll via
  GET /api/jobs/{job_id} — see routers/jobs.py. Each item's blocking Gemini
  TTS call runs in a threadpool (services/tts_job.py) so it can't stall the
  event loop.
"""
from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, HTTPException, Request

from services.tts_service import TTSService
from services.tts_job import generate_tts_item, sanitize_filename
from services.job_store import job_store
from services.io_jobs import start_io_job, run_blocking
from services.paths import user_sounds_dir
from models.schemas import TTSGenerationRequest, JobEnqueueResponse
from config.constants import (
    GENERATED_SOUND_URL_PREFIX,
    TTS_AVAILABLE_MODELS,
    DEFAULT_TTS_MODEL,
    DEFAULT_DBFS,
    TTS_DEFAULT_VOICE,
    JOB_TYPE_TTS,
)

router = APIRouter()

tts_service = None


def init_tts_router(service: TTSService):
    global tts_service
    tts_service = service


@router.post("/api/generate-tts", response_model=JobEnqueueResponse)
async def generate_tts(request: TTSGenerationRequest, req: Request):
    valid_texts = [t for t in request.texts if (t.get("text") or "").strip()]
    if not valid_texts:
        raise HTTPException(status_code=400, detail="No valid text entries provided")

    session_id = getattr(getattr(req, "state", None), "session_id", None)
    if not session_id:
        raise HTTPException(status_code=400, detail="No session cookie")

    tts_model = request.tts_model or DEFAULT_TTS_MODEL
    if tts_model not in TTS_AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown TTS model: {tts_model}")

    sounds_out = user_sounds_dir(session_id)
    sounds_out.mkdir(parents=True, exist_ok=True)
    url_prefix = f"{GENERATED_SOUND_URL_PREFIX}/{session_id}"
    language = request.language

    async def _run(job_id: str) -> None:
        completed_sounds: list[dict] = []
        errors: list[str] = []
        n_total = len(valid_texts)
        voice_counters: dict[str, int] = {}

        for idx, item in enumerate(valid_texts):
            text = (item.get("text") or "").strip()
            voice_name = item.get("voice_name", TTS_DEFAULT_VOICE)
            display_name = item.get("display_name") or text
            prompt_index = item.get("prompt_index", idx)
            copy_index = item.get("copy_index", 0)
            total_copies = item.get("total_copies", 1)
            dbfs = item.get("dbfs", DEFAULT_DBFS)

            voice_counters[voice_name] = voice_counters.get(voice_name, 0) + 1
            voice_num = voice_counters[voice_name]
            display_short = display_name[:30]

            if not text:
                await job_store.set_progress(
                    job_id, int(idx / n_total * 100) if n_total else 0,
                    f"Speech {idx + 1}/{n_total}: skipped (empty text)",
                    partial=completed_sounds,
                )
                continue

            await job_store.set_progress(
                job_id, int(idx / n_total * 100) if n_total else 0,
                f"Generating speech {idx + 1}/{n_total} ({display_short})...",
                partial=completed_sounds,
            )

            filename = f"tts_{voice_name}_{voice_num}_{sanitize_filename(text)}.wav"
            output_path = os.path.normpath(os.path.join(str(sounds_out), filename))

            try:
                real_duration_seconds = await run_blocking(
                    generate_tts_item,
                    tts_service, text, output_path, voice_name, language, tts_model, dbfs,
                )
            except Exception as exc:
                errors.append(f"{display_short}: {exc}")
                await job_store.set_progress(
                    job_id, int((idx + 1) / n_total * 100) if n_total else 100,
                    f"Speech {idx + 1}/{n_total}: failed — {exc}",
                    partial=completed_sounds,
                )
                continue

            completed_sounds.append({
                "id": f"tts_{prompt_index}_{copy_index}_{voice_name}",
                "prompt": text,
                "prompt_index": prompt_index,
                "copy_index": copy_index,
                "total_copies": total_copies,
                # Echo back the original card index for speech lines so the frontend
                # can look up the correct SoundGenerationConfig via speech_card_index.
                "speech_card_index": item.get("speech_card_index"),
                "display_name": f"{voice_name} speech {voice_num}",
                "url": f"{url_prefix}/{filename}",
                "duration": round(real_duration_seconds, 3),
                "position": item.get("position", [0, 0, 0]),
                "volume_dbfs": dbfs,
                "voice_name": voice_name,
            })

            # Brief pause after each successful call so the Gemini TTS quota
            # has time to recover before the next request (non-blocking here,
            # unlike the old subprocess's time.sleep).
            if idx < n_total - 1:
                await asyncio.sleep(2)

        # Consistency with the text-to-audio flow: if nothing could be
        # generated, surface the failure instead of an empty "done" result.
        if not completed_sounds and errors:
            await job_store.fail(job_id, "TTS generation failed — " + "; ".join(errors[:3]))
            return

        await job_store.set_progress(job_id, 98, "Finalizing...", partial=completed_sounds)
        await job_store.complete(job_id, completed_sounds)

    job_id = await start_io_job(JOB_TYPE_TTS, session_id, _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)
