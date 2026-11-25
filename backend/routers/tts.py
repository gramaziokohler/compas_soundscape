"""
Text-to-Speech generation endpoints.

POST /api/generate-tts
  Validates input, runs the job as an in-process asyncio task (behind
  TTS_SEMAPHORE), returns {job_id, position, total} immediately. Poll via
  GET /api/jobs/{job_id} — see routers/jobs.py. A job's lines run in parallel;
  each Gemini call waits on the shared RPM limiter (services/rate_limiter.py)
  and runs in a threadpool (services/tts_job.py) so it can't stall the event
  loop.
"""
from __future__ import annotations

import asyncio
import math
import os
import uuid

from fastapi import APIRouter, HTTPException, Request

from services.tts_service import TTSService
from services.tts_job import (
    TtsCancelled,
    TtsDailyQuotaError,
    generate_tts_item,
    sanitize_filename,
)
from services.tts_voice_catalog import voice_catalog
from services.tts_voice_service import pick_voice
from services.metadata_store import metadata_store
from utils.language_resolver import resolve_language
from utils.speech_style import clean_style
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
    # Resolve the user's free-text language ("Swiss German") once per job into a
    # BCP-47 code + dialect voices (Gemini 3.8 rejects free text with a 400).
    user_hash = getattr(req.state, "user_hash", None)
    dialects = await run_blocking(voice_catalog.dialects)
    match = resolve_language(
        request.language, dialects, metadata_store.list_custom_voices(user_hash) if user_hash else []
    )

    async def _run(job_id: str) -> None:
        # Every line starts at once and waits only on the shared RPM limiter
        # (services/rate_limiter.py), so the quota, not a fixed pause or a
        # concurrency cap, sets the pace. completed_sounds is append-only in completion
        # order: the frontend reads `partial` by slicing past its last count.
        completed_sounds: list[dict] = []
        errors: list[str] = []
        n_total = len(valid_texts)
        n_failed = 0
        in_flight = 0
        waiting_s: dict[int, float] = {}  # line index -> seconds until its quota slot
        last_status = ""
        daily_quota: list[TtsDailyQuotaError] = []

        async def report() -> None:
            nonlocal last_status
            done = len(completed_sounds) + n_failed
            # Countdown only when every started line is waiting for quota.
            if waiting_s and len(waiting_s) >= in_flight:
                status = (
                    f"Gemini rate limit: next speech line in {math.ceil(min(waiting_s.values()))}s "
                    f"({done}/{n_total} done)"
                )
            else:
                status = f"Generating speech {done}/{n_total}..."
            if status == last_status:
                return
            last_status = status
            value = min(97, int(done / n_total * 100)) if n_total else 0
            await job_store.set_progress(job_id, value, status, partial=completed_sounds)

        # Plan every line first, in order, so voice numbering and filenames are
        # the same as with sequential generation.
        voice_counters: dict[str, int] = {}
        plans: list[dict] = []
        for idx, item in enumerate(valid_texts):
            voice_name = item.get("voice_name", TTS_DEFAULT_VOICE)
            voice_counters[voice_name] = voice_counters.get(voice_name, 0) + 1
            plans.append({
                "idx": idx,
                "item": item,
                "text": (item.get("text") or "").strip(),
                "voice_name": voice_name,
                "voice_num": voice_counters[voice_name],
                "gemini_voice": await run_blocking(pick_voice, match, voice_name, voice_catalog),
            })

        async def generate_line(plan: dict) -> None:
            nonlocal n_failed, in_flight
            idx, item, text = plan["idx"], plan["item"], plan["text"]
            voice_name = plan["voice_name"]
            display_name = item.get("display_name") or text
            prompt_index = item.get("prompt_index", idx)
            copy_index = item.get("copy_index", 0)
            total_copies = item.get("total_copies", 1)
            dbfs = item.get("dbfs", DEFAULT_DBFS)
            style = clean_style(item.get("style"))
            display_short = display_name[:30]

            if daily_quota or await job_store.is_cancel_requested(job_id):
                return  # not started: the job reports why below

            async def on_wait(seconds: float) -> None:
                if daily_quota:  # another line hit the daily quota: don't send this one
                    raise TtsCancelled()
                if seconds <= 0:  # quota slot granted, the call starts
                    waiting_s.pop(idx, None)
                else:
                    if await job_store.is_cancel_requested(job_id):
                        raise TtsCancelled()
                    waiting_s[idx] = seconds
                await report()

            # Unique suffix per item so re-generating the same line/voice never
            # overwrites or reuses a previous file.
            filename = (
                f"tts_{voice_name}_{plan['voice_num']}_{sanitize_filename(text)}"
                f"_{uuid.uuid4().hex[:8]}.wav"
            )
            output_path = os.path.normpath(os.path.join(str(sounds_out), filename))

            in_flight += 1
            try:
                real_duration_seconds = await generate_tts_item(
                    tts_service, text, output_path, plan["gemini_voice"], match.language_code,
                    tts_model, dbfs, style or None, on_wait=on_wait,
                )
            except TtsCancelled:
                return
            except TtsDailyQuotaError as exc:
                daily_quota.append(exc)
                n_failed += 1
                return
            except Exception as exc:
                errors.append(f"{display_short}: {exc}")
                n_failed += 1
                return
            finally:
                in_flight -= 1
                waiting_s.pop(idx, None)
                await report()

            completed_sounds.append({
                "id": f"tts_{prompt_index}_{copy_index}_{voice_name}",
                "prompt": text,
                "prompt_index": prompt_index,
                "copy_index": copy_index,
                "total_copies": total_copies,
                # Echo back the original card index for speech lines so the frontend
                # can look up the correct SoundGenerationConfig via speech_card_index.
                "speech_card_index": item.get("speech_card_index"),
                # Prefer the caller-supplied display name (the character label, e.g.
                # "Alex") over an internal "{voice} speech {n}" placeholder so 3D
                # sound spheres are named after the character, not the TTS voice.
                "display_name": display_name,
                "url": f"{url_prefix}/{filename}",
                "duration": round(real_duration_seconds, 3),
                "position": item.get("position", [0, 0, 0]),
                "volume_dbfs": dbfs,
                "voice_name": voice_name,
                "voice_style": style,
            })
            await report()

        await report()
        await asyncio.gather(*(generate_line(plan) for plan in plans))

        if await job_store.is_cancel_requested(job_id):
            raise TtsCancelled()  # start_io_job marks the job cancelled

        # Consistency with the text-to-audio flow: if nothing could be
        # generated, surface the failure instead of an empty "done" result.
        if daily_quota:
            not_done = n_total - len(completed_sounds)
            message = f"{daily_quota[0]}: {not_done}/{n_total} speech lines not generated"
            if not completed_sounds:
                await job_store.fail(job_id, message)
                return
            # Keep the finished lines; the reason stays in the job's status text.
            await job_store.set_progress(job_id, 98, message, partial=completed_sounds)
            await job_store.complete(job_id, completed_sounds)
            return
        if not completed_sounds and errors:
            await job_store.fail(job_id, "TTS generation failed — " + "; ".join(errors[:3]))
            return

        await job_store.set_progress(job_id, 98, "Finalizing...", partial=completed_sounds)
        await job_store.complete(job_id, completed_sounds)

    job_id = await start_io_job(JOB_TYPE_TTS, session_id, _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)
