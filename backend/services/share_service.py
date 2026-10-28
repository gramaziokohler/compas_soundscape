"""Public read-only share links: build the filtered soundscape a `/share/<id>`
viewer receives, and decide which media files that viewer may fetch.

The designer's selection lives in ``soundscape.json`` → ``share_config``
(``sceneIds`` / ``simulationIds`` / ``listenerIds`` / ``links``), saved by the
normal autosave, so a share is always *live*. Filtering here never mutates the
saved file and has no session side effects (no workspace switch, no temp
restore) — anonymous viewers have no identity at all.

Index-based references (``parent_usage_original_index``,
``sound_config_indices``, ``prompt_index``) are kept valid by *redacting*
non-shared scenes and sound configs into stubs instead of removing them.
"""

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from config.constants import (
    PUBLIC_SHARE_PREFIX,
    SHARE_SCENE_CONFIG_TYPES,
    SOUNDSCAPE_JSON_FILENAME,
    SPECKLE_SHARE_TOKEN,
)
from services.metadata_store import metadata_store
from services.paths import user_audio_dir, user_model_dir
from services.scene_transfer_core import PROMPT_INDEX_BASE

logger = logging.getLogger(__name__)

class ShareNotFound(Exception):
    """Unknown, revoked or never-saved share."""


class ShareTokenMissing(Exception):
    """SPECKLE_SHARE_TOKEN is not configured on the server."""


@dataclass
class PublicShare:
    payload: dict
    audio_files: set[str] = field(default_factory=set)
    ir_files: set[str] = field(default_factory=set)
    workspace_id: str = ""
    model_id: str = ""


def _listener_allowed(receiver_id: str, receiver_ids: set[str], grid_ids: set[str]) -> bool:
    """Receiver keys in IR mappings are single-listener ids or grid point ids
    (``${gridId}-${index}``)."""
    if receiver_id in receiver_ids:
        return True
    return any(receiver_id.startswith(f"{gid}-") for gid in grid_ids)


def _is_scene_config(config: dict) -> bool:
    """Mirrors frontend utils/scene-id.ts isSceneConfig (freeform needs a parent)."""
    if config.get("type") not in SHARE_SCENE_CONFIG_TYPES:
        return False
    return config.get("type") != "freeform" or config.get("parentContextOriginalIndex") is not None


def _stub_analysis_config(config: dict) -> dict:
    """Keep only what keeps indices and card lineage valid; no prompts leak."""
    stub = {
        "type": config.get("type"),
        "share_hidden": True,
    }
    for key in ("scene_id", "parentContextOriginalIndex", "sound_config_indices"):
        if key in config:
            stub[key] = config[key]
    return stub


def _context_config(config: dict) -> dict:
    """Non-scene (context) cards: only their title is useful to a viewer."""
    kept = {
        "type": config.get("type"),
        "display_name": config.get("display_name"),
    }
    for key in ("parentContextOriginalIndex", "sound_config_indices"):
        if key in config:
            kept[key] = config[key]
    title = (config.get("analysisResult") or {}).get("spaceTitle")
    if title:
        kept["analysisResult"] = {"analysisId": "", "architecturalObjects": [], "spaceTitle": title}
    return kept


def _stub_sound_config(config: dict) -> dict:
    return {
        "index": config.get("index"),
        "config_id": config.get("config_id"),
        "type": config.get("type"),
        "duration": config.get("duration", 0),
        "parent_usage_original_index": config.get("parent_usage_original_index"),
    }


def _event_card_index(event: dict) -> Optional[int]:
    idx = event.get("prompt_index")
    if not isinstance(idx, int):
        return None
    return idx // PROMPT_INDEX_BASE if idx >= PROMPT_INDEX_BASE else idx


