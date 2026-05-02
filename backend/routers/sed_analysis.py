"""
Sound Event Detection (SED) Analysis Router

POST /api/analyze-sound-events
  Saves uploaded file, enqueues SED job, returns task_id immediately.

GET  /api/sed-analysis-status/{task_id}
  Poll for progress, queue position, or completed result.

POST /api/cancel-sed-analysis/{task_id}
  Hard-kill the running subprocess.

GET  /api/sed-model-info
  Static YAMNet model info (no model loading required).
"""

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, UploadFile, HTTPException, Form

from services.sed_worker import run_sed_analysis
from services.task_queue import unified_queue, make_subprocess_runner
from models.schemas import SEDAnalysisStartResponse, SEDAnalysisStatusResponse
from config.constants import (
    TEMP_UPLOADS_DIR,
    TEMP_SIMULATIONS_DIR,
    SED_TASK_CLEANUP_DELAY_SECONDS,
    TARGET_SAMPLE_RATE,
    FRAME_HOP_SECONDS,
    FRAME_WINDOW_SECONDS,
)

router = APIRouter()

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
TEMP_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/api/analyze-sound-events", response_model=SEDAnalysisStartResponse)
async def analyze_sound_events(
    file: UploadFile = File(...),
    num_sounds: int = Form(10),
    analyze_amplitudes: bool = Form(True),
    analyze_durations: bool = Form(True),
    top_n_classes: int = Form(100),
):
    task_id = str(uuid.uuid4())

    # Save uploaded file before enqueuing (file stream must be consumed in this request)
    os.makedirs(TEMP_UPLOADS_DIR, exist_ok=True)
    audio_path = os.path.join(TEMP_UPLOADS_DIR, f"sed_upload_{task_id}_{file.filename}")

    try:
        content = await file.read()
        with open(audio_path, "wb") as f:
            f.write(content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {str(exc)}")

    progress_file = str(TEMP_DIR / f"sed_progress_{task_id}.json")
    result_file = str(TEMP_DIR / f"sed_result_{task_id}.json")

    worker_kwargs = dict(
        task_id=task_id,
        progress_file=progress_file,
        result_file=result_file,
        audio_file_path=audio_path,
        num_sounds=num_sounds,
        top_n_classes=top_n_classes,
        analyze_amplitudes=analyze_amplitudes,
        analyze_durations=analyze_durations,
    )

    run_fn = make_subprocess_runner(
        run_sed_analysis,
        worker_kwargs,
        progress_file,
        result_file,
        error_prefix="SED analysis",
    )

    pos, total = unified_queue.enqueue(task_id, "sed", run_fn, SED_TASK_CLEANUP_DELAY_SECONDS)
    print(f"SED analysis {task_id} queued at position {pos} of {total}")
    return SEDAnalysisStartResponse(task_id=task_id)


@router.get("/api/sed-analysis-status/{task_id}", response_model=SEDAnalysisStatusResponse)
async def get_sed_analysis_status(task_id: str):
    task = unified_queue.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="SED analysis task not found")

    q_pos, q_total = unified_queue.get_queue_status(task_id)
    status_str = f"Queued — position {q_pos} of {q_total}" if q_pos is not None else task.status

    return SEDAnalysisStatusResponse(
        task_id=task_id,
        progress=task.progress,
        status=status_str,
        completed=task.completed,
        cancelled=task.cancelled,
        error=task.error,
        result=task.result if (task.completed and not task.error and not task.cancelled) else None,
        queue_position=q_pos,
        queue_total=q_total,
    )


@router.post("/api/cancel-sed-analysis/{task_id}")
async def cancel_sed_analysis(task_id: str):
    if not unified_queue.get_task(task_id):
        raise HTTPException(status_code=404, detail="SED analysis task not found")
    unified_queue.cancel(task_id)
    return {"cancelled": True}


@router.get("/api/sed-model-info")
async def get_sed_model_info():
    return {
        "model_name": "YAMNet",
        "num_classes": 521,
        "sample_rate": TARGET_SAMPLE_RATE,
        "frame_hop_seconds": FRAME_HOP_SECONDS,
        "frame_window_seconds": FRAME_WINDOW_SECONDS,
    }
