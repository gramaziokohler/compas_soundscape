"""
Text / LLM generation endpoints.

POST /api/generate-text
  Enqueues an in-process (asyncio) "llm" job, returns {job_id, position,
  total} immediately. Poll/cancel via GET/POST /api/jobs/{job_id}(/cancel).

SSE agent endpoints (analyze-3dmodel-stream, scenarist-stream,
foley-artist-stream, speech-agent-stream, orchestrate-stream) acquire
LLM_SEMAPHORE directly and stream with keepalive pings — see
services/io_jobs.py.
"""
from __future__ import annotations

import json
import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.llm_service import LLMService
from services.job_store import job_store
from services.io_jobs import start_io_job, run_blocking, iter_with_keepalive, LLM_SEMAPHORE
from models.schemas import (
    PromptRequest,
    UnifiedPromptGenerationRequest,
    JobEnqueueResponse,
    ModelAnalysisRequest,
    ScenaristStreamRequest,
    FoleyArtistRequest,
    ScenarioResponse,
)
from config.constants import (
    DEFAULT_DBFS,
    LLM_SUGGESTED_INTERVAL_SECONDS,
    DEFAULT_DURATION_SECONDS,
    TEMP_ANALYSIS_DIR,
    DEFAULT_LLM_MODEL,
    JOB_TYPE_LLM,
    JOB_TYPE_MODEL_ANALYSIS,
)
from utils.llm_errors import llm_error_message

router = APIRouter()

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
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': llm_error_message(e)})}\n\n"

        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/generate-text", response_model=JobEnqueueResponse)
async def generate_text(request: PromptRequest, req: Request):
    """
    Run LLM text/prompt generation as an in-process asyncio task (behind
    LLM_SEMAPHORE). Returns {job_id, position, total} immediately.
    Poll GET /api/jobs/{job_id} for progress/result.
    """
    if not request.prompt and not request.entities:
        raise HTTPException(status_code=400, detail="Either prompt or entities must be provided")

    session_id = getattr(getattr(req, "state", None), "session_id", None)

    async def _run(job_id: str) -> None:
        await job_store.set_progress(job_id, 20, "Generating sound prompts...")

        if request.entities and len(request.entities) > 0:
            sound_list = await llm_service.generate_prompts_for_entities(
                request.entities, request.num_sounds, request.prompt, llm_model=request.llm_model,
            )
            entity_prompts = []
            for sound_data in sound_list:
                entity_idx = sound_data.get("entity_index")
                entity_data = (
                    request.entities[entity_idx]
                    if entity_idx is not None and 0 <= entity_idx < len(request.entities)
                    else None
                )
                entity_prompts.append({
                    "entity": entity_data,
                    "prompt": sound_data["prompt"],
                    "display_name": sound_data["display_name"],
                    "dbfs": sound_data.get("dbfs", DEFAULT_DBFS),
                    "interval_seconds": sound_data.get("interval_seconds", LLM_SUGGESTED_INTERVAL_SECONDS),
                    "duration_seconds": sound_data.get("duration_seconds", DEFAULT_DURATION_SECONDS),
                })
            result_payload = {
                "text": "\n".join(f"{i + 1}. {p['prompt']}" for i, p in enumerate(entity_prompts)),
                "sounds": [p["prompt"] for p in entity_prompts],
                "prompts": entity_prompts,
                "selected_entities": request.entities,
            }
        elif request.prompt and request.prompt.strip():
            raw_text, sound_list = await llm_service.generate_text_based_prompts(
                request.prompt, request.num_sounds, llm_model=request.llm_model,
            )
            result_payload = {
                "text": raw_text,
                "sounds": [s["prompt"] for s in sound_list],
                "prompts": sound_list,
                "selected_entities": None,
            }
        else:
            raise ValueError("Either prompt or entities must be provided")

        await job_store.complete(job_id, result_payload)

    job_id = await start_io_job(JOB_TYPE_LLM, session_id, _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)


