"""
Source directivities: built-in presets and the caller's per-user library.

GET    /api/me/directivities              Analytical presets + measured presets + my library
POST   /api/me/directivities/inspect      Quick look at a SOFA / BRAS CSV upload (format, sources)
POST   /api/me/directivities/import       Stage the upload and enqueue the CPU import job
PUT    /api/me/directivities/{id}         Rename
DELETE /api/me/directivities/{id}         Delete (row + balloon file)
GET    /api/directivities/{id}/preview    Polar preview JSON (library, preset or soundscape copy)
GET    /api/directivities/{id}/balloon    Binary balloon for real-time playback (directions + IRs)

Library entries are keyed by ``request.state.user_hash`` like custom materials
(routers/materials.py). The import is a job (``{job_id, position, total}``; poll
GET /api/jobs/{job_id}) whose result carries the new ``DirectivityRecord``.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from starlette.concurrency import run_in_threadpool

from config.constants import (
    DIRECTIVITIES_PER_USER_MAX,
    DIRECTIVITY_MAX_UPLOAD_BYTES,
    DIRECTIVITY_NAME_MAX_LEN,
    DIRECTIVITY_UPLOAD_DIR,
    JOB_TYPE_DIRECTIVITY_IMPORT,
)
from models.schemas import DirectivityInspectResult, DirectivityRecord, DirectivityRenameInput, JobEnqueueResponse
from services.directivity_formats import detect_format, inspect_file
from services.directivity_service import balloon_bytes, delete_library_entry, library_dir, list_for_user, preview_for, to_api
from services.job_store import job_store
from services.metadata_store import metadata_store

router = APIRouter(prefix="/api", tags=["directivities"])


def _require_user(request: Request) -> str:
    user_hash = getattr(request.state, "user_hash", None)
    if not user_hash:
        raise HTTPException(status_code=400, detail="No identity for this session")
    return user_hash


def _state(request: Request, name: str) -> Optional[str]:
    return getattr(getattr(request, "state", None), name, None)


async def _stage_upload(file: UploadFile) -> tuple[Path, str]:
    """Write the upload to the staging dir; returns (path, format)."""
    fmt = detect_format(file.filename or "")
    staging = Path(DIRECTIVITY_UPLOAD_DIR)
    staging.mkdir(parents=True, exist_ok=True)
    path = staging / f"{uuid.uuid4().hex}{Path(file.filename or '').suffix.lower()}"

    def _copy() -> int:
        size = 0
        with open(path, "wb") as out:
            while True:
                chunk = file.file.read(1 << 20)
                if not chunk:
                    break
                size += len(chunk)
                if size > DIRECTIVITY_MAX_UPLOAD_BYTES:
                    raise ValueError(f"File larger than {DIRECTIVITY_MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
                out.write(chunk)
        return size

    try:
        await run_in_threadpool(_copy)
    except ValueError as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc))
    return path, fmt


@router.get("/me/directivities", response_model=list[DirectivityRecord])
async def list_directivities(request: Request) -> list[DirectivityRecord]:
    return list_for_user(_state(request, "user_hash"))


@router.post("/me/directivities/inspect", response_model=DirectivityInspectResult)
async def inspect_directivity(request: Request, file: UploadFile = File(...)) -> DirectivityInspectResult:
    _require_user(request)
    try:
        path, fmt = await _stage_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        info = await run_in_threadpool(inspect_file, path, fmt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read the file: {exc}")
    finally:
        path.unlink(missing_ok=True)
    return DirectivityInspectResult(**info)


@router.post("/me/directivities/import", response_model=JobEnqueueResponse)
async def import_directivity(
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(...),
    sofa_source: Optional[str] = Form(None),
) -> JobEnqueueResponse:
    user_hash = _require_user(request)
    name = name.strip()
    if not name or len(name) > DIRECTIVITY_NAME_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"Name must be 1-{DIRECTIVITY_NAME_MAX_LEN} characters")
    if metadata_store.count_user_directivities(user_hash) >= DIRECTIVITIES_PER_USER_MAX:
        raise HTTPException(status_code=400, detail=f"You can save at most {DIRECTIVITIES_PER_USER_MAX} directivities")
    try:
        path, fmt = await _stage_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    dest_dir = library_dir(user_hash)
    dest_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "variant": "directivity_import",
        "kwargs": dict(
            import_id=str(uuid.uuid4()),
            user_hash=user_hash,
            source_path=str(path),
            fmt=fmt,
            name=name,
            sofa_source=(sofa_source or None),
            dest_dir=str(dest_dir),
        ),
    }
    session_id = _state(request, "session_id")
    job_id = await job_store.enqueue(JOB_TYPE_DIRECTIVITY_IMPORT, session_id, payload)
    view = await job_store.get(job_id)
    print(f"[directivity] import {job_id} queued ({fmt}, {os.path.getsize(path) / 1e6:.1f} MB)")
    return JobEnqueueResponse(job_id=job_id, position=view.position or 1, total=view.total or 1)


@router.put("/me/directivities/{directivity_id}", response_model=DirectivityRecord)
async def rename_directivity(directivity_id: str, payload: DirectivityRenameInput, request: Request) -> DirectivityRecord:
    row = metadata_store.rename_user_directivity(_require_user(request), directivity_id, payload.name)
    if row is None:
        raise HTTPException(status_code=404, detail="Directivity not found")
    return to_api(row)


@router.delete("/me/directivities/{directivity_id}")
async def delete_directivity(directivity_id: str, request: Request) -> dict:
    if not delete_library_entry(_require_user(request), directivity_id):
        raise HTTPException(status_code=404, detail="Directivity not found")
    return {"deleted": directivity_id}


@router.get("/directivities/{directivity_id}/preview")
async def directivity_preview(directivity_id: str, request: Request, model_id: Optional[str] = None) -> dict:
    return await run_in_threadpool(
        preview_for, directivity_id, _state(request, "user_hash"), _state(request, "session_id"), model_id,
    )


@router.get("/directivities/{directivity_id}/balloon")
async def directivity_balloon(directivity_id: str, request: Request, model_id: Optional[str] = None) -> Response:
    """Binary balloon (directions + impulse responses) for real-time playback directivity."""
    payload = await run_in_threadpool(
        balloon_bytes, directivity_id, _state(request, "user_hash"), _state(request, "session_id"), model_id,
    )
    return Response(content=payload, media_type="application/octet-stream", headers={"Cache-Control": "private, max-age=3600"})
