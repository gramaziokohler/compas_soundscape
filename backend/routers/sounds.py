"""
Sound generation endpoints.

POST /api/generate-sounds
  Validates input, builds a flat clip plan, enqueues a "sound" job on the
  Redis job store (services/job_store.py), returns {job_id, position, total}
  immediately. Poll/cancel via GET/POST /api/jobs/{job_id}(/cancel) — see
  routers/jobs.py. Generation itself runs in a resident GPU worker process
  (workers/gpu_runner.py), not a per-request subprocess.
"""
from __future__ import annotations

import hashlib
import os
import tempfile
import traceback
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from services.audio_service import AudioService
from services.job_store import job_store, GpuQueueFullError
from services.paths import user_sounds_dir
from utils.audio_processing import compute_noise_trim_region_from_file
from models.schemas import (
    SoundGenerationRequest,
    DeleteGeneratedSoundsRequest,
    JobEnqueueResponse,
)
from config.constants import (
    GENERATED_SOUNDS_DIR,
    GENERATED_SOUND_URL_PREFIX,
    DEFAULT_DBFS,
    DEFAULT_AUDIO_MODEL,
    DEFAULT_DURATION_SECONDS,
    DEFAULT_GUIDANCE_SCALE,
    DEFAULT_DIFFUSION_STEPS,
    DEFAULT_SEED_COPIES,
    DEFAULT_INTERVAL_BETWEEN_SOUNDS,
    FILENAME_MAX_LENGTH,
    PARAM_HASH_LENGTH,
    WINDOWS_ILLEGAL_FILENAME_CHARS,
    JOB_TYPE_SOUND,
    TEMP_PARENT_DIR,
)

router = APIRouter()

# Injected by main.py
audio_service = None


def init_sounds_router(service: AudioService):
    global audio_service
    audio_service = service


def _build_clip_plan(sound_configs: list[dict], apply_denoising: bool, audio_model: str, base_dbfs: float | None) -> list[dict]:
    """Flatten sound_configs (one entry per prompt, seed_copies>=1) into one
    descriptor per individual audio file ("clip") to generate.

    Filenames embed a per-request unique token, so a new generation NEVER
    reuses a previous request's artifact — even for an identical prompt. This
    is what makes "send to sounds / regenerate" produce genuinely fresh audio
    instead of silently returning the old file (the deterministic hash alone
    caused cross-run and cross-model reuse).
    """
    clips: list[dict] = []
    # One token per plan → unique filenames for every clip in this request.
    run_token = uuid.uuid4().hex[:8]
    for idx, cfg in enumerate(sound_configs):
        prompt = cfg.get("prompt", "")
        if not prompt:
            continue
        duration = cfg.get("duration_seconds") or cfg.get("duration", DEFAULT_DURATION_SECONDS)
        guidance_scale = cfg.get("guidance_scale", DEFAULT_GUIDANCE_SCALE)
        seed_copies = cfg.get("seed_copies", DEFAULT_SEED_COPIES)
        steps = cfg.get("steps", DEFAULT_DIFFUSION_STEPS)
        dbfs = cfg.get("dbfs") if cfg.get("dbfs") is not None else (base_dbfs if base_dbfs is not None else DEFAULT_DBFS)
        interval_seconds = cfg.get("interval_seconds", DEFAULT_INTERVAL_BETWEEN_SOUNDS)
        negative_prompt = cfg.get("negative_prompt", "")
        display_name = cfg.get("display_name") or prompt

        short_prompt = prompt[:FILENAME_MAX_LENGTH]
        for char in WINDOWS_ILLEGAL_FILENAME_CHARS:
            short_prompt = short_prompt.replace(char, "_")
        short_prompt = short_prompt.replace(" ", "_")

        param_string = f"{prompt}_{duration}_{guidance_scale}_{steps}_{apply_denoising}_{audio_model}"
        regeneration_ts = cfg.get("_regeneration_ts", "")
        if regeneration_ts:
            param_string += f"_{regeneration_ts}"
        param_hash = hashlib.md5(param_string.encode()).hexdigest()[:PARAM_HASH_LENGTH]

        entity = cfg.get("entity")
        if entity and entity.get("position"):
            position = entity["position"]
            entity_index = entity.get("index")
        else:
            position = [0, 0, 0]
            entity_index = None

        for copy_idx in range(seed_copies):
            clips.append({
                "id": f"generated_{idx}_{copy_idx}",
                "prompt": prompt,
                "prompt_index": idx,
                "display_name": display_name,
                "duration": duration,
                "guidance_scale": guidance_scale,
                "steps": steps,
                "dbfs": dbfs,
                "copy_index": copy_idx,
                "total_copies": seed_copies,
                "position": position,
                "entity_index": entity_index,
                "interval_seconds": interval_seconds,
                "negative_prompt": negative_prompt,
                "filename": f"{short_prompt}_{param_hash}_{run_token}_copy{copy_idx}.wav",
            })
    return clips


