"""Scene edit chat endpoint.

POST /api/scene-edit enqueues the edit agent as an in-process LLM job; the client polls
GET /api/jobs/{job_id} and applies the resulting ops (frontend/src/utils/sceneEditApply.ts).
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from config.constants import JOB_TYPE_LLM
from models.schemas import JobEnqueueResponse, SceneEditRequest
from routers.generation import _make_on_progress, _session_id
from services.io_jobs import start_io_job
from services.job_store import job_store
from services.llm_service import LLMCancelled
from services.scene_edit_service import SceneEditService

router = APIRouter()

# Injected by main.py
scene_edit_service: SceneEditService | None = None


def init_scene_edit_router(service: SceneEditService) -> None:
    global scene_edit_service
    scene_edit_service = service


@router.post("/api/scene-edit", response_model=JobEnqueueResponse)
async def scene_edit(request: SceneEditRequest, req: Request):
    """Enqueue the scene edit agent. Poll GET /api/jobs/{job_id}; the result is a SceneEditResult."""

    async def _run(job_id: str) -> None:
        partial: dict = {"kind": "scene_edit", "thinking": "", "phase": "thinking"}
        await job_store.set_progress(job_id, 5, "Planning the edit…", partial=partial)
        try:
            result = await scene_edit_service.plan_edit(
                snapshot=request.snapshot,
                history=request.history,
                instruction=request.instruction,
                llm_model=request.llm_model,
                on_progress=_make_on_progress(job_id, partial),
            )
        except LLMCancelled:
            await job_store.mark_cancelled(job_id)
            return
        await job_store.complete(job_id, result)

    job_id = await start_io_job(JOB_TYPE_LLM, _session_id(req), _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)