# ─── 3D Model Analysis endpoints ──────────────────────────────────────────────────

def _normalize_analysis_objects(raw: list) -> list[dict]:
    """Clamp and coerce raw object dicts from the LLM into consistent types."""
    out = []
    for obj in raw:
        if not isinstance(obj, dict):
            continue
        try:
            raw_oids = obj.get("object_ids", {})
            if isinstance(raw_oids, dict):
                object_ids: dict[str, dict] = {
                    str(k): v if isinstance(v, dict) else {}
                    for k, v in raw_oids.items()
                }
            else:
                object_ids = {str(x): {} for x in raw_oids}

            out.append({
                "name": str(obj.get("name", "Unknown")),
                "description": str(obj.get("description", "")),
                "material": str(obj.get("material", "")),
                "quantity": max(1, int(obj.get("quantity", 1))),
                "object_ids": object_ids,
            })
        except (ValueError, TypeError):
            continue
    return out


@router.post("/api/analyze-3dmodel", response_model=JobEnqueueResponse)
async def analyze_3dmodel(request: ModelAnalysisRequest, req: Request):
    """
    Run 3D model analysis as an in-process asyncio task (behind
    LLM_SEMAPHORE; the underlying LLMService.analyze_3dmodel() call is
    synchronous, so it runs in a threadpool to avoid blocking the event loop).
    Returns {job_id, position, total} immediately.
    """
    if not request.entities:
        raise HTTPException(status_code=400, detail="No entities provided")

    session_id = getattr(getattr(req, "state", None), "session_id", None)

    async def _run(job_id: str) -> None:
        screenshot_count = len(request.screenshots) if request.screenshots else 0
        await job_store.set_progress(
            job_id, 20,
            f"Analyzing {len(request.entities)} objects"
            + (f" with {screenshot_count} screenshot(s)" if screenshot_count else " (metadata only)")
            + "...",
        )
        raw_result = await run_blocking(
            llm_service.analyze_3dmodel,
            entities=request.entities,
            screenshots=request.screenshots,
            user_context=request.user_context,
            llm_model=request.llm_model,
        )
        result_payload = {
            "objects": _normalize_analysis_objects(raw_result.get("objects", [])),
            "space_title": raw_result.get("space_title", ""),
            "space_description": raw_result.get("space_description", ""),
        }
        await job_store.complete(job_id, result_payload)

    job_id = await start_io_job(JOB_TYPE_MODEL_ANALYSIS, session_id, _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)


# ─── Streaming 3D Model Analysis endpoints ────────────────────────────────────


class AnalyzeModelStreamRequest(BaseModel):
    entities: list[dict]
    screenshots: list[str] = []
    user_context: str = ""
    llm_model: str = DEFAULT_LLM_MODEL


@router.post("/api/analyze-3dmodel-stream")
async def analyze_3dmodel_stream(request: AnalyzeModelStreamRequest):
    """SSE endpoint: streams architectural object groups as LLM identifies them.

    Acquires LLM_SEMAPHORE for the duration of the call so heavy LLM calls
    are bounded alongside other backend jobs; keepalive pings are injected if
    the LLM goes quiet for more than SSE_KEEPALIVE_INTERVAL_S.

    Events:
      - {"type":"start","analysis_id":"<uuid>"}  — LLM call begins
      - {"type":"object",...fields}               — one per identified group
      - {"type":"error","message":"..."}          — on failure
      - {"type":"done","total":n}                 — stream complete
      - data: [DONE]                              — sentinel
    """
    analysis_id = str(uuid.uuid4())

    async def event_generator():
        objects: list[dict] = []
        space_title = ""
        space_description = ""
        async with LLM_SEMAPHORE:
            try:
                yield f"data: {json.dumps({'type': 'start', 'analysis_id': analysis_id})}\n\n"

                stream = llm_service.stream_analyze_3dmodel(
                    request.entities,
                    screenshots=request.screenshots or None,
                    user_context=request.user_context or None,
                    llm_model=request.llm_model,
                )
                async for kind, event in iter_with_keepalive(stream):
                    if kind == "ping":
                        yield ": ping\n\n"
                        continue
                    if event.get("type") == "space_title":
                        space_title = event.get("text", "")
                        yield f"data: {json.dumps({'type': 'space_title', 'text': space_title})}\n\n"
                    elif event.get("type") == "space_description":
                        space_description = event.get("text", "")
                        yield f"data: {json.dumps({'type': 'space_description', 'text': space_description})}\n\n"
                    else:
                        objects.append(event)
                        yield f"data: {json.dumps(event)}\n\n"

            except Exception as e:
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': llm_error_message(e)})}\n\n"

            finally:
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
                    if space_title:
                        payload["space_title"] = space_title
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