# ─── Generate sounds (async) ──────────────────────────────────────────────────

@router.post("/api/generate-sounds", response_model=JobEnqueueResponse)
async def generate_sounds(request: SoundGenerationRequest, req: Request):
    """
    Enqueue ML sound generation on the GPU job queue. Returns {job_id, position,
    total} immediately. Poll GET /api/jobs/{job_id} for progress/partials/result.
    """
    try:
        ml_configs = [s for s in request.sounds if s.get("prompt", "").strip()]
        if not ml_configs:
            raise HTTPException(status_code=400, detail="No valid sound prompts provided")

        # Per-session output directory
        session_id = getattr(getattr(req, "state", None), "session_id", None)
        if not session_id:
            raise HTTPException(status_code=400, detail="No session cookie")

        sounds_out = user_sounds_dir(session_id)
        sounds_out.mkdir(parents=True, exist_ok=True)
        url_prefix = f"{GENERATED_SOUND_URL_PREFIX}/{session_id}"

        audio_model = request.audio_model or DEFAULT_AUDIO_MODEL
        clips = _build_clip_plan(ml_configs, request.apply_denoising, audio_model, request.base_dbfs)
        if not clips:
            raise HTTPException(status_code=400, detail="No valid sound prompts provided")

        payload = {
            "clips": clips,
            "total_clips": len(clips),
            "completed_sounds": [],
            "apply_denoising": request.apply_denoising,
            "trim_silence": request.trim_silence,
            "audio_model": audio_model,
            "output_dir": str(sounds_out),
            "url_prefix": url_prefix,
        }

        try:
            job_id = await job_store.enqueue(JOB_TYPE_SOUND, session_id, payload)
        except GpuQueueFullError as exc:
            raise HTTPException(status_code=429, detail=str(exc))

        view = await job_store.get(job_id)
        print(f"Sound generation {job_id} queued at position {view.position} of {view.total}")
        return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)

    except HTTPException:
        raise
    except Exception as exc:
        print(f"Sound generation setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Sound generation setup failed: {str(exc)}")


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


@router.post("/api/delete-generated-sounds")
async def delete_generated_sounds(request: DeleteGeneratedSoundsRequest, req: Request):
    """
    Delete specific generated sound files by their static URLs (session-scoped).

    Called when a scenario's child sound scene is replaced — without removing the
    old files, regenerating the same foley/speech prompts would dedup to the
    existing files (deterministic filename hash) and return the old audio.
    Only files inside the caller's session directory are touched.
    """
    session_id = getattr(getattr(req, "state", None), "session_id", None)
    if not session_id:
        raise HTTPException(status_code=400, detail="No session cookie")

    session_dir = user_sounds_dir(session_id).resolve()
    deleted = 0
    for url in request.urls:
        filename = os.path.basename(url.split("?", 1)[0])
        if not filename or filename in {".", ".."}:
            continue
        target = (session_dir / filename).resolve()
        # Path-traversal guard — only delete files directly inside the session dir.
        if target.parent != session_dir:
            continue
        try:
            if target.is_file():
                target.unlink()
                deleted += 1
        except OSError:
            continue
    return {"deleted": deleted}


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

        await run_in_threadpool(
            audio_service.calibrate_audio_file,
            tmp_input.name,
            output_path,
            target_dbfs=dbfs,
            apply_denoising=apply_denoising,
        )

        url_prefix = f"{GENERATED_SOUND_URL_PREFIX}/{session_id}" if session_id else GENERATED_SOUND_URL_PREFIX
        response: dict = {"url": f"{url_prefix}/{filename}"}
        if trim_silence:
            response["noise_trim"] = await run_in_threadpool(
                compute_noise_trim_region_from_file, output_path
            )
        return response

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
