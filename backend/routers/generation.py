"""
Text / LLM generation endpoints.

POST /api/generate-text
  Enqueues the LLM job, returns generation_id immediately.

GET  /api/text-generation-status/{generation_id}
  Poll for progress, queue position, or completed result.

POST /api/cancel-text-generation/{generation_id}
  Kill the subprocess immediately (hard kill).
"""
from __future__ import annotations

import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.llm_service import LLMService
from services.llm_worker import run_llm_generation
from services.task_queue import unified_queue, make_subprocess_runner
from models.schemas import (
    PromptRequest,
    UnifiedPromptGenerationRequest,
    LLMGenerationStartResponse,
    LLMGenerationStatusResponse,
)
from config.constants import (
    DEFAULT_SPL_DB,
    LLM_SUGGESTED_INTERVAL_SECONDS,
    DEFAULT_DURATION_SECONDS,
    LLM_TASK_CLEANUP_DELAY_SECONDS,
    TEMP_SIMULATIONS_DIR,
)

router = APIRouter()

TEMP_DIR = Path(TEMP_SIMULATIONS_DIR)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# Injected by main.py
llm_service = None


def init_generation_router(service: LLMService):
    global llm_service
    llm_service = service


class EntitySelectionRequest(BaseModel):
    entities: list[dict]
    max_sounds: int


@router.post("/api/select-entities")
async def select_entities(request: EntitySelectionRequest):
    try:
        if not request.entities:
            raise HTTPException(status_code=400, detail="No entities provided")
        selected_entities = llm_service.select_diverse_entities(
            request.entities, request.max_sounds
        )
        return {"selected_entities": selected_entities, "count": len(selected_entities)}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        error_str = str(e)
        if "503" in error_str or "overloaded" in error_str.lower() or "UNAVAILABLE" in error_str:
            raise HTTPException(status_code=503, detail="LLM service is currently overloaded. Please try again in a moment.")
        raise HTTPException(status_code=500, detail=f"Error selecting entities: {error_str}")


@router.post("/api/generate-prompts")
async def generate_prompts(request: UnifiedPromptGenerationRequest):
    try:
        if request.entities and len(request.entities) > 0:
            entities_to_use = request.entities
            if len(request.entities) > request.num_sounds * 1.5:
                entities_to_use = llm_service.select_diverse_entities(
                    request.entities, request.num_sounds
                )
            sound_list = llm_service.generate_prompts_for_entities(
                entities_to_use, request.num_sounds, request.context
            )
            entity_prompts = []
            for sound_data in sound_list:
                entity_idx = sound_data.get("entity_index")
                entity_data = None
                if entity_idx is not None and 0 <= entity_idx < len(entities_to_use):
                    entity_data = entities_to_use[entity_idx]
                entity_prompts.append({
                    "entity": entity_data,
                    "prompt": sound_data["prompt"],
                    "display_name": sound_data["display_name"],
                    "spl_db": sound_data.get("spl_db", DEFAULT_SPL_DB),
                    "interval_seconds": sound_data.get("interval_seconds", LLM_SUGGESTED_INTERVAL_SECONDS),
                    "duration_seconds": sound_data.get("duration_seconds", DEFAULT_DURATION_SECONDS),
                })
            return {"prompts": entity_prompts, "selected_entities": entities_to_use}

        elif request.context and request.context.strip():
            raw_text, sound_list = llm_service.generate_text_based_prompts(
                request.context, request.num_sounds
            )
            return {"prompts": sound_list, "text": raw_text}

        else:
            raise HTTPException(status_code=400, detail="Either context or entities must be provided")

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        error_str = str(e)
        if "429" in error_str or "quota" in error_str.lower() or "RESOURCE_EXHAUSTED" in error_str:
            raise HTTPException(
                status_code=429,
                detail=error_str if "quota" in error_str.lower() else "API quota exhausted. Please try again later.",
            )
        if "503" in error_str or "overloaded" in error_str.lower() or "UNAVAILABLE" in error_str:
            raise HTTPException(status_code=503, detail="LLM service is currently overloaded. Please try again in a moment.")
        raise HTTPException(status_code=500, detail=f"Error generating prompts: {error_str}")


@router.post("/api/generate-text", response_model=LLMGenerationStartResponse)
async def generate_text(request: PromptRequest):
    """
    Enqueue LLM text/prompt generation.  Returns generation_id immediately.
    Poll GET /api/text-generation-status/{generation_id} for updates.
    """
    generation_id = str(uuid.uuid4())

    try:
        if not request.prompt and not request.entities:
            raise HTTPException(status_code=400, detail="Either prompt or entities must be provided")

        progress_file = str(TEMP_DIR / f"llm_progress_{generation_id}.json")
        result_file   = str(TEMP_DIR / f"llm_result_{generation_id}.json")

        worker_kwargs = dict(
            generation_id=generation_id,
            progress_file=progress_file,
            result_file=result_file,
            prompt=request.prompt,
            num_sounds=request.num_sounds,
            entities=request.entities,
        )

        run_fn = make_subprocess_runner(
            run_llm_generation,
            worker_kwargs,
            progress_file,
            result_file,
            error_prefix="LLM generation",
        )

        pos, total = unified_queue.enqueue(
            generation_id, "llm", run_fn, LLM_TASK_CLEANUP_DELAY_SECONDS
        )
        print(f"LLM generation {generation_id} queued at position {pos} of {total}")
        return LLMGenerationStartResponse(generation_id=generation_id)

    except HTTPException:
        raise
    except Exception as exc:
        print(f"LLM generation setup error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"LLM generation setup failed: {str(exc)}")


# ─── Status endpoint ──────────────────────────────────────────────────────────

@router.get(
    "/api/text-generation-status/{generation_id}",
    response_model=LLMGenerationStatusResponse,
)
async def get_text_generation_status(generation_id: str):
    task = unified_queue.get_task(generation_id)
    if not task:
        raise HTTPException(status_code=404, detail="LLM generation task not found")

    q_pos, q_total = unified_queue.get_queue_status(generation_id)
    status_str = f"Queued — position {q_pos} of {q_total}" if q_pos is not None else task.status

    return LLMGenerationStatusResponse(
        generation_id=generation_id,
        progress=task.progress,
        status=status_str,
        completed=task.completed,
        cancelled=task.cancelled,
        error=task.error,
        result=task.result if (task.completed and not task.error and not task.cancelled) else None,
        queue_position=q_pos,
        queue_total=q_total,
    )


# ─── Cancel endpoint ──────────────────────────────────────────────────────────

@router.post("/api/cancel-text-generation/{generation_id}")
async def cancel_text_generation(generation_id: str):
    if not unified_queue.get_task(generation_id):
        raise HTTPException(status_code=404, detail="LLM generation task not found")
    unified_queue.cancel(generation_id)
    return {"cancelled": True}
