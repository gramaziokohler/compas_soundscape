"""
Sound generation endpoints.

POST /api/generate-sounds
  Validates input, queues the job, returns generation_id immediately.
  ML generation runs in a subprocess (one job at a time, FIFO).

GET  /api/sound-generation-status/{generation_id}
  Poll for progress, queue position, or completed result.

POST /api/cancel-sound-generation/{generation_id}
  Kill the subprocess immediately (hard kill).
"""
from __future__ import annotations

import json
import os
import tempfile
import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import FileResponse

from services.audio_service import AudioService
from services.sounds_worker import run_sound_generation
from services.task_queue import unified_queue, make_subprocess_runner
from services.paths import user_sounds_dir
from models.schemas import (
    SoundGenerationRequest,
    SoundGenerationStartResponse,
    SoundGenerationStatusResponse,
)
from config.constants import (
    GENERATED_SOUNDS_DIR,
    GENERATED_SOUND_URL_PREFIX,
    DEFAULT_DBFS,
    DEFAULT_AUDIO_MODEL,
    SOUND_GENERATION_TASK_CLEANUP_DELAY_SECONDS,
    TEMP_SIMULATIONS_DIR,
    TEMP_PARENT_DIR,
)

router = APIRouter()

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# Injected by main.py
audio_service = None


def init_sounds_router(service: AudioService):
    global audio_service
    audio_service = service


# ─── Generate sounds (async) ──────────────────────────────────────────────────

@router.post("/api/generate-sounds", response_model=SoundGenerationStartResponse)
async def generate_sounds(request: SoundGenerationRequest, req: Request):
    """
    Enqueue ML sound generation.  Returns generation_id immediately.
    Poll GET /api/sound-generation-status/{generation_id} for updates.
    """
    generation_id = str(uuid.uuid4())

    try:
        ml_configs = [s for s in request.sounds if s.get("prompt", "").strip()]
        if not ml_configs:
            raise HTTPException(status_code=400, detail="No valid sound prompts provided")

        progress_file = str(TEMP_DIR / f"sound_progress_{generation_id}.json")
        result_file   = str(TEMP_DIR / f"sound_result_{generation_id}.json")

        # Per-session output directory
        session_id = getattr(getattr(req, "state", None), "session_id", None)
        if not session_id:
            raise HTTPException(status_code=400, detail="No session cookie")

        sounds_out = user_sounds_dir(session_id)
        sounds_out.mkdir(parents=True, exist_ok=True)
        url_prefix = f"{GENERATED_SOUND_URL_PREFIX}/{session_id}"

        worker_kwargs = dict(
            generation_id=generation_id,
            progress_file=progress_file,
            result_file=result_file,
            sound_configs=ml_configs,
            apply_denoising=request.apply_denoising,
            trim_silence=request.trim_silence,
            audio_model=request.audio_model or DEFAULT_AUDIO_MODEL,
            base_dbfs=request.base_dbfs,
            output_dir=str(sounds_out),
            url_prefix=url_prefix,
        )

        run_fn = make_subprocess_runner(
            run_sound_generation,
            worker_kwargs,
            progress_file,
            result_file,
            error_prefix="Sound generation",
        )

        pos, total = unified_queue.enqueue(
            generation_id, "sound", run_fn, SOUND_GENERATION_TASK_CLEANUP_DELAY_SECONDS
        )
        print(f"Sound generation {generation_id} queued at position {pos} of {total}")
        return SoundGenerationStartResponse(generation_id=generation_id)

    except HTTPException:
        raise
    except Exception as exc:
        print(f"Sound generation setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Sound generation setup failed: {str(exc)}")


# ─── Status endpoint ──────────────────────────────────────────────────────────

