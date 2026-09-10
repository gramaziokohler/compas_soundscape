"""
Sound Event Detection (SED) Analysis Router

POST /api/analyze-sound-events
  Saves uploaded file, enqueues a "sed" job on the Redis job store, returns
  {job_id, position, total} immediately. Poll/cancel via
  GET/POST /api/jobs/{job_id}(/cancel) — see routers/jobs.py.

GET  /api/sed-model-info
  Static YAMNet model info (no model loading required).
"""

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, UploadFile, HTTPException, Form, Request

from services.job_store import job_store
from models.schemas import JobEnqueueResponse
from config.constants import (
    TEMP_UPLOADS_DIR,
    TARGET_SAMPLE_RATE,
    FRAME_HOP_SECONDS,
    FRAME_WINDOW_SECONDS,
    JOB_TYPE_SED,
)

router = APIRouter()


@router.post("/api/analyze-sound-events", response_model=JobEnqueueResponse)
async def analyze_sound_events(
    file: UploadFile = File(...),
    num_sounds: int = Form(10),
    analyze_amplitudes: bool = Form(True),
    analyze_durations: bool = Form(True),
    top_n_classes: int = Form(100),
    req: Request = None,
):
    task_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None) if req else None

    # Save uploaded file before enqueuing (file stream must be consumed in this request)
    os.makedirs(TEMP_UPLOADS_DIR, exist_ok=True)
    audio_path = os.path.join(TEMP_UPLOADS_DIR, f"sed_upload_{task_id}_{file.filename}")

    try:
        content = await file.read()
        with open(audio_path, "wb") as f:
            f.write(content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {str(exc)}")

    payload = {
        "variant": "sed",
        "kwargs": dict(
            task_id=task_id,
            audio_file_path=audio_path,
            num_sounds=num_sounds,
            top_n_classes=top_n_classes,
            analyze_amplitudes=analyze_amplitudes,
            analyze_durations=analyze_durations,
        ),
    }

    job_id = await job_store.enqueue(JOB_TYPE_SED, session_id, payload)
    view = await job_store.get(job_id)
    print(f"SED analysis {job_id} queued at position {view.position} of {view.total}")
    return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)


@router.get("/api/sed-model-info")
async def get_sed_model_info():
    return {
        "model_name": "YAMNet",
        "num_classes": 521,
        "sample_rate": TARGET_SAMPLE_RATE,
        "frame_hop_seconds": FRAME_HOP_SECONDS,
        "frame_window_seconds": FRAME_WINDOW_SECONDS,
    }