@router.post("/api/scenarist-stream")
async def scenarist_stream(request: ScenaristStreamRequest):
    """SSE endpoint: yields structured scenario events as they are generated.

    Acquires LLM_SEMAPHORE for the duration of the call; keepalive pings are
    injected if the LLM goes quiet for more than SSE_KEEPALIVE_INTERVAL_S.

    Events:
      - {"type":"scenario","scenario_index":i,...}
      - {"type":"event","scenario_index":i,"event":{...}}
      - {"type":"error","message":"..."}          — on failure
      - {"type":"done","result":{...},"scenario_id":"<uuid>"}
      - data: [DONE]                              — sentinel
    """
    import re as _re

    scenario_id = str(uuid.uuid4())

    async def event_generator():
        async with LLM_SEMAPHORE:
            try:
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
                stream = llm_service.stream_scenarist_agent(
                    user_context=request.user_context,
                    llm_model=request.llm_model,
                    furniture_list=furniture_list,
                    duration=request.duration,
                    people_count=request.people_count,
                    likeliness=request.likeliness,
                )
                async for kind, event in iter_with_keepalive(stream):
                    if kind == "ping":
                        yield ": ping\n\n"
                        continue
                    yield f"data: {json.dumps(event)}\n\n"

            except Exception as e:
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': llm_error_message(e)})}\n\n"
            finally:
                yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/foley-artist-stream")
