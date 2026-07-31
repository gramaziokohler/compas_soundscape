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

import json
import os
import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.llm_service import LLMService
from services.llm_worker import run_llm_generation
from services.model_analysis_worker import run_model_analysis
from services.task_queue import unified_queue, make_subprocess_runner
from models.schemas import (
    PromptRequest,
    UnifiedPromptGenerationRequest,
    LLMGenerationStartResponse,
    LLMGenerationStatusResponse,
    ModelAnalysisRequest,
    ModelAnalysisStartResponse,
    ModelAnalysisStatusResponse,
    ScenaristStreamRequest,
    FoleyArtistRequest,
    ScenarioResponse,
)
from config.constants import (
    DEFAULT_DBFS,
    LLM_SUGGESTED_INTERVAL_SECONDS,
    DEFAULT_DURATION_SECONDS,
    LLM_TASK_CLEANUP_DELAY_SECONDS,
    TEMP_SIMULATIONS_DIR,
    TEMP_ANALYSIS_DIR,
    DEFAULT_LLM_MODEL,
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
    llm_model: str = DEFAULT_LLM_MODEL


@router.post("/api/select-entities")
async def select_entities(request: EntitySelectionRequest):
    try:
        if not request.entities:
            raise HTTPException(status_code=400, detail="No entities provided")
        selected_entities = await llm_service.select_diverse_entities(
            request.entities, request.max_sounds, llm_model=request.llm_model
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
                entities_to_use = await llm_service.select_diverse_entities(
                    request.entities, request.num_sounds, llm_model=request.llm_model
                )
            sound_list = await llm_service.generate_prompts_for_entities(
                entities_to_use, request.num_sounds, request.context, llm_model=request.llm_model
            )
            entity_prompts = []
            for sound_data in sound_list:
                entity_indices = sound_data.get("entity_indices", [])
                entity_objects = [
                    entities_to_use[i]
                    for i in entity_indices
                    if 0 <= i < len(entities_to_use)
                ]
                entity_prompts.append({
                    "entities": entity_objects,
                    "prompt": sound_data["prompt"],
                    "display_name": sound_data["display_name"],
                    "dbfs": sound_data.get("dbfs", DEFAULT_DBFS),
                    "interval_seconds": sound_data.get("interval_seconds", LLM_SUGGESTED_INTERVAL_SECONDS),
                    "duration_seconds": sound_data.get("duration_seconds", DEFAULT_DURATION_SECONDS),
                })
            return {"prompts": entity_prompts, "selected_entities": entities_to_use}

        elif request.context and request.context.strip():
            raw_text, sound_list = await llm_service.generate_text_based_prompts(
                request.context, request.num_sounds, llm_model=request.llm_model
            )
            return {"prompts": sound_list, "text": raw_text}

        else:
            raise HTTPException(status_code=400, detail="Either context or entities must be provided")

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        error_str = str(e)
        if "429" in error_str or "quota" in error_str.lower() or "RESOURCE_EXHAUSTED" in error_str or "RateLimitError" in type(e).__name__:
            raise HTTPException(status_code=429, detail=error_str)
        if "503" in error_str or "overloaded" in error_str.lower() or "UNAVAILABLE" in error_str:
            raise HTTPException(status_code=503, detail="LLM service is currently overloaded. Please try again in a moment.")
        raise HTTPException(status_code=500, detail=f"Error generating prompts: {error_str}")


@router.post("/api/generate-prompts-stream")
async def generate_prompts_stream(request: UnifiedPromptGenerationRequest):
    """SSE endpoint: yields one sound object per event as the LLM generates them.

    Each event is `data: <JSON>\\n\\n` where JSON has a `type` field:
      - `{"type": "entities", "entities": [...]}` — the resolved entity list (entity path only)
      - `{"type": "sound", ...soundFields}` — a single sound dict
      - `{"type": "error", "message": "..."}` — a fatal error
      - `data: [DONE]` — stream complete
    """
    async def event_generator():
        try:
            if request.entities and len(request.entities) > 0:
                entities_to_use = request.entities
                if len(request.entities) > request.num_sounds * 1.5:
                    entities_to_use = await llm_service.select_diverse_entities(
                        request.entities, request.num_sounds, llm_model=request.llm_model
                    )
                yield f"data: {json.dumps({'type': 'entities', 'entities': entities_to_use})}\n\n"
                async for sound in llm_service.stream_generate_prompts_for_entities(
                    entities_to_use, request.num_sounds, request.context, llm_model=request.llm_model
                ):
                    # Resolve entity_indices → fully-hydrated entities list so the frontend
                    # doesn't need to re-resolve from an index cache.
                    entity_indices = sound.get("entity_indices", [])
                    sound["entities"] = [
                        entities_to_use[i]
                        for i in entity_indices
                        if 0 <= i < len(entities_to_use)
                    ]
                    sound["type"] = "sound"
                    yield f"data: {json.dumps(sound)}\n\n"

            elif request.context and request.context.strip():
                async for sound in llm_service.stream_generate_text_based_prompts(
                    request.context, request.num_sounds, llm_model=request.llm_model
                ):
                    sound["type"] = "sound"
                    yield f"data: {json.dumps(sound)}\n\n"

            else:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Either context or entities must be provided'})}\n\n"

        except Exception as e:
            error_str = str(e)
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': error_str})}\n\n"

        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
            llm_model=request.llm_model,
            api_keys={
                "GOOGLE_API_KEY": os.environ.get("GOOGLE_API_KEY"),
                "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY"),
                "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY"),
            },
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