@router.get(
    "/api/sound-generation-status/{generation_id}",
    response_model=SoundGenerationStatusResponse,
)
async def get_sound_generation_status(generation_id: str):
    task = unified_queue.get_task(generation_id)
    if not task:
        raise HTTPException(status_code=404, detail="Sound generation task not found")

    q_pos, q_total = unified_queue.get_queue_status(generation_id)
    status_str = f"Queued — position {q_pos} of {q_total}" if q_pos is not None else task.status

    return SoundGenerationStatusResponse(
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


# ─── Cancel endpoint ──────────────────────────────────────────────────────────

@router.post("/api/cancel-sound-generation/{generation_id}")
async def cancel_sound_generation(generation_id: str):
    """Immediately kills a running subprocess, or removes a queued job."""
    if not unified_queue.get_task(generation_id):
        raise HTTPException(status_code=404, detail="Sound generation task not found")
    unified_queue.cancel(generation_id)
    return {"cancelled": True}


# ─── Other sound endpoints ─────────────────────────────────────────────────────

@router.post("/api/cleanup-generated-sounds")
async def cleanup_generated_sounds(req: Request):
    try:
        session_id = getattr(getattr(req, "state", None), "session_id", None)
        if session_id:
            session_dir = str(user_sounds_dir(session_id))
        else:
            session_dir = GENERATED_SOUNDS_DIR
        audio_service.cleanup_generated_sounds(output_dir=session_dir)
        return {"message": "Cleanup successful"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error during cleanup: {str(e)}")


@router.post("/api/calibrate-audio")
async def calibrate_audio(
    audio: UploadFile = File(...),
    dbfs: float = Form(DEFAULT_DBFS),
    apply_denoising: bool = Form(False),
    trim_silence: bool = Form(False),
    req: Request = None,
):
    """
    Normalize RMS + apply dBFS calibration to any uploaded audio file.
    Returns a static URL to the calibrated WAV file.
    """
    tmp_input = None
    try:
        ext = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
        tmp_input = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        tmp_input.write(await audio.read())
        tmp_input.close()

        session_id = getattr(getattr(req, "state", None), "session_id", None)
        if session_id:
            out_dir = str(user_sounds_dir(session_id))
        else:
            out_dir = GENERATED_SOUNDS_DIR
        os.makedirs(out_dir, exist_ok=True)

        filename = f"calibrated_{uuid.uuid4().hex}_{int(dbfs)}dBFS.wav"
        output_path = os.path.join(out_dir, filename)

        audio_service.calibrate_audio_file(
            tmp_input.name,
            output_path,
            target_dbfs=dbfs,
            apply_denoising=apply_denoising,
            trim_silence=trim_silence,
        )

        url_prefix = f"{GENERATED_SOUND_URL_PREFIX}/{session_id}" if session_id else GENERATED_SOUND_URL_PREFIX
        return {"url": f"{url_prefix}/{filename}"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calibration failed: {str(e)}")

    finally:
        if tmp_input and os.path.exists(tmp_input.name):
            os.unlink(tmp_input.name)


@router.get("/api/sample-audio")
async def get_sample_audio():
    try:
        sample_audio_path = os.path.join("data", "Le Corbeau et le Renard (french).wav")
        if not os.path.exists(sample_audio_path):
            raise HTTPException(status_code=404, detail="Sample audio file not found")
        return FileResponse(
            path=sample_audio_path,
            media_type="audio/wav",
            filename="Le Corbeau et le Renard (french).wav",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving sample audio: {str(e)}")


# ─── Screenshots ──────────────────────────────────────────────────────────────

SCREENSHOT_CAPTURE_PREFIX = "live_capture_"
SCREENSHOTS_DIR = TEMP_PARENT_DIR


def _list_screenshot_files() -> list[str]:
    if not os.path.isdir(SCREENSHOTS_DIR):
        return []
    return sorted(
        f for f in os.listdir(SCREENSHOTS_DIR)
        if f.startswith(SCREENSHOT_CAPTURE_PREFIX) and f.endswith(".png")
    )


@router.post("/api/screenshot")
async def save_screenshot(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    image = body.get("image", "")
    if not isinstance(image, str) or not image.startswith("data:image/"):
        raise HTTPException(status_code=400, detail='Body must contain an "image" field with a data URI')

    base64_data = image.split(",", 1)[-1] if "," in image else image
    filename = f"{SCREENSHOT_CAPTURE_PREFIX}{uuid.uuid4().hex[:8]}.png"
    filepath = os.path.join(SCREENSHOTS_DIR, filename)

    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    try:
        with open(filepath, "wb") as f:
            f.write(__import__("base64").b64decode(base64_data))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save screenshot: {str(e)}")

    return {"image": image, "savedPath": filepath}


@router.get("/api/screenshot")
async def list_screenshots():
    files = _list_screenshot_files()
    if not files:
        return {"images": [], "count": 0}
    images = []
    for f in files:
        filepath = os.path.join(SCREENSHOTS_DIR, f)
        try:
            with open(filepath, "rb") as fh:
                data = __import__("base64").b64encode(fh.read()).decode("ascii")
            images.append(f"data:image/png;base64,{data}")
        except Exception:
            pass
    return {"images": images, "count": len(images)}


@router.delete("/api/screenshot")
async def delete_screenshots():
    files = _list_screenshot_files()
    deleted = 0
    for f in files:
        try:
            os.unlink(os.path.join(SCREENSHOTS_DIR, f))
            deleted += 1
        except Exception:
            pass
    return {"deleted": deleted}
