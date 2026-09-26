"""
Unified job status/cancel/queue-depth endpoints backed by services/job_store.py.

Domain routers (sounds, pyroomacoustics, choras, sed_analysis, loop_analysis)
enqueue jobs via job_store.enqueue(...) and return {job_id, position, total};
clients poll this router's /api/jobs/{id} for progress/result instead of a
per-domain status route.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from services.job_store import job_store, JobNotFoundError
from models.schemas import JobStatusResponse, JobCancelResponse, QueueStatusResponse

router = APIRouter()


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
    )


@router.get("/api/jobs", response_model=list[JobStatusResponse])
async def list_jobs(request: Request):
    """List all jobs for the caller's workspace.

    Lets the client reattach to jobs that started before the window was closed
    (or after local storage was cleared). Scoped by the session cookie — never
    by a query parameter.
    """
    session_id = getattr(getattr(request, "state", None), "session_id", None) or ""
    views = await job_store.list_session_jobs(session_id)
    return [_to_response(v) for v in views]


@router.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str):
    try:
        view = await job_store.get(job_id)
    except JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")

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
    )


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
