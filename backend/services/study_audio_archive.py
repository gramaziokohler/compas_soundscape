"""Archive the audio files that study events refer to (``payload.audio_refs``).

Generated sounds live in ``temp/`` (aged out by the janitor) and saved
soundscapes are overwritten in place, so each audio URL a participant used is
copied once to ``data/study/audio/<workspace_id>/<mount>/<relative path>`` and
recorded in ``study_audio``. URLs map to files through the same roots the
static mounts serve (``STUDY_ARCHIVE_URL_ROOTS``); anything resolving outside
them is refused. Copying stops while free disk is below
``STUDY_ARCHIVE_MIN_FREE_GB`` (one ``archive.paused`` server event per pause).

Runs as a FastAPI background task (thread pool). ``archive_urls`` never raises.
"""

import hashlib
import logging
import re
import shutil
import threading
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import unquote, urlsplit

import config.constants as constants
from config.constants import STUDY_ARCHIVE_EXTENSIONS, STUDY_ARCHIVE_URL_ROOTS
from services.study_log_store import now_ms, study_log_store

logger = logging.getLogger(__name__)

_SAFE_COMPONENT = re.compile(r"[^A-Za-z0-9_.-]")
_HASH_CHUNK = 1024 * 1024

# One archive.paused event per low-disk episode (reset after a successful copy).
_pause_lock = threading.Lock()
_paused = False


def safe_path_component(value: Optional[str], fallback: str = "unknown") -> str:
    """A single filesystem-safe path segment (workspace ids, moment ids)."""
    cleaned = _SAFE_COMPONENT.sub("_", value or "").strip(".")
    return cleaned[:128] or fallback


def resolve_audio_url(url: str) -> Optional[tuple[str, Path, str]]:
    """Map an app audio URL to ``(normalized_url, file, archive_relpath)`` or None.

    Accepts absolute or relative URLs; the origin and query string are dropped.
    Returns None for URLs outside the archived mounts, path traversal attempts,
    non-audio extensions and missing files.
    """
    path = unquote(urlsplit(url.strip()).path)
    for prefix, root in STUDY_ARCHIVE_URL_ROOTS.items():
        if not path.startswith(prefix + "/"):
            continue
        rel = path[len(prefix) + 1:]
        root_resolved = Path(root).resolve()
        target = (root_resolved / rel).resolve()
        if not target.is_relative_to(root_resolved) or target == root_resolved:
            return None
        if target.suffix.lower() not in STUDY_ARCHIVE_EXTENSIONS or not target.is_file():
            return None
        archive_rel = Path(prefix.strip("/")) / target.relative_to(root_resolved)
        return path, target, archive_rel.as_posix()
    return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(_HASH_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _has_free_space(workspace_id: Optional[str]) -> bool:
    """False (and one archive.paused event) while free disk is below the guard."""
    global _paused
    audio_dir = Path(constants.STUDY_AUDIO_DIR)
    audio_dir.mkdir(parents=True, exist_ok=True)
    free_bytes = shutil.disk_usage(audio_dir).free
    min_bytes = constants.STUDY_ARCHIVE_MIN_FREE_GB * 1024 ** 3
    if free_bytes >= min_bytes:
        return True
    with _pause_lock:
        first = not _paused
        _paused = True
    if first:
        logger.warning("Study audio archive paused: %.1f GB free", free_bytes / 1024 ** 3)
        study_log_store.log_server_event_nowait(
            "archive.paused",
            {"free_bytes": free_bytes, "min_free_bytes": min_bytes},
            None,
            workspace_id,
        )
    return False


def _archive_one(url: str, workspace_id: Optional[str], event_id: Optional[str]) -> bool:
    global _paused
    resolved = resolve_audio_url(url)
    if resolved is None:
        logger.debug("Study archive skipped %s (not an archivable audio file)", url)
        return False
    norm_url, source, archive_rel = resolved
    if study_log_store.is_audio_archived(norm_url):
        return False
    if not _has_free_space(workspace_id):
        return False
    ws = safe_path_component(workspace_id)
    dest = Path(constants.STUDY_AUDIO_DIR) / ws / archive_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, dest)
    study_log_store.record_audio({
        "url": norm_url,
        "workspace_id": workspace_id,
        "archived_path": f"{ws}/{archive_rel}",
        "sha256": _sha256(dest),
        "size": dest.stat().st_size,
        "first_event_id": event_id,
        "archived_at": now_ms(),
    })
    with _pause_lock:
        _paused = False
    return True


def archive_urls(urls: Iterable[str], workspace_id: Optional[str], event_id: Optional[str]) -> int:
    """Archive each URL once; return how many files were copied. Never raises."""
    copied = 0
    for url in urls:
        try:
            if isinstance(url, str) and url and _archive_one(url, workspace_id, event_id):
                copied += 1
        except Exception as exc:  # noqa: BLE001 - archiving must never break callers
            logger.warning("Study archive of %s failed: %s", url, exc)
    return copied


def archive_event_refs(pairs: list[tuple[str, str]], workspace_id: Optional[str]) -> None:
    """Background-task entry point: ``pairs`` = ``[(event_id, url), ...]``. Never raises."""
    try:
        for event_id, url in pairs:
            archive_urls([url], workspace_id, event_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Study audio archive task failed: %s", exc)