# ─── 3D Model Analysis endpoints ──────────────────────────────────────────────────

@router.post("/api/analyze-3dmodel", response_model=ModelAnalysisStartResponse)
async def analyze_3dmodel(request: ModelAnalysisRequest):
    """
    Enqueue 3D model analysis.  Returns analysis_id immediately.
    Poll GET /api/analyze-3dmodel-status/{analysis_id} for updates.
    """
    analysis_id = str(uuid.uuid4())

    try:
        if not request.entities:
            raise HTTPException(status_code=400, detail="No entities provided")

        progress_file = str(TEMP_DIR / f"model_analysis_progress_{analysis_id}.json")
        result_file   = str(TEMP_DIR / f"model_analysis_result_{analysis_id}.json")

        worker_kwargs = dict(
            analysis_id=analysis_id,
            progress_file=progress_file,
            result_file=result_file,
            entities=request.entities,
            screenshots=request.screenshots,
            user_context=request.user_context,
            llm_model=request.llm_model,
            api_keys={
                "GOOGLE_API_KEY":    os.environ.get("GOOGLE_API_KEY"),
                "OPENAI_API_KEY":    os.environ.get("OPENAI_API_KEY"),
                "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY"),
            },
        )

        run_fn = make_subprocess_runner(
            run_model_analysis,
            worker_kwargs,
            progress_file,
            result_file,
            error_prefix="Model analysis",
        )

        pos, total = unified_queue.enqueue(
            analysis_id, "model_analysis", run_fn, LLM_TASK_CLEANUP_DELAY_SECONDS
        )
        print(f"Model analysis {analysis_id} queued at position {pos} of {total}")
        return ModelAnalysisStartResponse(analysis_id=analysis_id)

    except HTTPException:
        raise
    except Exception as exc:
        print(f"Model analysis setup error: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail=f"Model analysis setup failed: {str(exc)}"
        )


