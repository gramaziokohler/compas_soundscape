"""
Text-to-Speech generation endpoints.

POST /api/generate-tts
  Validates input, queues the job, returns generation_id immediately.
  TTS generation runs in a subprocess.

GET  /api/tts-generation-status/{generation_id}
  Poll for progress, queue position, or completed result.

POST /api/cancel-tts-generation/{generation_id}
  Kill the subprocess immediately (hard kill).
"""
from __future__ import annotations

import os
import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from services.tts_service import TTSService
from services.tts_worker import run_tts_generation
from services.task_queue import unified_queue, make_subprocess_runner
from services.paths import user_sounds_dir
from models.schemas import (
    TTSGenerationRequest,
    TTSGenerationStartResponse,
    TTSGenerationStatusResponse,
)
from config.constants import (
    GENERATED_SOUNDS_DIR,
    GENERATED_SOUND_URL_PREFIX,
    TTS_TASK_CLEANUP_DELAY_SECONDS,
    TEMP_SIMULATIONS_DIR,
    TTS_AVAILABLE_MODELS,
    DEFAULT_TTS_MODEL,
)

router = APIRouter()

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

tts_service = None


def init_tts_router(service: TTSService):
    global tts_service
    tts_service = service


@router.post("/api/generate-tts", response_model=TTSGenerationStartResponse)
async def generate_tts(request: TTSGenerationRequest, req: Request):
    generation_id = str(uuid.uuid4())

    try:
        valid_texts = [t for t in request.texts if (t.get("text") or "").strip()]
        if not valid_texts:
            raise HTTPException(status_code=400, detail="No valid text entries provided")

        progress_file = str(TEMP_DIR / f"tts_progress_{generation_id}.json")
        result_file = str(TEMP_DIR / f"tts_result_{generation_id}.json")

        session_id = getattr(getattr(req, "state", None), "session_id", None)
        if not session_id:
            raise HTTPException(status_code=400, detail="No session cookie")

        tts_model = request.tts_model or DEFAULT_TTS_MODEL
        if tts_model not in TTS_AVAILABLE_MODELS:
            raise HTTPException(status_code=400, detail=f"Unknown TTS model: {tts_model}")

        sounds_out = user_sounds_dir(session_id)
        sounds_out.mkdir(parents=True, exist_ok=True)
        url_prefix = f"{GENERATED_SOUND_URL_PREFIX}/{session_id}"

        worker_kwargs = dict(
            generation_id=generation_id,
            progress_file=progress_file,
            result_file=result_file,
            texts=valid_texts,
            output_dir=str(sounds_out),
            url_prefix=url_prefix,
            language=request.language,
            tts_model=tts_model,
        )

        run_fn = make_subprocess_runner(
            run_tts_generation,
            worker_kwargs,
            progress_file,
            result_file,
            error_prefix="TTS generation",
        )

        pos, total = unified_queue.enqueue(
            generation_id, "tts", run_fn, TTS_TASK_CLEANUP_DELAY_SECONDS
        )
        print(f"TTS generation {generation_id} queued at position {pos} of {total}")
        return TTSGenerationStartResponse(generation_id=generation_id)

    except HTTPException:
        raise
    except Exception as exc:
        print(f"TTS generation setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"TTS generation setup failed: {str(exc)}")


@router.get(
    "/api/tts-generation-status/{generation_id}",
    response_model=TTSGenerationStatusResponse,
)
async def get_tts_generation_status(generation_id: str):
    task = unified_queue.get_task(generation_id)
    if not task:
        raise HTTPException(status_code=404, detail="TTS generation task not found")

    q_pos, q_total = unified_queue.get_queue_status(generation_id)
    status_str = f"Queued — position {q_pos} of {q_total}" if q_pos is not None else task.status

    if task.completed and not task.error and not task.cancelled and task.result:
        durations = ", ".join(
            f"{item.get('id')}={item.get('duration')}"
            for item in task.result if isinstance(item, dict)
        )
    elif task.partial_sounds:
        durations = ", ".join(
            f"{item.get('id')}={item.get('duration')}"
            for item in task.partial_sounds if isinstance(item, dict)
        )
    return TTSGenerationStatusResponse(
        generation_id=generation_id,
        progress=task.progress,
        status=status_str,
        completed=task.completed,
        cancelled=task.cancelled,
        error=task.error,
        result=task.result if (task.completed and not task.error and not task.cancelled) else None,
        partial_sounds=task.partial_sounds,
        queue_position=q_pos,
        queue_total=q_total,
    )


@router.post("/api/cancel-tts-generation/{generation_id}")
async def cancel_tts_generation(generation_id: str):
    if not unified_queue.get_task(generation_id):
        raise HTTPException(status_code=404, detail="TTS generation task not found")
    unified_queue.cancel(generation_id)
    return {"cancelled": True}