async def foley_artist_stream(request: FoleyArtistRequest):
    """SSE endpoint: streams foley sound events one by one.

    Acquires LLM_SEMAPHORE for the duration of the call; keepalive pings are
    injected if the LLM goes quiet for more than SSE_KEEPALIVE_INTERVAL_S.

    Events:
      - {"type":"sound","scenario_title":"...","scenario_index":int,"sound":{...}}
      - {"type":"error","message":"..."}          — on failure
      - {"type":"done","result":{...},"foley_id":"<uuid>"}
      - data: [DONE]                              — sentinel
    """
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

    async def event_generator():
        async with LLM_SEMAPHORE:
            try:
                stream = llm_service.stream_foley_artist(
                    scenarist_agent_result=scenario_data,
                    furniture_list=furniture_list,
                    maximum_number_of_sounds=request.maximum_sounds,
                    llm_model=request.llm_model,
                )
                async for kind, event in iter_with_keepalive(stream):
                    if kind == "ping":
                        yield ": ping\n\n"
                        continue
                    yield f"data: {json.dumps(event)}\n\n"
            except Exception as e:
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': llm_error_message(e)})}\n\n"
            finally:
                yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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

    Acquires LLM_SEMAPHORE for the duration of the call; keepalive pings are
    injected if the LLM goes quiet for more than SSE_KEEPALIVE_INTERVAL_S.

    Events:
      - {"type":"speech","speech":{...}}
      - {"type":"error","message":"..."}
      - {"type":"done","result":{...},"speech_id":"<uuid>"}
      - data: [DONE]
    """
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

    async def event_generator():
        async with LLM_SEMAPHORE:
            try:
                stream = llm_service.stream_speech_agent(
                    scenarist_agent_result=scenario_data,
                    furniture_list=furniture_list,
                    llm_model=request.llm_model,
                    language=request.language,
                )
                async for kind, event in iter_with_keepalive(stream):
                    if kind == "ping":
                        yield ": ping\n\n"
                        continue
                    yield f"data: {json.dumps(event)}\n\n"
            except Exception as e:
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': llm_error_message(e)})}\n\n"
            finally:
                yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class OrchestrateStreamRequest(BaseModel):
    scenario_id: str
    foley_id: str | None = None
    speech_id: str | None = None
    # Optional inline (user-edited) foley/speech results. When provided, they take
    # precedence over loading the saved JSON files, so the frontend can feed back
    # its edits (deleted cards, removed speech lines, changed copy counts) into
    # the orchestrate input at generation time.
    foley_data: dict | None = None
    speech_data: dict | None = None
    llm_model: str = DEFAULT_LLM_MODEL


@router.post("/api/orchestrate-stream")
async def orchestrate_stream(request: OrchestrateStreamRequest):
    """SSE endpoint: streams orchestrated playlist entries one by one.

    Loads scenario, foley, and speech JSON files from disk (or uses inline
    user-edited foley_data / speech_data), then calls the orchestrate agent to
    compile the final parametric audio playlist.

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

    scenario_file = Path(TEMP_ANALYSIS_DIR) / f"scenarios_{request.scenario_id}.json"
    if not scenario_file.exists():
        return StreamingResponse(
            make_error_stream("Scenario not found"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── Resolve foley input: inline (user-edited) or saved file ─────────────
    foley_data: dict | None = None
    if request.foley_data is not None:
        foley_data = request.foley_data
    else:
        if not request.foley_id or not _re.match(r'^[0-9a-f-]+$', request.foley_id):
            return StreamingResponse(
                make_error_stream("Invalid foley_id"),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        foley_file = Path(TEMP_ANALYSIS_DIR) / f"foley_{request.foley_id}.json"
        if not foley_file.exists():
            return StreamingResponse(
                make_error_stream("Foley result not found"),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        try:
            with open(foley_file, "r", encoding="utf-8") as f:
                foley_data = json.load(f)
        except Exception as e:
            return StreamingResponse(
                make_error_stream(f"Failed to load foley data: {e}"),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

    # ── Resolve speech input: inline (user-edited) or saved file ────────────
    speech_data: dict | None = None
    if request.speech_data is not None:
        speech_data = request.speech_data
    else:
        if not request.speech_id or not _re.match(r'^[0-9a-f-]+$', request.speech_id):
            return StreamingResponse(
                make_error_stream("Invalid speech_id"),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        speech_file = Path(TEMP_ANALYSIS_DIR) / f"speech_{request.speech_id}.json"
        if not speech_file.exists():
            return StreamingResponse(
                make_error_stream("Speech result not found"),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        try:
            with open(speech_file, "r", encoding="utf-8") as f:
                speech_data = json.load(f)
        except Exception as e:
            return StreamingResponse(
                make_error_stream(f"Failed to load speech data: {e}"),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

    try:
        with open(scenario_file, "r", encoding="utf-8") as f:
            scenario_data = json.load(f)
    except Exception as e:
        return StreamingResponse(
            make_error_stream(f"Failed to load data: {e}"),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def event_generator():
        async with LLM_SEMAPHORE:
            try:
                stream = llm_service.stream_orchestrate_agent(
                    scenarist_agent_result=scenario_data,
                    foley_result=foley_data,
                    speech_result=speech_data,
                    llm_model=request.llm_model,
                )
                async for kind, event in iter_with_keepalive(stream):
                    if kind == "ping":
                        yield ": ping\n\n"
                        continue
                    yield f"data: {json.dumps(event)}\n\n"
            except Exception as e:
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': llm_error_message(e)})}\n\n"
            finally:
                yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
