"""
Loop Analysis Router

POST /api/analyze-loop
  Detects a seamless loop region for an existing generated sound. Enqueues a
  "loop" job on the Redis job store and returns {job_id, position, total}
  immediately. Poll via GET /api/jobs/{job_id} — see routers/jobs.py.
  Result shape: {start, end} fractions, matching the trim_silence
  noise_trim contract.
"""

import os
import uuid

from fastapi import APIRouter, HTTPException, Request

from services.job_store import job_store
from services.paths import user_audio_dir, user_sounds_dir
from models.schemas import LoopAnalysisRequest, JobEnqueueResponse
from config.constants import GENERATED_SOUNDS_DIR, JOB_TYPE_LOOP

router = APIRouter()


def _resolve_audio_path(sound_url: str, session_id: str | None) -> str:
    """Resolve a sound URL (/static/sounds/generated/<sid>/<file>.wav) to a disk path.

    Checks the session's generated-sounds dir, the shared dir, and the restored
    soundscape audio dir in that order (mirrors reprocess.py + persistence load).
    """
    filename = os.path.basename(sound_url)
    if not filename:
        raise HTTPException(status_code=400, detail="Invalid sound_url")

    candidates: list[str] = []
    if session_id:
        candidates.append(str(user_sounds_dir(session_id) / filename))
        candidates.append(str(user_audio_dir(session_id) / filename))
    candidates.append(os.path.join(GENERATED_SOUNDS_DIR, filename))

    for path in candidates:
        if os.path.exists(path):
            return path

    raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")


@router.post("/api/analyze-loop", response_model=JobEnqueueResponse)
async def analyze_loop(request: LoopAnalysisRequest, req: Request):
    analysis_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None)

    audio_path = _resolve_audio_path(request.sound_url, session_id)

    payload = {
        "variant": "loop",
        "kwargs": dict(task_id=analysis_id, audio_file_path=audio_path),
    }

    job_id = await job_store.enqueue(JOB_TYPE_LOOP, session_id, payload)
    view = await job_store.get(job_id)
    print(f"[loop-analysis] {job_id} queued at position {view.position} of {view.total} (file={audio_path})")
    return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)

