"""
Stable Audio 3 transform endpoint — audio-to-audio (restyle) and inpainting /
continuation, used by the FX panel's Stable Audio effect.

The FX editor bounces the source (or the FX chain up to the Stable Audio stage)
to a WAV in the browser, uploads it here, and this endpoint enqueues an `sa3`
job (services/job_store.py). The client polls GET /api/jobs/{id} and reads the
generated file URL from the job result.

This router never imports `stable_audio_3` — that lives only in the isolated
worker process (workers/sa3_runner.py, --role sa3).
"""
from __future__ import annotations

import hashlib
import json
import os
import traceback
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request

from services.job_store import job_store, GpuQueueFullError
from services.paths import user_sounds_dir
from models.schemas import JobEnqueueResponse
from config.constants import (
    GENERATED_SOUND_URL_PREFIX,
    DEFAULT_DBFS,
    JOB_TYPE_SA3,
    AUDIO_MODEL_SA3,
    STABLE_AUDIO_SOURCE_DIR,
    STABLE_AUDIO_MODEL_NAME,
    STABLE_AUDIO_DEFAULT_STEPS,
    STABLE_AUDIO_DEFAULT_CFG_SCALE,
    STABLE_AUDIO_DEFAULT_INIT_NOISE_LEVEL,
    STABLE_AUDIO_DEFAULT_DURATION_PADDING_S,
    STABLE_AUDIO_DEFAULT_SAMPLER,
    STABLE_AUDIO_MODE_RESTYLE,
    STABLE_AUDIO_MODE_INPAINT,
    STABLE_AUDIO_MODE_EXTEND,
    STABLE_AUDIO_MAX_INPAINT_REGIONS,
    FILENAME_MAX_LENGTH,
    WINDOWS_ILLEGAL_FILENAME_CHARS,
)

router = APIRouter()

_TRANSFORM_MODES = (STABLE_AUDIO_MODE_RESTYLE, STABLE_AUDIO_MODE_INPAINT, STABLE_AUDIO_MODE_EXTEND)


def _sanitize(text: str, max_len: int = FILENAME_MAX_LENGTH) -> str:
    out = (text or "audio")[:max_len]
    for char in WINDOWS_ILLEGAL_FILENAME_CHARS:
        out = out.replace(char, "_")
    return out.replace(" ", "_") or "audio"


def _parse_regions(raw: str) -> list[list[float]]:
    try:
        data = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="regions must be valid JSON")
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail="regions must be a list of [start, end] pairs")
    regions: list[list[float]] = []
    for item in data[:STABLE_AUDIO_MAX_INPAINT_REGIONS]:
        if not (isinstance(item, (list, tuple)) and len(item) == 2):
            raise HTTPException(status_code=400, detail="Each region must be [start, end]")
        try:
            start, end = float(item[0]), float(item[1])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Region bounds must be numbers")
        if start < 0 or end <= start:
            raise HTTPException(status_code=400, detail="Each region must have 0 <= start < end")
        regions.append([start, end])
    return regions


@router.post("/api/stable-audio/transform", response_model=JobEnqueueResponse)
async def stable_audio_transform(
    req: Request,
    audio: UploadFile = File(...),
    mode: str = Form(STABLE_AUDIO_MODE_RESTYLE),
    prompt: str = Form(""),
    negative_prompt: str = Form(""),
    strength: float = Form(STABLE_AUDIO_DEFAULT_INIT_NOISE_LEVEL),
    steps: int = Form(STABLE_AUDIO_DEFAULT_STEPS),
    cfg_scale: float = Form(STABLE_AUDIO_DEFAULT_CFG_SCALE),
    seed: int = Form(-1),
    duration: float = Form(0.0),
    regions: str = Form("[]"),
    duration_padding_sec: float = Form(STABLE_AUDIO_DEFAULT_DURATION_PADDING_S),
    sampler_type: str = Form(STABLE_AUDIO_DEFAULT_SAMPLER),
    dbfs: float = Form(DEFAULT_DBFS),
):
    """Enqueue a Stable Audio transform on an uploaded source clip."""
    try:
        if mode not in _TRANSFORM_MODES:
            raise HTTPException(status_code=400, detail=f"mode must be one of {_TRANSFORM_MODES}")

        session_id = getattr(getattr(req, "state", None), "session_id", None)
        if not session_id:
            raise HTTPException(status_code=400, detail="No session cookie")

        parsed_regions = _parse_regions(regions)
        if mode in (STABLE_AUDIO_MODE_INPAINT, STABLE_AUDIO_MODE_EXTEND) and not parsed_regions:
            raise HTTPException(status_code=400, detail="Inpaint/extend requires at least one region")

        # Stage the uploaded source inside the workspace dir (worker reads it from disk).
        source_dir = os.path.join(STABLE_AUDIO_SOURCE_DIR, session_id)
        os.makedirs(source_dir, exist_ok=True)
        source_token = uuid.uuid4().hex[:8]
        source_name = f"source_{_sanitize(prompt or 'source', 24)}_{source_token}.wav"
        source_path = os.path.join(source_dir, source_name)
        with open(source_path, "wb") as f:
            f.write(await audio.read())

        # Output lands in the servable session sounds dir.
        sounds_out = user_sounds_dir(session_id)
        sounds_out.mkdir(parents=True, exist_ok=True)
        url_prefix = f"{GENERATED_SOUND_URL_PREFIX}/{session_id}"

        param_string = f"{prompt}_{mode}_{strength}_{steps}_{cfg_scale}_{duration}_{regions}_{STABLE_AUDIO_MODEL_NAME}"
        param_hash = hashlib.md5(param_string.encode()).hexdigest()[:8]
        filename = f"{_sanitize(prompt or mode)}_{param_hash}_{source_token}_sa3.wav"

        clip = {
            "id": "sa3_transform_0",
            "prompt": prompt,
            "prompt_index": 0,
            "display_name": prompt or mode,
            "duration": duration if duration and duration > 0 else STABLE_AUDIO_DEFAULT_DURATION_PADDING_S,
            "steps": steps,
            "cfg_scale": cfg_scale,
            "dbfs": dbfs,
            "copy_index": 0,
            "total_copies": 1,
            "position": [0, 0, 0],
            "entity_index": None,
            "interval_seconds": 0,
            "negative_prompt": negative_prompt,
            "generation_mode": mode,
            "sampler_type": sampler_type,
            "duration_padding_sec": duration_padding_sec,
            "init_noise_level": strength,
            "inpaint_regions": parsed_regions,
            "filename": filename,
            "source_path": source_path,  # for reference/debugging; runner uses the keys below
        }
        if mode == STABLE_AUDIO_MODE_RESTYLE:
            clip["init_audio_path"] = source_path
        else:
            clip["inpaint_audio_path"] = source_path

        payload = {
            "clips": [clip],
            "total_clips": 1,
            "completed_sounds": [],
            "apply_denoising": False,
            "trim_silence": False,
            "audio_model": AUDIO_MODEL_SA3,
            "output_dir": str(sounds_out),
            "url_prefix": url_prefix,
        }

        try:
            job_id = await job_store.enqueue(JOB_TYPE_SA3, session_id, payload)
        except GpuQueueFullError as exc:
            raise HTTPException(status_code=429, detail=str(exc))

        view = await job_store.get(job_id)
        return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)

    except HTTPException:
        raise
    except Exception as exc:
        print(f"Stable Audio transform setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Stable Audio transform failed: {exc}")
