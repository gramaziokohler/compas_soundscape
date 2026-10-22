"""Filesystem side of a sound-scene transfer between two saved soundscapes.

The pure merge (re-indexing, fresh ids, entity stripping) lives in
``services/scene_transfer_core.py``; this module plans and copies the media,
writes the merged ``soundscape.json`` and bumps the workspace revision.

Used by the in-app "Send scenes to another model" route
(``POST /api/speckle/soundscape/{model_id}/send-scenes``) and by the admin CLI
``scripts/transfer_scenes.py`` (which shares ``plan_audio`` / ``write_json_atomic``).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from config.constants import (
    SCENE_TRANSFER_LEGACY_AUDIO_DIR,
    SCENE_TRANSFER_RENAME_HEX_LEN,
    SOUNDSCAPE_JSON_FILENAME,
)
from models.schemas import SoundscapeData
from services.metadata_store import metadata_store
from services.paths import find_session_audio, user_audio_dir, user_data_dir, user_model_dir
from services.scene_transfer_core import (
    apply_audio_renames,
    extract_package,
    list_scenes,
    merge_package,
    package_analysis_files,
    package_audio_files,
)

logger = logging.getLogger(__name__)

_HASH_CHUNK_BYTES = 1 << 20


class SceneTransferConflict(Exception):
    """The workspace revision moved on since the client last loaded it."""

    def __init__(self, revision: int):
        super().__init__("This workspace changed since you last loaded it. Reload before sending.")
        self.revision = revision


# ── media / io helpers (shared with scripts/transfer_scenes.py) ─────────────


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(_HASH_CHUNK_BYTES), b""):
            h.update(chunk)
    return h.hexdigest()


def plan_audio(src_ws: str, src_model: str, dst_dir: Path, names: list[str]) -> tuple[dict, dict, set]:
    """``(copies {dest_name: source_path}, renames {old: new}, missing)``.

    A file already in the target with identical content is reused; a different
    file with the same name gets a short random suffix instead of overwriting it.
    """
    copies: dict[str, Path] = {}
    renames: dict[str, str] = {}
    missing: set[str] = set()
    for name in names:
        source = user_audio_dir(src_ws, src_model) / name
        if not source.is_file():
            source = user_data_dir(src_ws) / SCENE_TRANSFER_LEGACY_AUDIO_DIR / name
        if not source.is_file():
            source = find_session_audio(src_ws, name)
        if source is None:
            missing.add(name)
            continue
        dest_name = name
        dest = dst_dir / dest_name
        if dest.is_file() and _sha256(dest) == _sha256(source):
            continue  # identical file already there — reuse it
        stem, ext = os.path.splitext(name)
        while (dst_dir / dest_name).exists() or dest_name in copies:
            dest_name = f"{stem}_{uuid.uuid4().hex[:SCENE_TRANSFER_RENAME_HEX_LEN]}{ext}"
        copies[dest_name] = source
        if dest_name != name:
            renames[name] = dest_name
    return copies, renames, missing


def write_json_atomic(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def _read_soundscape(path: Path) -> Optional[dict]:
    if not path.is_file():
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return SoundscapeData(**json.load(fh)).model_dump()


# ── service ──────────────────────────────────────────────────────────────────


class SceneTransferService:
    """Copies sound scenes between two models of the same workspace."""

    def __init__(self) -> None:
        # One send at a time: the revision check + write must not interleave.
        self._lock = threading.Lock()

    def send_scenes(
        self,
        workspace_id: str,
        source_model_id: str,
        target_model_id: str,
        usage_indices: list[int],
        keep_positions: bool = False,
        target_meta: Optional[dict] = None,
        base_revision: Optional[int] = None,
    ) -> dict:
        """Append copies of the source's scenes to the target's soundscape.

        ``usage_indices`` are ``analysis_state.configs`` indices (the frontend's
        scene ``usageIndex``). Object links are always dropped (the target has
        other geometry); positions are reset unless ``keep_positions``.

        Raises ``FileNotFoundError`` (no saved source), ``ValueError`` (bad
        selection) or ``SceneTransferConflict`` (stale ``base_revision``).
        """
        if source_model_id == target_model_id:
            raise ValueError("Source and target are the same model.")
        if not usage_indices:
            raise ValueError("Pick at least one scene to send.")

        with self._lock:
            workspace = metadata_store.get_workspace(workspace_id)
            current_revision = int(workspace["revision"]) if workspace else 0
            if base_revision is not None and base_revision != current_revision:
                raise SceneTransferConflict(current_revision)

            source = _read_soundscape(user_model_dir(workspace_id, source_model_id) / SOUNDSCAPE_JSON_FILENAME)
            if source is None:
                raise FileNotFoundError(f"No saved soundscape for model {source_model_id}")

            number_by_usage = {s["usage_index"]: s["number"] for s in list_scenes(source)}
            unknown = [u for u in usage_indices if u not in number_by_usage]
            if unknown:
                raise ValueError(f"Card(s) {unknown} are not sound scenes in the saved model.")
            scene_numbers = sorted({number_by_usage[u] for u in usage_indices})

            target_dir = user_model_dir(workspace_id, target_model_id)
            target_json = target_dir / SOUNDSCAPE_JSON_FILENAME
            target = _read_soundscape(target_json)
            if target is None:
                meta = target_meta or {}
                target = SoundscapeData(
                    model_id=target_model_id,
                    model_name=meta.get("model_name") or target_model_id,
                    project_id=meta.get("project_id") or "",
                    version_id=meta.get("version_id") or "",
                    created_at=datetime.now(timezone.utc).isoformat(),
                ).model_dump()

            package = extract_package(
                source, scene_numbers, strip_entities=True, reset_positions=not keep_positions
            )
            dst_audio_dir = user_audio_dir(workspace_id, target_model_id)
            copies, renames, missing = plan_audio(
                workspace_id, source_model_id, dst_audio_dir, package_audio_files(package)
            )
            apply_audio_renames(package, renames, missing)
            merged = SoundscapeData(**merge_package(target, package)).model_dump()
            merged["auth_token"] = target.get("auth_token", "")  # never the source's token

            src_analysis = user_model_dir(workspace_id, source_model_id) / "analysis"
            dst_analysis = target_dir / "analysis"
            analysis_copies = [n for n in package_analysis_files(package) if (src_analysis / n).is_file()]

            dst_audio_dir.mkdir(parents=True, exist_ok=True)
            for dest_name, source_path in copies.items():
                shutil.copy2(source_path, dst_audio_dir / dest_name)
            if analysis_copies:
                dst_analysis.mkdir(parents=True, exist_ok=True)
                for name in analysis_copies:
                    if not (dst_analysis / name).exists():
                        shutil.copy2(src_analysis / name, dst_analysis / name)
            write_json_atomic(target_json, merged)

            metadata_store.link_model(target_model_id, workspace_id)
            revision = metadata_store.bump_revision(workspace_id)

        logger.info(
            "Sent %d scene(s) %s -> %s (ws %s): %d sounds, %d events, %d audio copied, %d missing",
            len(scene_numbers), source_model_id, target_model_id, workspace_id,
            len(package["sound_configs"]), len(package["events"]), len(copies), len(missing),
        )
        return {
            "target_model_id": target_model_id,
            "scenes_sent": len(scene_numbers),
            "sounds_sent": len(package["sound_configs"]),
            "events_sent": len(package["events"]),
            "audio_files_copied": len(copies),
            "missing_audio_filenames": sorted(missing),
            "revision": revision,
        }


scene_transfer_service = SceneTransferService()