@router.get(
    "/api/analyze-3dmodel-status/{analysis_id}",
    response_model=ModelAnalysisStatusResponse,
)
async def get_model_analysis_status(analysis_id: str):
    task = unified_queue.get_task(analysis_id)
    if not task:
        raise HTTPException(status_code=404, detail="Model analysis task not found")

    q_pos, q_total = unified_queue.get_queue_status(analysis_id)
    status_str = (
        f"Queued — position {q_pos} of {q_total}" if q_pos is not None else task.status
    )

    return ModelAnalysisStatusResponse(
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


@router.post("/api/cancel-model-analysis/{analysis_id}")
async def cancel_model_analysis(analysis_id: str):
    if not unified_queue.get_task(analysis_id):
        raise HTTPException(status_code=404, detail="Model analysis task not found")
    unified_queue.cancel(analysis_id)
    return {"cancelled": True}


# ─── Streaming 3D Model Analysis endpoints ────────────────────────────────────

class AnalyzeModelStreamRequest(BaseModel):
    entities: list[dict]
    screenshots: list[str] = []
    user_context: str = ""
    llm_model: str = DEFAULT_LLM_MODEL


@router.post("/api/analyze-3dmodel-stream")
async def analyze_3dmodel_stream(request: AnalyzeModelStreamRequest):
    """SSE endpoint: streams architectural object groups as LLM identifies them.

    The task is queued through the unified backend queue so heavy LLM calls
    are serialised alongside other backend jobs.

    Events:
      - {"type":"queued","analysis_id":"<uuid>","queue_position":N,"queue_total":M}
      - {"type":"start","analysis_id":"<uuid>"}  — LLM call begins
      - {"type":"object",...fields}               — one per identified group
      - {"type":"error","message":"..."}          — on failure
      - {"type":"done","total":n}                 — stream complete
      - data: [DONE]                              — sentinel
    """
    import asyncio as _asyncio
    analysis_id = str(uuid.uuid4())
    loop = _asyncio.get_event_loop()
    _pos, _total, ready_event, done_event = unified_queue.enqueue_with_ready_signal(
        analysis_id, "analyze_stream", loop, LLM_TASK_CLEANUP_DELAY_SECONDS
    )

    async def event_generator():
        objects: list[dict] = []
        space_description = ""
        try:
            # ── Queue-position phase ──────────────────────────────────────
            while not ready_event.is_set():
                task = unified_queue.get_task(analysis_id)
                if task and task.cancel_event.is_set():
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Task cancelled'})}\n\n"
                    return
                q_pos, q_total = unified_queue.get_queue_status(analysis_id)
                yield (
                    f"data: {json.dumps({'type': 'queued', 'analysis_id': analysis_id, 'queue_position': q_pos, 'queue_total': q_total})}\n\n"
                )
                await _asyncio.sleep(1)

            yield f"data: {json.dumps({'type': 'start', 'analysis_id': analysis_id})}\n\n"

            async for event in llm_service.stream_analyze_3dmodel(
                request.entities,
                screenshots=request.screenshots or None,
                user_context=request.user_context or None,
                llm_model=request.llm_model,
            ):
                if event.get("type") == "space_description":
                    space_description = event.get("text", "")
                    yield f"data: {json.dumps({'type': 'space_description', 'text': space_description})}\n\n"
                else:
                    objects.append(event)
                    yield f"data: {json.dumps(event)}\n\n"

        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        finally:
            done_event.set()  # release the consumer thread slot
            try:
                analysis_dir = Path(TEMP_ANALYSIS_DIR)
                analysis_dir.mkdir(parents=True, exist_ok=True)
                result_file = analysis_dir / f"analysis_{analysis_id}.json"
                tmp_file = result_file.with_suffix(".tmp")
                # ── Compute bounding box from entity bounds ────────────────
                total_bounds: dict | None = None
                try:
                    xs_min, ys_min, zs_min = [], [], []
                    xs_max, ys_max, zs_max = [], [], []
                    for _e in request.entities:
                        _b = _e.get("bounds")
                        if not _b:
                            continue
                        _mn = _b.get("min") or []
                        _mx = _b.get("max") or []
                        if len(_mn) >= 3 and len(_mx) >= 3:
                            xs_min.append(_mn[0]); ys_min.append(_mn[1]); zs_min.append(_mn[2])
                            xs_max.append(_mx[0]); ys_max.append(_mx[1]); zs_max.append(_mx[2])
                    if xs_min:
                        min_x, min_y, min_z = min(xs_min), min(ys_min), min(zs_min)
                        max_x, max_y, max_z = max(xs_max), max(ys_max), max(zs_max)
                        total_bounds = {
                            "min":    [round(min_x, 3), round(min_y, 3), round(min_z, 3)],
                            "max":    [round(max_x, 3), round(max_y, 3), round(max_z, 3)],
                            "width":  round(max_x - min_x, 3),
                            "depth":  round(max_y - min_y, 3),
                            "height": round(max_z - min_z, 3),
                        }
                except Exception:
                    pass
                payload: dict = {"analysis_id": analysis_id, "objects": objects}
                if space_description:
                    payload["space_description"] = space_description
                if total_bounds:
                    payload["meta"] = {"total_bounds": total_bounds}
                with open(tmp_file, "w", encoding="utf-8") as f:
                    json.dump(payload, f, indent=2)
                tmp_file.replace(result_file)
            except Exception as save_err:
                print(f"[analyze-3dmodel-stream] Failed to save result: {save_err}")

            yield f"data: {json.dumps({'type': 'done', 'total': len(objects)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/cancel-analyze-3dmodel-stream/{analysis_id}")
