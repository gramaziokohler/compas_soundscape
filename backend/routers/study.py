"""Research-study interaction logging (``/api/study``).

Every route is a 404 unless ``STUDY_LOGGING_ENABLED`` is on (and, for the
gated routes, the feature's kill switch). Identity (user / workspace) comes
only from ``request.state`` set by ``SessionMiddleware`` — never from the body.
There is intentionally no listing endpoint: logs are exported on the server
with ``python scripts/export_study_logs.py``.

Bodies are read raw so ``POST /events`` also accepts the ``text/plain`` JSON
that ``navigator.sendBeacon`` sends on page hide, and so size caps (413) are
enforced while streaming instead of after parsing.
"""

import asyncio
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ValidationError

from config.constants import (
    STUDY_FLUSH_INTERVAL_MS,
    STUDY_MAX_BATCH_BYTES,
    STUDY_MAX_BATCH_EVENTS,
    STUDY_MAX_ID_CHARS,
    STUDY_MAX_KNOWN_HASHES,
    STUDY_MAX_MOMENT_BODY_BYTES,
    STUDY_MAX_SNAPSHOT_BODY_BYTES,
    STUDY_MAX_SNAPSHOT_BYTES,
)
from models.schemas import (
    StudyConfig,
    StudyEventBatch,
    StudyEventsAccepted,
    StudyFeatures,
    StudyKnownSnapshots,
    StudyMomentIn,
    StudyMomentNote,
    StudyMomentOut,
    StudyOk,
    StudySnapshotIn,
    StudySnapshotOut,
)
from services import study_service
from services.study_audio_archive import archive_event_refs
from services.study_config import client_features, study_enabled, study_feature
from services.study_log_store import study_log_store

logger = logging.getLogger(__name__)


def _require_enabled() -> None:
    if not study_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _require_feature(name: str) -> None:
    if not study_feature(name):
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(prefix="/api/study", tags=["study"], dependencies=[Depends(_require_enabled)])


def _identity(request: Request) -> tuple[Optional[str], Optional[str]]:
    return (
        getattr(request.state, "user_hash", None),
        getattr(request.state, "workspace_id", None) or None,
    )


async def _read_json(request: Request, max_bytes: int) -> Any:
    """Read the raw body (any content type) with a streaming size cap → parsed JSON."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(status_code=413, detail="Request body too large")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(status_code=413, detail="Request body too large")
        chunks.append(chunk)
    try:
        return json.loads(b"".join(chunks) or b"null")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Body must be JSON") from exc


def _validate(model: type[BaseModel], data: Any) -> Any:
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from exc


@router.get("/config", response_model=StudyConfig)
async def get_study_config(request: Request) -> StudyConfig:
    """Study switches for the client; registers the caller as a participant."""
    user_hash, _ = _identity(request)
    try:
        pseudonym = await asyncio.to_thread(study_service.ensure_participant, user_hash)
    except Exception as exc:  # noqa: BLE001 - config must still answer
        logger.warning("Study participant registration failed: %s", exc)
        pseudonym = None
    return StudyConfig(
        enabled=True,
        pseudonym=pseudonym,
        flush_interval_ms=STUDY_FLUSH_INTERVAL_MS,
        max_batch_events=STUDY_MAX_BATCH_EVENTS,
        features=StudyFeatures(**client_features()),
    )


@router.post("/events", response_model=StudyEventsAccepted)
async def post_study_events(request: Request, background_tasks: BackgroundTasks) -> StudyEventsAccepted:
    """Store a batch of client events (JSON or sendBeacon text/plain).

    ``accepted`` counts the valid events in the batch (newly stored or already
    present — retries are idempotent by event id); malformed events are dropped.
    """
    batch: StudyEventBatch = _validate(StudyEventBatch, await _read_json(request, STUDY_MAX_BATCH_BYTES))
    if len(batch.events) > STUDY_MAX_BATCH_EVENTS:
        raise HTTPException(status_code=413, detail=f"At most {STUDY_MAX_BATCH_EVENTS} events per batch")
    events, _ = study_service.parse_events(batch.events)
    user_hash, workspace_id = _identity(request)
    await asyncio.to_thread(study_service.store_events, events, user_hash, workspace_id)
    if study_feature("audio_archive"):
        pairs = study_service.collect_audio_refs(events)
        if pairs:
            background_tasks.add_task(archive_event_refs, pairs, workspace_id)
    return StudyEventsAccepted(accepted=len(events))


@router.post("/snapshots", response_model=StudySnapshotOut)
async def post_study_snapshot(request: Request) -> StudySnapshotOut:
    """Store a design-state snapshot once per client hash."""
    _require_feature("snapshots")
    snap: StudySnapshotIn = _validate(
        StudySnapshotIn, await _read_json(request, STUDY_MAX_SNAPSHOT_BODY_BYTES)
    )
    if len(snap.json_text.encode("utf-8")) > STUDY_MAX_SNAPSHOT_BYTES:
        raise HTTPException(status_code=413, detail="Snapshot too large")
    user_hash, workspace_id = _identity(request)
    stored = await asyncio.to_thread(
        study_log_store.insert_snapshot, snap.hash, snap.json_text, user_hash, workspace_id
    )
    return StudySnapshotOut(hash=snap.hash, stored=stored)


@router.get("/snapshots/known", response_model=StudyKnownSnapshots)
async def get_known_snapshots(hashes: str = Query("")) -> StudyKnownSnapshots:
    """Which of the comma-separated client hashes the server already has."""
    _require_feature("snapshots")
    wanted = [h for h in (s.strip() for s in hashes.split(",")) if h and len(h) <= STUDY_MAX_ID_CHARS]
    known = await asyncio.to_thread(study_log_store.known_snapshots, wanted[:STUDY_MAX_KNOWN_HASHES])
    return StudyKnownSnapshots(known=known)


@router.post("/moments", response_model=StudyMomentOut)
async def post_study_moment(request: Request) -> StudyMomentOut:
    """Create a self-flagged moment; the screenshot is kept only while that feature is on."""
    moment: StudyMomentIn = _validate(StudyMomentIn, await _read_json(request, STUDY_MAX_MOMENT_BODY_BYTES))
    user_hash, workspace_id = _identity(request)
    try:
        moment_id = await asyncio.to_thread(
            study_service.create_moment, moment, user_hash, workspace_id, study_feature("moment_screenshot")
        )
    except study_service.StudyPayloadTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StudyMomentOut(id=moment_id)


@router.post("/moments/{moment_id}/note", response_model=StudyOk)
async def post_study_moment_note(moment_id: str, request: Request) -> StudyOk:
    """Attach the note + tags to a moment. Only its creator may annotate it."""
    note: StudyMomentNote = _validate(StudyMomentNote, await _read_json(request, STUDY_MAX_BATCH_BYTES))
    user_hash, _ = _identity(request)
    moment = await asyncio.to_thread(study_log_store.get_moment, moment_id[:STUDY_MAX_ID_CHARS])
    if moment is None:
        raise HTTPException(status_code=404, detail="Moment not found")
    if not user_hash or moment["user_hash"] != user_hash:
        raise HTTPException(status_code=403, detail="Only the participant who created this moment can annotate it")
    tags = [str(t)[:STUDY_MAX_ID_CHARS] for t in note.tags]
    await asyncio.to_thread(study_log_store.note_moment, moment["id"], note.note, tags)
    return StudyOk()
