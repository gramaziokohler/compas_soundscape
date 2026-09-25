"""
Text / LLM generation endpoints.

Prompt streaming (generate-prompts-stream) still uses SSE.
Agent jobs (analyze-3dmodel, scenarist, foley, speech, orchestrate) enqueue
as IO jobs -- poll GET /api/jobs/{id} for thought-summary progress.
"""
from __future__ import annotations

import json
import re as _re
import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.llm_service import LLMService, LLMCancelled
from services.io_jobs import start_io_job
from services.job_store import job_store
from models.schemas import (
    UnifiedPromptGenerationRequest,
    ScenaristStreamRequest,
    FoleyArtistRequest,
    JobEnqueueResponse,
)
from config.constants import (
    TEMP_ANALYSIS_DIR,
    DEFAULT_LLM_MODEL,
    JOB_TYPE_LLM,
    LLM_PROGRESS_THINKING_MIN,
    LLM_PROGRESS_THINKING_MAX,
    LLM_PROGRESS_WRITING_MIN,
    LLM_PROGRESS_WRITING_MAX,
)
from utils.llm_errors import llm_error_message

router = APIRouter()

# Injected by main.py
llm_service = None


def init_generation_router(service: LLMService):
    global llm_service
    llm_service = service


def _load_analysis_groups(analysis_id: str) -> tuple[list[dict], str]:
    """Load the full 3D model analysis JSON and project it into linkable groups.

    Returns (entities, space_description). Each group entity carries its whole
    group — name/description/material and ALL Speckle object ids + union bounds —
    so a generated sound can link to every object in the group.
    """
    import re as _re

    if not _re.match(r'^[0-9a-f-]+$', analysis_id):
        return [], ""

    analysis_file = Path(TEMP_ANALYSIS_DIR) / f"analysis_{analysis_id}.json"
    if not analysis_file.exists():
        return [], ""

    try:
        with open(analysis_file, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as load_err:
        print(f"[generate-prompts] failed to load analysis {analysis_id}: {load_err}")
        return [], ""

    space_description = raw.get("space_description") or ""
    total_bounds = (raw.get("meta") or {}).get("total_bounds")

    entities: list[dict] = []
    for i, obj in enumerate(raw.get("objects", []) or []):
        object_ids = obj.get("object_ids")
        if isinstance(object_ids, dict):
            ids = [k for k in object_ids.keys()]
            per_obj_bounds = [v for v in object_ids.values() if isinstance(v, dict)]
        elif isinstance(object_ids, list):
            ids = [str(k) for k in object_ids]
            per_obj_bounds = []
        else:
            ids = []
            per_obj_bounds = []

        # Union the per-object bounds into a single group bounds (if available).
        mins = [b.get("min_bounds") for b in per_obj_bounds if b.get("min_bounds")]
        maxs = [b.get("max_bounds") for b in per_obj_bounds if b.get("max_bounds")]
        bounds = None
        if mins and maxs:
            mn = [min(v[i] for v in mins) for i in range(3)]
            mx = [max(v[i] for v in maxs) for i in range(3)]
            bounds = {"min": mn, "max": mx, "center": [(mn[i] + mx[i]) / 2 for i in range(3)]}

        entities.append({
            "index": i,
            "type": "architectural object",
            "speckle_type": "architectural object",
            "name": obj.get("name") or obj.get("description") or f"Object {i + 1}",
            "description": obj.get("description") or "",
            "material": obj.get("material") or "",
            "quantity": obj.get("quantity"),
            "layer": "",
            "object_ids": ids,
            "bounds": bounds,
            "total_bounds": total_bounds,
        })

    return entities, space_description


_UUID_RE = _re.compile(r"^[0-9a-f-]+$")


def _session_id(req: Request) -> str | None:
    return getattr(getattr(req, "state", None), "session_id", None)


def _llm_progress_value(phase: str, thought: str) -> int:
    n = min(len(thought or ""), 800)
    frac = n / 800.0
    if phase == "thinking":
        lo, hi = LLM_PROGRESS_THINKING_MIN, LLM_PROGRESS_THINKING_MAX
    else:
        lo, hi = LLM_PROGRESS_WRITING_MIN, LLM_PROGRESS_WRITING_MAX
    return lo + int((hi - lo) * frac)


def _make_on_progress(job_id: str, partial: dict):
    async def on_progress(evt: dict) -> None:
        if await job_store.is_cancel_requested(job_id):
            raise LLMCancelled()
        partial["thinking"] = evt.get("thought") or ""
        partial["phase"] = evt.get("phase") or "thinking"
        text = evt.get("text") or "Thinking…"
        value = _llm_progress_value(str(partial["phase"]), str(partial["thinking"]))
        await job_store.set_progress(job_id, value, text, partial=partial)

    return on_progress


def _load_furniture_list(analysis_id: str | None) -> dict | None:
    if not analysis_id or not _UUID_RE.match(analysis_id):
        return None
    analysis_file = Path(TEMP_ANALYSIS_DIR) / f"analysis_{analysis_id}.json"
    if not analysis_file.exists():
        return None
    try:
        with open(analysis_file, "r", encoding="utf-8") as f:
            raw = json.load(f)
        total_bounds = (raw.get("meta") or {}).get("total_bounds")
        furniture_list: dict = {"architecturalObjects": raw.get("objects", [])}
        if total_bounds:
            furniture_list["meta"] = {"total_bounds": total_bounds}
        return furniture_list
    except Exception as load_err:
        print(f"[generation] failed to load analysis {analysis_id}: {load_err}")
        return None


def _load_json_id_file(prefix: str, file_id: str, label: str) -> dict:
    if not _UUID_RE.match(file_id):
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    path = Path(TEMP_ANALYSIS_DIR) / f"{prefix}_{file_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{label} not found")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load {label}: {e}")


