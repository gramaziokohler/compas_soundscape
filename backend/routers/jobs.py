"""
Unified job status/cancel/queue-depth endpoints backed by services/job_store.py.

Domain routers (sounds, pyroomacoustics, choras, sed_analysis, loop_analysis)
enqueue jobs via job_store.enqueue(...) and return {job_id, position, total};
clients poll this router's /api/jobs/{id} for progress/result instead of a
per-domain status route.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request

from config.constants import JOB_CLIENT_META_MAX_BYTES
from services.job_store import job_store, JobNotFoundError
from models.schemas import (
    JobStatusResponse,
    JobCancelResponse,
    JobClientMetaRequest,
    QueueStatusResponse,
)

router = APIRouter()


def _session_id(request: Request) -> str:
    return getattr(getattr(request, "state", None), "session_id", None) or ""


def _to_response(view) -> JobStatusResponse:
    return JobStatusResponse(
        job_id=view.job_id,
        type=view.type,
        status=view.status,
        progress=view.progress,
        status_text=view.status_text,
        queue_position=view.position,
        queue_total=view.total,
        partial=view.partial,
        result=view.result,
        error=view.error,
        client_meta=view.client_meta if isinstance(view.client_meta, dict) else None,
        created=view.created or None,
    )


@router.get("/api/jobs", response_model=list[JobStatusResponse])
async def list_jobs(request: Request):
    """List all jobs for the caller's workspace.

    Lets the client reattach to jobs that started before the window was closed
    (or after local storage was cleared), and lets other members of a shared
    workspace see the owner's in-flight jobs. Scoped by the session cookie —
    never by a query parameter.
    """
    views = await job_store.list_session_jobs(_session_id(request))
    return [_to_response(v) for v in views]


@router.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str):
    try:
        view = await job_store.get(job_id)
    except JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    return _to_response(view)


@router.post("/api/jobs/{job_id}/meta")
async def set_job_client_meta(job_id: str, payload: JobClientMetaRequest, request: Request) -> dict:
    """Attach the submitting client's card mapping to a job of this workspace."""
    if len(json.dumps(payload.meta)) > JOB_CLIENT_META_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Job meta too large")
    if not await job_store.set_client_meta(job_id, _session_id(request), payload.meta):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True}


@router.post("/api/jobs/{job_id}/cancel", response_model=JobCancelResponse)
async def cancel_job(job_id: str):
    try:
        cancelled = await job_store.cancel(job_id)
    except JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobCancelResponse(cancelled=cancelled)


@router.get("/api/queue/status", response_model=QueueStatusResponse)
async def queue_status():
    depths = await job_store.pool_depths()
    return QueueStatusResponse(**depths)