async def cancel_analyze_3dmodel_stream(analysis_id: str):
    if not unified_queue.get_task(analysis_id):
        raise HTTPException(status_code=404, detail="Analysis stream task not found")
    unified_queue.cancel(analysis_id)
    return {"cancelled": True}


class UpdateAnalysisObjectRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    material: str | None = None


@router.patch("/api/analyze-3dmodel-result/{analysis_id}/objects/{object_index}")
async def update_analysis_object(
    analysis_id: str,
    object_index: int,
    request: UpdateAnalysisObjectRequest,
):
    """Update a single object in an analysis result file."""
    import re as _re
    if not _re.match(r'^[0-9a-f-]+$', analysis_id):
        raise HTTPException(status_code=400, detail="Invalid analysis_id")

    result_file = Path(TEMP_ANALYSIS_DIR) / f"analysis_{analysis_id}.json"
    if not result_file.exists():
        raise HTTPException(status_code=404, detail="Analysis result not found")

    try:
        with open(result_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        objects = data.get("objects", [])
        if object_index < 0 or object_index >= len(objects):
            raise HTTPException(status_code=404, detail="Object index out of range")

        obj = objects[object_index]
        if request.name is not None:
            obj["name"] = request.name
        if request.description is not None:
            obj["description"] = request.description
        if request.material is not None:
            obj["material"] = request.material

        tmp_file = result_file.with_suffix(".tmp")
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        tmp_file.replace(result_file)

        return obj

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to update object: {str(e)}")


# ─── Scenarist endpoints ──────────────────────────────────────────────────────

@router.post("/api/scenarist-stream")
async def scenarist_stream(request: ScenaristStreamRequest):
    """SSE endpoint: yields structured scenario events as they are generated.

    The task is queued through the unified backend queue.

    Events:
      - {"type":"queued","scenario_id":"<uuid>","queue_position":N,"queue_total":M}
      - {"type":"scenario","scenario_index":i,...}
      - {"type":"event","scenario_index":i,"event":{...}}
      - {"type":"error","message":"..."}          — on failure
      - {"type":"done","result":{...},"scenario_id":"<uuid>"}
      - data: [DONE]                              — sentinel
    """
    import asyncio as _asyncio
    import re as _re

    scenario_id = str(uuid.uuid4())
    loop = _asyncio.get_event_loop()
    _pos, _total, ready_event, done_event = unified_queue.enqueue_with_ready_signal(
        scenario_id, "scenarist_stream", loop, LLM_TASK_CLEANUP_DELAY_SECONDS
    )

    async def event_generator():
        try:
            # ── Queue-position phase ──────────────────────────────────────
            while not ready_event.is_set():
                task = unified_queue.get_task(scenario_id)
                if task and task.cancel_event.is_set():
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Task cancelled'})}\n\n"
                    return
                q_pos, q_total = unified_queue.get_queue_status(scenario_id)
                yield (
                    f"data: {json.dumps({'type': 'queued', 'scenario_id': scenario_id, 'queue_position': q_pos, 'queue_total': q_total})}\n\n"
                )
                await _asyncio.sleep(1)

            # ── Load furniture_list ───────────────────────────────────────
            furniture_list: dict | None = None
            if request.analysis_id:
                if not _re.match(r'^[0-9a-f-]+$', request.analysis_id):
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Invalid analysis_id'})}\n\n"
                    return
                analysis_file = Path(TEMP_ANALYSIS_DIR) / f"analysis_{request.analysis_id}.json"
                if analysis_file.exists():
                    try:
                        with open(analysis_file, "r", encoding="utf-8") as f:
                            raw = json.load(f)
                        _total_bounds = (raw.get("meta") or {}).get("total_bounds")
                        furniture_list = {
                            "architecturalObjects": raw.get("objects", []),
                            **(({"meta": {"total_bounds": _total_bounds}}) if _total_bounds else {}),
                        }
                    except Exception as load_err:
                        print(f"[scenarist-stream] failed to load analysis: {load_err}")

            # ── Run LLM ──────────────────────────────────────────────────
            async for event in llm_service.stream_scenarist_agent(
                user_context=request.user_context,
                llm_model=request.llm_model,
                furniture_list=furniture_list,
                duration=request.duration,
                people_count=request.people_count,
                likeliness=request.likeliness,
            ):
                yield f"data: {json.dumps(event)}\n\n"

        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            done_event.set()
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/cancel-scenarist-stream/{scenario_id}")
async def cancel_scenarist_stream(scenario_id: str):
    if not unified_queue.get_task(scenario_id):
        raise HTTPException(status_code=404, detail="Scenarist stream task not found")
    unified_queue.cancel(scenario_id)
    return {"cancelled": True}


@router.post("/api/foley-artist-stream")
async def foley_artist_stream(request: FoleyArtistRequest):
    """SSE endpoint: streams foley sound events one by one.

    The task is queued through the unified backend queue.

    Events:
      - {"type":"queued","foley_id":"<uuid>","queue_position":N,"queue_total":M}
      - {"type":"sound","scenario_title":"...","scenario_index":int,"sound":{...}}
      - {"type":"error","message":"..."}          — on failure
      - {"type":"done","result":{...},"foley_id":"<uuid>"}
      - data: [DONE]                              — sentinel
    """
    import asyncio as _asyncio
    import re as _re

    async def make_error_stream(msg: str):
        yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
        yield "data: [DONE]\n\n"

    if not _re.match(r'^[0-9a-f-]+$', request.scenario_id):
        return StreamingResponse(
            make_error_stream("Invalid scenario_id"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    scenario_file = Path(TEMP_ANALYSIS_DIR) / f"scenarios_{request.scenario_id}.json"
    if not scenario_file.exists():
        return StreamingResponse(
            make_error_stream("Scenario not found"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        with open(scenario_file, "r", encoding="utf-8") as f:
            scenario_data = json.load(f)
    except Exception as e:
        return StreamingResponse(
            make_error_stream(f"Failed to load scenario: {e}"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    furniture_list: dict | None = None
    if request.analysis_id:
        if not _re.match(r'^[0-9a-f-]+$', request.analysis_id):
            return StreamingResponse(
                make_error_stream("Invalid analysis_id"),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        analysis_file = Path(TEMP_ANALYSIS_DIR) / f"analysis_{request.analysis_id}.json"
        if analysis_file.exists():
            try:
                with open(analysis_file, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                _total_bounds = (raw.get("meta") or {}).get("total_bounds")
                furniture_list = {
                    "architecturalObjects": raw.get("objects", []),
                    **(({"meta": {"total_bounds": _total_bounds}}) if _total_bounds else {}),
                }
            except Exception as load_err:
                print(f"[foley-artist-stream] failed to load analysis: {load_err}")

    foley_id = str(uuid.uuid4())
    loop = _asyncio.get_event_loop()
    _pos, _total, ready_event, done_event = unified_queue.enqueue_with_ready_signal(
        foley_id, "foley_stream", loop, LLM_TASK_CLEANUP_DELAY_SECONDS
    )

    async def event_generator():
        try:
            # ── Queue-position phase ──────────────────────────────────────
            while not ready_event.is_set():
                task = unified_queue.get_task(foley_id)
                if task and task.cancel_event.is_set():
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Task cancelled'})}\n\n"
                    return
                q_pos, q_total = unified_queue.get_queue_status(foley_id)
                yield (
                    f"data: {json.dumps({'type': 'queued', 'foley_id': foley_id, 'queue_position': q_pos, 'queue_total': q_total})}\n\n"
                )
                await _asyncio.sleep(1)

            # ── Run LLM ──────────────────────────────────────────────────
            async for event in llm_service.stream_foley_artist(
                scenarist_agent_result=scenario_data,
                furniture_list=furniture_list,
                maximum_number_of_sounds=request.maximum_sounds,
                llm_model=request.llm_model,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            done_event.set()
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/cancel-foley-artist-stream/{foley_id}")
async def cancel_foley_artist_stream(foley_id: str):
    if not unified_queue.get_task(foley_id):
        raise HTTPException(status_code=404, detail="Foley stream task not found")
    unified_queue.cancel(foley_id)
    return {"cancelled": True}


@router.put("/api/scenarist-result/{scenario_id}")
async def update_scenarist_result(
    scenario_id: str,
    body: ScenarioResponse,
):
    """Overwrite a saved scenario result (e.g., after user edits)."""
    import re as _re
    if not _re.match(r'^[0-9a-f-]+$', scenario_id):
        raise HTTPException(status_code=400, detail="Invalid scenario_id")

    out_file = Path(TEMP_ANALYSIS_DIR) / f"scenarios_{scenario_id}.json"
    try:
        analysis_dir = Path(TEMP_ANALYSIS_DIR)
        analysis_dir.mkdir(parents=True, exist_ok=True)
        tmp_file = out_file.with_suffix(".tmp")
        payload = {"scenario_id": scenario_id, **body.model_dump()}
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        tmp_file.replace(out_file)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to save scenario: {str(e)}")

    return {"ok": True}


class SpeechAgentRequest(BaseModel):
    scenario_id: str
    analysis_id: str | None = None
    llm_model: str = DEFAULT_LLM_MODEL
    language: str | None = None


@router.post("/api/speech-agent-stream")
async def speech_agent_stream(request: SpeechAgentRequest):
    """SSE endpoint: streams speech entries one by one.

    Events:
      - {"type":"queued","speech_id":"<uuid>","queue_position":N,"queue_total":M}
      - {"type":"speech","speech":{...}}
      - {"type":"error","message":"..."}
      - {"type":"done","result":{...},"speech_id":"<uuid>"}
      - data: [DONE]
    """
    import asyncio as _asyncio
    import re as _re

    async def make_error_stream(msg: str):
        yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
        yield "data: [DONE]\n\n"

    if not _re.match(r'^[0-9a-f-]+$', request.scenario_id):
        return StreamingResponse(
            make_error_stream("Invalid scenario_id"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    scenario_file = Path(TEMP_ANALYSIS_DIR) / f"scenarios_{request.scenario_id}.json"
    if not scenario_file.exists():
        return StreamingResponse(
            make_error_stream("Scenario not found"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        with open(scenario_file, "r", encoding="utf-8") as f:
            scenario_data = json.load(f)
    except Exception as e:
        return StreamingResponse(
            make_error_stream(f"Failed to load scenario: {e}"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    furniture_list: dict | None = None
    if request.analysis_id:
        if not _re.match(r'^[0-9a-f-]+$', request.analysis_id):
            return StreamingResponse(
                make_error_stream("Invalid analysis_id"),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        analysis_file = Path(TEMP_ANALYSIS_DIR) / f"analysis_{request.analysis_id}.json"
        if analysis_file.exists():
            try:
                with open(analysis_file, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                _total_bounds = (raw.get("meta") or {}).get("total_bounds")
                furniture_list = {
                    "architecturalObjects": raw.get("objects", []),
                    **(({"meta": {"total_bounds": _total_bounds}}) if _total_bounds else {}),
                }
            except Exception as load_err:
                print(f"[speech-agent-stream] failed to load analysis: {load_err}")

    speech_id = str(uuid.uuid4())
    loop = _asyncio.get_event_loop()
    _pos, _total, ready_event, done_event = unified_queue.enqueue_with_ready_signal(
        speech_id, "speech_stream", loop, LLM_TASK_CLEANUP_DELAY_SECONDS
    )

    async def event_generator():
        try:
            while not ready_event.is_set():
                task = unified_queue.get_task(speech_id)
                if task and task.cancel_event.is_set():
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Task cancelled'})}\n\n"
                    return
                q_pos, q_total = unified_queue.get_queue_status(speech_id)
                yield (
                    f"data: {json.dumps({'type': 'queued', 'speech_id': speech_id, 'queue_position': q_pos, 'queue_total': q_total})}\n\n"
                )
                await _asyncio.sleep(1)

            async for event in llm_service.stream_speech_agent(
                scenarist_agent_result=scenario_data,
                furniture_list=furniture_list,
                llm_model=request.llm_model,
                language=request.language,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            done_event.set()
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/cancel-speech-agent-stream/{speech_id}")
async def cancel_speech_agent_stream(speech_id: str):
    if not unified_queue.get_task(speech_id):
        raise HTTPException(status_code=404, detail="Speech stream task not found")
    unified_queue.cancel(speech_id)
    return {"cancelled": True}


class OrchestrateStreamRequest(BaseModel):
    scenario_id: str
    foley_id: str
    speech_id: str
    llm_model: str = DEFAULT_LLM_MODEL


@router.post("/api/orchestrate-stream")
async def orchestrate_stream(request: OrchestrateStreamRequest):
    """SSE endpoint: streams orchestrated playlist entries one by one.

    Loads scenario, foley, and speech JSON files from disk, then calls the
    orchestrate agent to compile the final parametric audio playlist.

    Events:
      - {"type":"queued","orchestrate_id":"<uuid>","queue_position":N,"queue_total":M}
      - {"type":"entry","entry":{...}}
      - {"type":"error","message":"..."}
      - {"type":"done","result":{...},"orchestrate_id":"<uuid>"}
      - data: [DONE]
    """
    import asyncio as _asyncio
    import re as _re

    async def make_error_stream(msg: str):
        yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
        yield "data: [DONE]\n\n"

    if not _re.match(r'^[0-9a-f-]+$', request.scenario_id):
        return StreamingResponse(
            make_error_stream("Invalid scenario_id"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    if not _re.match(r'^[0-9a-f-]+$', request.foley_id):
        return StreamingResponse(
            make_error_stream("Invalid foley_id"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    if not _re.match(r'^[0-9a-f-]+$', request.speech_id):
        return StreamingResponse(
            make_error_stream("Invalid speech_id"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    scenario_file = Path(TEMP_ANALYSIS_DIR) / f"scenarios_{request.scenario_id}.json"
    foley_file = Path(TEMP_ANALYSIS_DIR) / f"foley_{request.foley_id}.json"
    speech_file = Path(TEMP_ANALYSIS_DIR) / f"speech_{request.speech_id}.json"

    if not scenario_file.exists():
        return StreamingResponse(
            make_error_stream("Scenario not found"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    if not foley_file.exists():
        return StreamingResponse(
            make_error_stream("Foley result not found"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    if not speech_file.exists():
        return StreamingResponse(
            make_error_stream("Speech result not found"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        with open(scenario_file, "r", encoding="utf-8") as f:
            scenario_data = json.load(f)
        with open(foley_file, "r", encoding="utf-8") as f:
            foley_data = json.load(f)
        with open(speech_file, "r", encoding="utf-8") as f:
            speech_data = json.load(f)
    except Exception as e:
        return StreamingResponse(
            make_error_stream(f"Failed to load data: {e}"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    orchestrate_id = str(uuid.uuid4())
    loop = _asyncio.get_event_loop()
    _pos, _total, ready_event, done_event = unified_queue.enqueue_with_ready_signal(
        orchestrate_id, "orchestrate_stream", loop, LLM_TASK_CLEANUP_DELAY_SECONDS
    )

    async def event_generator():
        try:
            while not ready_event.is_set():
                task = unified_queue.get_task(orchestrate_id)
                if task and task.cancel_event.is_set():
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Task cancelled'})}\n\n"
                    return
                q_pos, q_total = unified_queue.get_queue_status(orchestrate_id)
                yield (
                    f"data: {json.dumps({'type': 'queued', 'orchestrate_id': orchestrate_id, 'queue_position': q_pos, 'queue_total': q_total})}\n\n"
                )
                await _asyncio.sleep(1)

            async for event in llm_service.stream_orchestrate_agent(
                scenarist_agent_result=scenario_data,
                foley_result=foley_data,
                speech_result=speech_data,
                llm_model=request.llm_model,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            done_event.set()
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/cancel-orchestrate-stream/{orchestrate_id}")
async def cancel_orchestrate_stream(orchestrate_id: str):
    if not unified_queue.get_task(orchestrate_id):
        raise HTTPException(status_code=404, detail="Orchestrate stream task not found")
    unified_queue.cancel(orchestrate_id)
    return {"cancelled": True}