def _total_bounds_from_entities(entities: list[dict]) -> dict | None:
    try:
        xs_min, ys_min, zs_min = [], [], []
        xs_max, ys_max, zs_max = [], [], []
        for _e in entities:
            _b = _e.get("bounds")
            if not _b:
                continue
            _mn = _b.get("min") or []
            _mx = _b.get("max") or []
            if len(_mn) >= 3 and len(_mx) >= 3:
                xs_min.append(_mn[0]); ys_min.append(_mn[1]); zs_min.append(_mn[2])
                xs_max.append(_mx[0]); ys_max.append(_mx[1]); zs_max.append(_mx[2])
        if not xs_min:
            return None
        min_x, min_y, min_z = min(xs_min), min(ys_min), min(zs_min)
        max_x, max_y, max_z = max(xs_max), max(ys_max), max(zs_max)
        return {
            "min": [round(min_x, 3), round(min_y, 3), round(min_z, 3)],
            "max": [round(max_x, 3), round(max_y, 3), round(max_z, 3)],
            "width": round(max_x - min_x, 3),
            "depth": round(max_y - min_y, 3),
            "height": round(max_z - min_z, 3),
        }
    except Exception:
        return None


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
            context = request.context
            entities = request.entities

            # Analysis-driven path: project the full analysis result through the shared
            # `_create_base_sound_prompt` text strategy (whole-group ENTITY mapping).
            if request.analysis_id:
                groups, space_description = _load_analysis_groups(request.analysis_id)
                if groups:
                    yield f"data: {json.dumps({'type': 'entities', 'entities': groups})}\n\n"
                    async for sound in llm_service.stream_generate_analysis_prompts(
                        groups,
                        space_description,
                        request.context,
                        request.num_sounds,
                        llm_model=request.llm_model,
                    ):
                        sound["type"] = "sound"
                        yield f"data: {json.dumps(sound)}\n\n"
                    return

            if entities and len(entities) > 0:
                entities_to_use = entities
                if len(entities) > request.num_sounds * 1.5:
                    entities_to_use = await llm_service.select_diverse_entities(
                        entities, request.num_sounds, llm_model=request.llm_model
                    )
                yield f"data: {json.dumps({'type': 'entities', 'entities': entities_to_use})}\n\n"
                async for sound in llm_service.stream_generate_prompts_for_entities(
                    entities_to_use, request.num_sounds, context, llm_model=request.llm_model
                ):
                    # Resolve entity_indices â†’ fully-hydrated entities list so the frontend
                    # doesn't need to re-resolve from an index cache.
                    entity_indices = sound.get("entity_indices", [])
                    sound["entities"] = [
                        entities_to_use[i]
                        for i in entity_indices
                        if 0 <= i < len(entities_to_use)
                    ]
                    sound["type"] = "sound"
                    yield f"data: {json.dumps(sound)}\n\n"

            elif context and context.strip():
                async for sound in llm_service.stream_generate_text_based_prompts(
                    context, request.num_sounds, llm_model=request.llm_model
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


# â”€â”€â”€ 3D Model Analysis (pollable IO job) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class AnalyzeModelRequest(BaseModel):
    entities: list[dict]
    screenshots: list[str] = []
    user_context: str = ""
    llm_model: str = DEFAULT_LLM_MODEL


@router.post("/api/analyze-3dmodel", response_model=JobEnqueueResponse)
async def analyze_3dmodel(request: AnalyzeModelRequest, req: Request):
    """Enqueue 3D-model analysis. Poll GET /api/jobs/{job_id} for thought progress
    and incremental objects in ``partial.items``.
    """
    analysis_id = str(uuid.uuid4())
    entities = list(request.entities)
    screenshots = list(request.screenshots or [])
    user_context = request.user_context or ""
    llm_model = request.llm_model

    async def _run(job_id: str) -> None:
        objects: list[dict] = []
        space_title = ""
        space_description = ""
        partial: dict = {
            "kind": "analyze_3dmodel",
            "analysis_id": analysis_id,
            "thinking": "",
            "phase": "thinking",
            "items": objects,
            "space_title": "",
            "space_description": "",
        }
        await job_store.set_progress(job_id, 5, "Analyzing 3D model…", partial=partial)
        on_progress = _make_on_progress(job_id, partial)
        try:
            stream = llm_service.stream_analyze_3dmodel(
                entities,
                screenshots=screenshots or None,
                user_context=user_context or None,
                llm_model=llm_model,
                on_progress=on_progress,
            )
            async for event in stream:
                if await job_store.is_cancel_requested(job_id):
                    raise LLMCancelled()
                etype = event.get("type")
                if etype == "space_title":
                    space_title = event.get("text", "")
                    partial["space_title"] = space_title
                    await job_store.set_progress(
                        job_id, 40,
                        "Writing JSON…", partial=partial,
                    )
                elif etype == "space_description":
                    space_description = event.get("text", "")
                    partial["space_description"] = space_description
                    await job_store.set_progress(job_id, 45, "Writing JSON…", partial=partial)
                else:
                    obj = {k: v for k, v in event.items() if k != "type"}
                    objects.append(obj)
                    await job_store.set_progress(
                        job_id,
                        min(40 + len(objects) * 3, 90),
                        f"Identified {len(objects)} object{'s' if len(objects) != 1 else ''}…",
                        partial=partial,
                    )
        except LLMCancelled:
            await job_store.mark_cancelled(job_id)
            return

        total_bounds = _total_bounds_from_entities(entities)
        payload: dict = {
            "kind": "analyze_3dmodel",
            "analysis_id": analysis_id,
            "objects": objects,
        }
        if space_title:
            payload["space_title"] = space_title
        if space_description:
            payload["space_description"] = space_description
        if total_bounds:
            payload["meta"] = {"total_bounds": total_bounds}
        try:
            analysis_dir = Path(TEMP_ANALYSIS_DIR)
            analysis_dir.mkdir(parents=True, exist_ok=True)
            result_file = analysis_dir / f"analysis_{analysis_id}.json"
            tmp_file = result_file.with_suffix(".tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            tmp_file.replace(result_file)
        except Exception as save_err:
            print(f"[analyze-3dmodel] Failed to save result: {save_err}")

        await job_store.complete(job_id, payload)

    job_id = await start_io_job(JOB_TYPE_LLM, _session_id(req), _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)


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


@router.post("/api/scenarist", response_model=JobEnqueueResponse)
async def scenarist(request: ScenaristStreamRequest, req: Request):
    """Enqueue scenarist agent. Poll GET /api/jobs/{job_id} for thought progress."""
    furniture_list = _load_furniture_list(request.analysis_id)
    user_context = request.user_context
    llm_model = request.llm_model
    duration = request.duration
    people_count = request.people_count
    likeliness = request.likeliness

    async def _run(job_id: str) -> None:
        partial: dict = {"kind": "scenarist", "thinking": "", "phase": "thinking", "items": []}
        await job_store.set_progress(job_id, 5, "Imagining usage scenarios…", partial=partial)
        on_progress = _make_on_progress(job_id, partial)
        done: dict | None = None
        try:
            stream = llm_service.stream_scenarist_agent(
                user_context=user_context,
                llm_model=llm_model,
                furniture_list=furniture_list,
                duration=duration,
                people_count=people_count,
                likeliness=likeliness,
                on_progress=on_progress,
            )
            async for event in stream:
                if await job_store.is_cancel_requested(job_id):
                    raise LLMCancelled()
                etype = event.get("type")
                if etype == "error":
                    await job_store.fail(job_id, event.get("message") or "Scenarist failed")
                    return
                if etype == "done":
                    done = event
                    continue
                if etype in ("scenario", "event"):
                    partial.setdefault("items", []).append(event)
                    await job_store.set_progress(job_id, 90, "Writing JSON…", partial=partial)
        except LLMCancelled:
            await job_store.mark_cancelled(job_id)
            return

        if not done:
            await job_store.fail(job_id, "Scenarist produced no result")
            return
        result = done.get("result") or {}
        payload = {
            "kind": "scenarist",
            "scenario_id": done.get("scenario_id"),
            **result,
        }
        await job_store.complete(job_id, payload)

    job_id = await start_io_job(JOB_TYPE_LLM, _session_id(req), _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)


@router.post("/api/foley-artist", response_model=JobEnqueueResponse)
async def foley_artist(request: FoleyArtistRequest, req: Request):
    """Enqueue foley artist. Poll GET /api/jobs/{job_id} for thought progress."""
    scenario_data = _load_json_id_file("scenarios", request.scenario_id, "scenario_id")
    furniture_list = _load_furniture_list(request.analysis_id)
    maximum_sounds = request.maximum_sounds
    llm_model = request.llm_model

    async def _run(job_id: str) -> None:
        partial: dict = {"kind": "foley", "thinking": "", "phase": "thinking", "items": []}
        await job_store.set_progress(job_id, 5, "Crafting foley prompts…", partial=partial)
        on_progress = _make_on_progress(job_id, partial)
        done: dict | None = None
        try:
            stream = llm_service.stream_foley_artist(
                scenarist_agent_result=scenario_data,
                furniture_list=furniture_list,
                maximum_number_of_sounds=maximum_sounds,
                llm_model=llm_model,
                on_progress=on_progress,
            )
            async for event in stream:
                if await job_store.is_cancel_requested(job_id):
                    raise LLMCancelled()
                etype = event.get("type")
                if etype == "error":
                    await job_store.fail(job_id, event.get("message") or "Foley artist failed")
                    return
                if etype == "done":
                    done = event
                    continue
                if etype == "sound":
                    partial.setdefault("items", []).append(event.get("sound"))
                    await job_store.set_progress(
                        job_id, 90,
                        f"Identified {len(partial['items'])} foley sound{'s' if len(partial['items']) != 1 else ''}…",
                        partial=partial,
                    )
        except LLMCancelled:
            await job_store.mark_cancelled(job_id)
            return

        if not done:
            await job_store.fail(job_id, "Foley artist produced no result")
            return
        sounds = (done.get("result") or {}).get("sounds") or partial.get("items") or []
        title = ((scenario_data.get("scenarios") or [{}])[0].get("title")) or "Scenario"
        payload = {
            "kind": "foley",
            "foley_id": done.get("foley_id"),
            "sounds": sounds,
            "scenarios": [{"scenario_title": title, "sound_events": sounds}],
        }
        await job_store.complete(job_id, payload)

    job_id = await start_io_job(JOB_TYPE_LLM, _session_id(req), _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)


class SpeechAgentRequest(BaseModel):
    scenario_id: str
    analysis_id: str | None = None
    llm_model: str = DEFAULT_LLM_MODEL
    language: str | None = None


@router.post("/api/speech-agent", response_model=JobEnqueueResponse)
async def speech_agent(request: SpeechAgentRequest, req: Request):
    """Enqueue speech agent. Poll GET /api/jobs/{job_id} for thought progress."""
    scenario_data = _load_json_id_file("scenarios", request.scenario_id, "scenario_id")
    furniture_list = _load_furniture_list(request.analysis_id)
    llm_model = request.llm_model
    language = request.language

    async def _run(job_id: str) -> None:
        partial: dict = {"kind": "speech", "thinking": "", "phase": "thinking", "items": []}
        await job_store.set_progress(job_id, 5, "Writing dialogue…", partial=partial)
        on_progress = _make_on_progress(job_id, partial)
        done: dict | None = None
        try:
            stream = llm_service.stream_speech_agent(
                scenarist_agent_result=scenario_data,
                furniture_list=furniture_list,
                llm_model=llm_model,
                language=language,
                on_progress=on_progress,
            )
            async for event in stream:
                if await job_store.is_cancel_requested(job_id):
                    raise LLMCancelled()
                etype = event.get("type")
                if etype == "error":
                    await job_store.fail(job_id, event.get("message") or "Speech agent failed")
                    return
                if etype == "done":
                    done = event
                    continue
                if etype == "speech":
                    partial.setdefault("items", []).append(event.get("speech"))
                    await job_store.set_progress(
                        job_id, 90,
                        f"Drafted {len(partial['items'])} speech block{'s' if len(partial['items']) != 1 else ''}…",
                        partial=partial,
                    )
        except LLMCancelled:
            await job_store.mark_cancelled(job_id)
            return

        if not done:
            await job_store.fail(job_id, "Speech agent produced no result")
            return
        speeches = (done.get("result") or {}).get("speeches") or partial.get("items") or []
        payload = {
            "kind": "speech",
            "speech_id": done.get("speech_id"),
            "speeches": speeches,
        }
        await job_store.complete(job_id, payload)

    job_id = await start_io_job(JOB_TYPE_LLM, _session_id(req), _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)


class OrchestrateRequest(BaseModel):
    scenario_id: str
    foley_id: str | None = None
    speech_id: str | None = None
    foley_data: dict | None = None
    speech_data: dict | None = None
    llm_model: str = DEFAULT_LLM_MODEL
    # "initial" for the first orchestration of a scenario, "reorchestrate" for a
    # re-run on the user's edited scene (adds re-orchestration prompt guidance).
    mode: str = "initial"


@router.post("/api/orchestrate", response_model=JobEnqueueResponse)
async def orchestrate(request: OrchestrateRequest, req: Request):
    """Enqueue orchestrate agent. Poll GET /api/jobs/{job_id} for thought progress."""
    scenario_data = _load_json_id_file("scenarios", request.scenario_id, "scenario_id")
    if request.foley_data is not None:
        foley_data = request.foley_data
    else:
        if not request.foley_id:
            raise HTTPException(status_code=400, detail="Invalid foley_id")
        foley_data = _load_json_id_file("foley", request.foley_id, "foley_id")
    if request.speech_data is not None:
        speech_data = request.speech_data
    else:
        if not request.speech_id:
            raise HTTPException(status_code=400, detail="Invalid speech_id")
        speech_data = _load_json_id_file("speech", request.speech_id, "speech_id")
    llm_model = request.llm_model

    async def _run(job_id: str) -> None:
        partial: dict = {"kind": "orchestrate", "thinking": "", "phase": "thinking", "items": []}
        await job_store.set_progress(job_id, 5, "Orchestrating timeline…", partial=partial)
        on_progress = _make_on_progress(job_id, partial)
        done: dict | None = None
        try:
            stream = llm_service.stream_orchestrate_agent(
                scenarist_agent_result=scenario_data,
                foley_result=foley_data,
                speech_result=speech_data,
                llm_model=llm_model,
                on_progress=on_progress,
                mode=request.mode,
            )
            async for event in stream:
                if await job_store.is_cancel_requested(job_id):
                    raise LLMCancelled()
                etype = event.get("type")
                if etype == "error":
                    await job_store.fail(job_id, event.get("message") or "Orchestrate failed")
                    return
                if etype == "done":
                    done = event
                    continue
                if etype == "entry":
                    partial.setdefault("items", []).append(event.get("entry"))
                    n = len(partial["items"])
                    await job_store.set_progress(
                        job_id, 90,
                        f"Orchestrating timeline… {n} sound{'s' if n != 1 else ''}",
                        partial=partial,
                    )
        except LLMCancelled:
            await job_store.mark_cancelled(job_id)
            return

        if not done:
            await job_store.fail(job_id, "Orchestrate produced no result")
            return
        playlist = (done.get("result") or {}).get("playlist") or partial.get("items") or []
        payload = {
            "kind": "orchestrate",
            "orchestrate_id": done.get("orchestrate_id"),
            "playlist": playlist,
        }
        await job_store.complete(job_id, payload)

    job_id = await start_io_job(JOB_TYPE_LLM, _session_id(req), _run)
    return JobEnqueueResponse(job_id=job_id, position=1, total=1)
