"""Request-level logic for the research-study logger (``routers/study.py``).

Turns validated client input into ``study_log_store`` rows stamped with the
server-side identity, and writes moment screenshots to
``data/study/moments/<workspace_id>/<moment_id>.<ext>``. All functions are
synchronous; the router calls them through ``asyncio.to_thread``.
"""

import logging
import threading
import uuid
from pathlib import Path
from typing import Any, Optional

import config.constants as constants
from config.constants import STUDY_MAX_SCREENSHOT_BYTES
from models.schemas import StudyEvent, StudyMomentIn
from services.study_audio_archive import safe_path_component
from services.study_log_store import SOURCE_CLIENT, now_ms, study_log_store
from utils.image_data_url import decode_image_data_url

logger = logging.getLogger(__name__)


class StudyPayloadTooLarge(ValueError):
    """Input exceeds a STUDY_MAX_* cap (mapped to HTTP 413)."""


# user_hashes already registered as participants by this process.
_registered: set[str] = set()
_registered_lock = threading.Lock()


def ensure_participant(user_hash: Optional[str]) -> Optional[str]:
    """Register on first sight; returns the pseudonym (None without identity)."""
    pseudonym = study_log_store.register_participant(user_hash)
    if user_hash:
        with _registered_lock:
            _registered.add(user_hash)
    return pseudonym


def parse_events(raw_events: list[Any]) -> tuple[list[StudyEvent], int]:
    """Validate each event on its own; return ``(valid, rejected_count)``.

    One malformed event must not make the client retry (and re-fail) the whole batch.
    """
    valid: list[StudyEvent] = []
    rejected = 0
    for raw in raw_events:
        try:
            valid.append(StudyEvent.model_validate(raw))
        except Exception:  # noqa: BLE001 - pydantic ValidationError or non-dict
            rejected += 1
    if rejected:
        logger.warning("Study: dropped %d malformed event(s)", rejected)
    return valid, rejected


def store_events(
    events: list[StudyEvent], user_hash: Optional[str], workspace_id: Optional[str]
) -> int:
    """Insert client events (dedupe by id); return how many were new."""
    if user_hash and user_hash not in _registered:
        ensure_participant(user_hash)
    ts_server = now_ms()
    rows = [
        {
            **event.model_dump(),
            "ts_server": ts_server,
            "user_hash": user_hash,
            "workspace_id": workspace_id,
            "source": SOURCE_CLIENT,
        }
        for event in events
    ]
    return study_log_store.insert_events(rows)


def collect_audio_refs(events: list[StudyEvent]) -> list[tuple[str, str]]:
    """``[(event_id, url), ...]`` for every string in each ``payload.audio_refs``."""
    pairs: list[tuple[str, str]] = []
    for event in events:
        refs = event.payload.get("audio_refs")
        if isinstance(refs, list):
            pairs.extend((event.id, ref) for ref in refs if isinstance(ref, str) and ref)
    return pairs


def _save_screenshot(data_url: str, workspace_id: Optional[str], moment_id: str) -> str:
    """Write the decoded image; return its path relative to STUDY_MOMENTS_DIR."""
    _, _, encoded = data_url.partition(",")
    if len(encoded) * 3 // 4 > STUDY_MAX_SCREENSHOT_BYTES:
        raise StudyPayloadTooLarge("Screenshot is too large")
    raw, ext = decode_image_data_url(data_url, STUDY_MAX_SCREENSHOT_BYTES)
    ws = safe_path_component(workspace_id)
    target = Path(constants.STUDY_MOMENTS_DIR) / ws / f"{moment_id}.{ext}"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    return f"{ws}/{target.name}"


def create_moment(
    moment: StudyMomentIn,
    user_hash: Optional[str],
    workspace_id: Optional[str],
    keep_screenshot: bool,
) -> str:
    """Store a moment (+ optional screenshot); return its id. ``ValueError`` on bad image."""
    moment_id = uuid.uuid4().hex
    screenshot_path = None
    if keep_screenshot and moment.screenshot:
        screenshot_path = _save_screenshot(moment.screenshot, workspace_id, moment_id)
    study_log_store.create_moment({
        "id": moment_id,
        "event_id": moment.event_id,
        "user_hash": user_hash,
        "workspace_id": workspace_id,
        "screenshot_path": screenshot_path,
        "snapshot_hash": moment.snapshot_hash,
        "ts_client": moment.ts_client,
        "ts_server": now_ms(),
    })
    return moment_id