def filter_soundscape(data: dict) -> tuple[dict, set[str], set[str]]:
    """Return ``(filtered_data, allowed_audio_filenames, allowed_ir_filenames)``."""
    cfg = data.get("share_config") or {}
    scene_ids = set(cfg.get("sceneIds") or [])
    sim_ids = set(cfg.get("simulationIds") or [])
    listener_ids = set(cfg.get("listenerIds") or [])

    out = dict(data)

    # ── Scenes (analysis configs) ────────────────────────────────────────
    analysis = dict(data.get("analysis_state") or {})
    shared_scene_indices: set[int] = set()
    configs: list[dict] = []
    for i, config in enumerate(analysis.get("configs") or []):
        if _is_scene_config(config):
            if config.get("scene_id") in scene_ids:
                shared_scene_indices.add(i)
                configs.append(config)
            else:
                configs.append(_stub_analysis_config(config))
        else:
            configs.append(_context_config(config))
    analysis["configs"] = configs
    out["analysis_state"] = analysis

    # ── Sound configs + events of shared scenes ──────────────────────────
    shared_config_ids: set[str] = set()
    shared_config_indices: set[int] = set()
    sound_configs: list[dict] = []
    for config in data.get("sound_configs") or []:
        # Directivity balloons are served by an authenticated route; share
        # viewers hear sources omnidirectionally.
        config = {k: v for k, v in config.items() if k != "directivity"}
        if config.get("parent_usage_original_index") in shared_scene_indices:
            if config.get("config_id"):
                shared_config_ids.add(config["config_id"])
            if config.get("index") is not None:
                shared_config_indices.add(config["index"])
            sound_configs.append(config)
        else:
            sound_configs.append(_stub_sound_config(config))
    out["sound_configs"] = sound_configs

    audio_files: set[str] = set()
    events: list[dict] = []
    for event in data.get("sound_events") or []:
        cid = event.get("config_id")
        shared = cid in shared_config_ids if cid else _event_card_index(event) in shared_config_indices
        if not shared:
            continue
        events.append({k: v for k, v in event.items() if k != "directivity"})
        for key in ("audio_filename", "fx_audio_filename"):
            if event.get(key):
                audio_files.add(event[key])
    out["sound_events"] = events

    # ── Listeners ────────────────────────────────────────────────────────
    receivers = [r for r in data.get("receivers") or [] if r.get("id") in listener_ids]
    grids = [g for g in data.get("grid_listeners") or [] if g.get("id") in listener_ids]
    receiver_ids = {r["id"] for r in receivers}
    grid_ids = {g["id"] for g in grids}
    out["receivers"] = receivers
    out["grid_listeners"] = grids
    if not _listener_allowed(data.get("selected_receiver_id") or "", receiver_ids, grid_ids):
        out["selected_receiver_id"] = None

    # ── Simulations (IRs pruned to shared listeners) ─────────────────────
    ir_files: set[str] = set()
    simulations: list[dict] = []
    for sim in data.get("simulation_configs") or []:
        if sim.get("id") not in sim_ids:
            continue
        sim = dict(sim)
        mapping = sim.get("source_receiver_ir_mapping") or {}
        pruned: dict = {}
        for pos_key, by_receiver in mapping.items():
            kept = {
                rid: ir for rid, ir in (by_receiver or {}).items()
                if _listener_allowed(rid, receiver_ids, grid_ids)
            }
            if kept:
                pruned[pos_key] = kept
                ir_files.update(ir.get("filename") for ir in kept.values() if ir.get("filename"))
        if mapping:
            sim["source_receiver_ir_mapping"] = pruned
        if sim.get("receiver_positions"):
            sim["receiver_positions"] = {
                rid: p for rid, p in sim["receiver_positions"].items()
                if _listener_allowed(rid, receiver_ids, grid_ids)
            }
        simulations.append(sim)
    out["simulation_configs"] = simulations
    out["active_simulation_index"] = None
    shared_sim_ids = {s["id"] for s in simulations}

    # ── Never leak owner data / tokens ───────────────────────────────────
    out["auth_token"] = SPECKLE_SHARE_TOKEN
    out["custom_materials"] = []
    out["directivities"] = []

    shared_scene_ids = {configs[i].get("scene_id") for i in shared_scene_indices}
    all_listener_ids = receiver_ids | grid_ids
    links = [
        link for link in cfg.get("links") or []
        if (not link.get("sceneId") or link["sceneId"] in shared_scene_ids)
        and (not link.get("simulationId") or link["simulationId"] in shared_sim_ids)
        and (not link.get("listenerId") or link["listenerId"] in all_listener_ids)
    ]
    out["share_config"] = {
        "sceneIds": sorted(shared_scene_ids),
        "simulationIds": sorted(shared_sim_ids),
        "listenerIds": sorted(all_listener_ids),
        "links": links,
    }
    return out, audio_files, ir_files


class ShareService:
    """Resolves share ids to filtered payloads, cached per soundscape.json mtime."""

    def __init__(self) -> None:
        self._cache: dict[str, tuple[int, PublicShare]] = {}

    def _json_path(self, workspace_id: str, model_id: str) -> Path:
        return user_model_dir(workspace_id, model_id) / SOUNDSCAPE_JSON_FILENAME

    def get_public_share(self, share_id: str) -> PublicShare:
        share = metadata_store.resolve_share(share_id)
        if not share:
            raise ShareNotFound(share_id)
        if not SPECKLE_SHARE_TOKEN:
            raise ShareTokenMissing()
        path = self._json_path(share["workspace_id"], share["model_id"])
        if not path.exists():
            raise ShareNotFound(share_id)
        mtime = path.stat().st_mtime_ns
        cached = self._cache.get(share_id)
        if cached and cached[0] == mtime:
            return cached[1]
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        payload, audio_files, ir_files = filter_soundscape(data)
        result = PublicShare(
            payload=payload,
            audio_files=audio_files,
            ir_files=ir_files,
            workspace_id=share["workspace_id"],
            model_id=share["model_id"],
        )
        self._cache[share_id] = (mtime, result)
        return result

    def media_path(self, share_id: str, kind: str, filename: str) -> Optional[Path]:
        """Disk path of a shared media file, or None when it is not part of the
        share (or the name tries to escape the model folder)."""
        if os.path.basename(filename) != filename or filename in ("", ".", ".."):
            return None
        share = self.get_public_share(share_id)
        if kind == "audio":
            if filename not in share.audio_files:
                return None
            path = user_audio_dir(share.workspace_id, share.model_id) / filename
        elif kind == "ir":
            if filename not in share.ir_files:
                return None
            path = user_model_dir(share.workspace_id, share.model_id) / "ir_files" / filename
        else:
            return None
        return path if path.is_file() else None

    @staticmethod
    def media_base_urls(share_id: str) -> tuple[str, str]:
        base = f"{PUBLIC_SHARE_PREFIX}/{share_id}"
        return f"{base}/audio", f"{base}/ir"


share_service = ShareService()
