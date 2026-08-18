"""
Loop Analysis Router

POST /api/analyze-loop
  Detects a seamless loop region for an existing generated sound. Enqueues the
  analysis on the CPU pool (subprocess, same pattern as SED) and returns an
  analysis_id immediately.

GET  /api/analyze-loop-status/{analysis_id}
  Poll for progress, queue position, or the completed loop region
  ({start, end} fractions, matching the trim_silence noise_trim contract).
"""

import os
import uuid

from fastapi import APIRouter, HTTPException, Request

from services.loop_worker import run_loop_analysis
from services.paths import user_audio_dir, user_sounds_dir
from services.task_queue import unified_queue, make_subprocess_runner
from models.schemas import (
    LoopAnalysisRequest,
    LoopAnalysisStartResponse,
    LoopAnalysisStatusResponse,
)
from config.constants import (
    GENERATED_SOUNDS_DIR,
    LOOP_FINDER_TASK_CLEANUP_DELAY_SECONDS,
    TEMP_SIMULATIONS_DIR,
)

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


@router.post("/api/analyze-loop", response_model=LoopAnalysisStartResponse)
async def analyze_loop(request: LoopAnalysisRequest, req: Request):
    analysis_id = str(uuid.uuid4())
    session_id = getattr(getattr(req, "state", None), "session_id", None)

    audio_path = _resolve_audio_path(request.sound_url, session_id)

    progress_file = os.path.join(TEMP_SIMULATIONS_DIR, f"loop_progress_{analysis_id}.json")
    result_file = os.path.join(TEMP_SIMULATIONS_DIR, f"loop_result_{analysis_id}.json")

    run_fn = make_subprocess_runner(
        run_loop_analysis,
        {
            "task_id": analysis_id,
            "progress_file": progress_file,
            "result_file": result_file,
            "audio_file_path": audio_path,
        },
        progress_file,
        result_file,
        error_prefix="Loop analysis",
    )

    pos, total = unified_queue.enqueue(
        analysis_id, "loop", run_fn, LOOP_FINDER_TASK_CLEANUP_DELAY_SECONDS
    )
    print(f"[loop-analysis] {analysis_id} queued at position {pos} of {total} (file={audio_path})")
    return LoopAnalysisStartResponse(analysis_id=analysis_id)


@router.get("/api/analyze-loop-status/{analysis_id}", response_model=LoopAnalysisStatusResponse)
async def get_loop_analysis_status(analysis_id: str):
    task = unified_queue.get_task(analysis_id)
    if not task:
        raise HTTPException(status_code=404, detail="Loop analysis task not found")

    q_pos, q_total = unified_queue.get_queue_status(analysis_id)
    status_str = f"Queued — position {q_pos} of {q_total}" if q_pos is not None else task.status

    return LoopAnalysisStatusResponse(
        analysis_id=analysis_id,
        progress=task.progress,
        status=status_str,
        completed=task.completed,
        cancelled=task.cancelled,
        error=task.error,
        result=task.result if (task.completed and not task.error and not task.cancelled) else None,
        queue_position=q_pos,
        queue_total=q_total,
    )
