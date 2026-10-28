"""Source directivity registry: presets, per-user library, and request resolution.

Ids:
* analytical presets  — ``omni``, ``cardioid``, ... (``DIRECTIVITY_ANALYTICAL_PRESETS``);
* measured presets    — ``preset_<name>`` built from the bundled DIRPAT SOFA into
  ``DIRECTIVITY_PRESET_DIR`` by a CPU job (``ensure_presets_built``);
* library entries     — ``dir_<hex>``: a ``user_directivities`` row (metadata) plus
  ``DIRECTIVITY_DATA_DIR/<user_hash>/<id>.npz`` (the balloon). On soundscape save the
  balloons in use are copied into ``<model dir>/directivities/`` so collaborators of a
  shared workspace can still simulate (``copy_library_files_to_model``).

``attach_directivity_specs`` turns the ``source_directivity`` of each request pair into
a worker-ready spec: analytical patterns inline; measured ones as the ``.npz`` path
(pyroomacoustics worker) plus the first-order band fit inline (PFFDTD runs in its own
environment and never opens the file).
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import struct
import time
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import HTTPException

from config.constants import (
    DIRECTIVITY_ANALYTICAL_PRESETS,
    DIRECTIVITY_BALLOON_MAGIC,
    DIRECTIVITY_DATA_DIR,
    DIRECTIVITY_ID_PREFIX,
    DIRECTIVITY_MEASURED_PRESETS,
    DIRECTIVITY_OMNI_ID,
    DIRECTIVITY_PRESET_BUILD_MARKER_TTL_S,
    DIRECTIVITY_PRESET_DIR,
    DIRECTIVITY_PRESET_ID_PREFIX,
    DIRECTIVITY_SOFA_DIRPAT_STEM,
    DIRECTIVITY_SOFA_FALLBACK_URL,
    DIRECTIVITY_SOFA_PATH,
    DIRECTIVITY_SOUNDSCAPE_SUBDIR,
    JOB_TYPE_DIRECTIVITY_PRESET_BUILD,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
)
from models.schemas import DirectivityRecord, SourceDirectivityRef, SourceReceiverPair
from services.directivity_processing import analytical_fit, load_npz
from services.metadata_store import metadata_store
from services.paths import user_model_dir

KIND_ANALYTICAL = "analytical"
KIND_MEASURED = "measured"
_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9_-]")
_PRESET_BUILD_MARKER = ".building"


# ── ids and paths ───────────────────────────────────────────────────────────

def is_omni(ref: Optional[SourceDirectivityRef]) -> bool:
    return ref is None or ref.is_omni


def is_analytical_id(directivity_id: str) -> bool:
    return directivity_id in DIRECTIVITY_ANALYTICAL_PRESETS


def is_preset_id(directivity_id: str) -> bool:
    return directivity_id in DIRECTIVITY_MEASURED_PRESETS


def is_library_id(value) -> bool:
    return isinstance(value, str) and value.startswith(DIRECTIVITY_ID_PREFIX)


def _safe(segment: str) -> str:
    return _SAFE_SEGMENT.sub("_", str(segment))


def preset_file(preset_id: str) -> Path:
    return Path(DIRECTIVITY_PRESET_DIR) / f"{_safe(preset_id)}.npz"


def library_dir(user_hash: str) -> Path:
    return Path(DIRECTIVITY_DATA_DIR) / _safe(user_hash)


def library_file(user_hash: str, directivity_id: str) -> Path:
    return library_dir(user_hash) / f"{_safe(directivity_id)}.npz"


def soundscape_file(session_id: str, model_id: str, directivity_id: str) -> Path:
    return user_model_dir(session_id, model_id) / DIRECTIVITY_SOUNDSCAPE_SUBDIR / f"{_safe(directivity_id)}.npz"


def bundled_sofa_path() -> Optional[Path]:
    """The DIRPAT SOFA: ``DIRECTIVITY_SOFA_PATH`` override, else the installed pyroomacoustics data file."""
    if DIRECTIVITY_SOFA_PATH:
        p = Path(DIRECTIVITY_SOFA_PATH)
        return p if p.exists() else None
    spec = importlib.util.find_spec("pyroomacoustics")
    if spec is None or not spec.origin:
        return None
    p = Path(spec.origin).parent / "data" / "sofa" / f"{DIRECTIVITY_SOFA_DIRPAT_STEM}.sofa"
    return p if p.exists() else None


def downloaded_sofa_path() -> Path:
    return Path(DIRECTIVITY_PRESET_DIR) / "src" / f"{DIRECTIVITY_SOFA_DIRPAT_STEM}.sofa"


# ── records ─────────────────────────────────────────────────────────────────

def analytical_records() -> list[DirectivityRecord]:
    return [
        DirectivityRecord(id=pid, name=label, kind=KIND_ANALYTICAL, origin="builtin", p=p)
        for pid, (label, p) in DIRECTIVITY_ANALYTICAL_PRESETS.items()
    ]


def _npz_summary(path: Path) -> dict:
    try:
        data = load_npz(path)
        return {
            "fs": data["fs"], "n_points": int(data["directions"].shape[0]), "taps": int(data["irs"].shape[1]),
            "fit_residual": data["fit"].get("residual"), "source_label": data["meta"].get("label") or None,
            "format": data["meta"].get("format"),
        }
    except Exception:
        return {}


def measured_preset_records() -> list[DirectivityRecord]:
    out = []
    for pid, (label, name) in DIRECTIVITY_MEASURED_PRESETS.items():
        path = preset_file(pid)
        available = path.exists()
        summary = _npz_summary(path) if available else {}
        summary.pop("source_label", None)  # the preset table's label wins
        out.append(DirectivityRecord(
            id=pid, name=name, kind=KIND_MEASURED, origin="builtin", source_label=label, available=available, **summary,
        ))
    return out


def to_api(row: dict, origin: str = "library") -> DirectivityRecord:
    fit = json.loads(row.get("fit_json") or "{}")
    return DirectivityRecord(
        id=row["id"], name=row["name"], kind=KIND_MEASURED, origin=origin,
        format=row.get("format"), source_label=row.get("source_label") or None,
        fs=int(row["fs"]), n_points=int(row["n_points"]), taps=int(row["taps"]),
        fit_residual=fit.get("residual"), created_at=row.get("created_at") or "", updated_at=row.get("updated_at") or "",
    )


def list_for_user(user_hash: Optional[str]) -> list[DirectivityRecord]:
    library = [to_api(r) for r in metadata_store.list_user_directivities(user_hash or "")]
    return analytical_records() + measured_preset_records() + library


# ── resolution for simulation requests ──────────────────────────────────────

def _measured_path(directivity_id: str, user_hash: Optional[str], session_id: Optional[str], model_id: Optional[str]) -> Optional[Path]:
    if is_preset_id(directivity_id):
        p = preset_file(directivity_id)
        return p if p.exists() else None
    if user_hash:
        p = library_file(user_hash, directivity_id)
        if p.exists():
            return p
    if session_id and model_id:
        p = soundscape_file(session_id, model_id, directivity_id)
        if p.exists():
            return p
    return None


def _label_for(directivity_id: str, user_hash: Optional[str]) -> str:
    if is_preset_id(directivity_id):
        return DIRECTIVITY_MEASURED_PRESETS[directivity_id][1]
    row = metadata_store.get_user_directivity(user_hash or "", directivity_id) if user_hash else None
    return row["name"] if row else directivity_id


def resolve(ref: Optional[SourceDirectivityRef], user_hash: Optional[str], session_id: Optional[str],
            model_id: Optional[str]) -> Optional[dict]:
    """Worker-ready spec of one pair's directivity; ``None`` for omnidirectional."""
    if is_omni(ref):
        return None
    assert ref is not None
    angles = {"yaw": float(ref.yaw), "pitch": float(ref.pitch), "roll": float(ref.roll)}
    if is_analytical_id(ref.id):
        label, p = DIRECTIVITY_ANALYTICAL_PRESETS[ref.id]
        return {"kind": KIND_ANALYTICAL, "id": ref.id, "label": label, "p": float(p), "fit": analytical_fit(p), **angles}
    path = _measured_path(ref.id, user_hash, session_id, model_id)
    if path is None:
        if is_preset_id(ref.id):
            raise HTTPException(status_code=400, detail=f"The preset '{DIRECTIVITY_MEASURED_PRESETS[ref.id][1]}' is still being prepared — try again in a minute")
        raise HTTPException(status_code=400, detail=f"Unknown directivity '{ref.id}' — import it to your library")
    data = load_npz(path)
    return {"kind": KIND_MEASURED, "id": ref.id, "label": _label_for(ref.id, user_hash), "path": str(path),
            "fit": data["fit"], **angles}


def attach_directivity_specs(pairs: list[SourceReceiverPair], user_hash: Optional[str], session_id: Optional[str],
                             model_id: Optional[str]) -> list[dict]:
    """Pair dicts for the workers, each with ``source_directivity_spec`` (None = omni)."""
    cache: dict[tuple, Optional[dict]] = {}
    out: list[dict] = []
    for pair in pairs:
        ref = pair.source_directivity
        key = (ref.id, ref.yaw, ref.pitch, ref.roll) if ref else None
        if key not in cache:
            cache[key] = resolve(ref, user_hash, session_id, model_id)
        d = pair.model_dump()
        d["source_directivity_spec"] = cache[key]
        out.append(d)
    return out


def any_directional(pairs_data: list[dict]) -> bool:
    return any(p.get("source_directivity_spec") for p in pairs_data)


def directional_run_count(pairs_data: list[dict], simulation_mode: str) -> int:
    """GPU runs of a reciprocal PFFDTD job: one per listener, four for an FOA listener."""
    n_listeners = len({str(p["receiver_id"]) for p in pairs_data})
    return n_listeners * (4 if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA else 1)


def balloon_bytes(directivity_id: str, user_hash: Optional[str], session_id: Optional[str], model_id: Optional[str]) -> bytes:
    """Compact binary balloon for real-time playback (see DIRECTIVITY_BALLOON_MAGIC)."""
    if is_analytical_id(directivity_id):
        raise HTTPException(status_code=404, detail="Analytical patterns have no balloon")
    path = _measured_path(directivity_id, user_hash, session_id, model_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Directivity not found")
    data = load_npz(path)
    directions = np.ascontiguousarray(data["directions"], dtype="<f4")
    irs = np.ascontiguousarray(data["irs"], dtype="<f4")
    header = struct.pack("<III", directions.shape[0], irs.shape[1], int(data["fs"]))
    return DIRECTIVITY_BALLOON_MAGIC + header + directions.tobytes() + irs.tobytes()


def preview_for(directivity_id: str, user_hash: Optional[str], session_id: Optional[str], model_id: Optional[str]) -> dict:
    if is_analytical_id(directivity_id):
        return {"analytical": True, "p": DIRECTIVITY_ANALYTICAL_PRESETS[directivity_id][1]}
    if is_library_id(directivity_id) and user_hash:
        row = metadata_store.get_user_directivity(user_hash, directivity_id)
        if row:
            return json.loads(row["preview_json"])
    path = _measured_path(directivity_id, user_hash, session_id, model_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Directivity not found")
    return load_npz(path)["preview"]


# ── library maintenance ─────────────────────────────────────────────────────

def delete_library_entry(user_hash: str, directivity_id: str) -> bool:
    row = metadata_store.delete_user_directivity(user_hash, directivity_id)
    if row is None:
        return False
    library_file(user_hash, directivity_id).unlink(missing_ok=True)
    return True


def copy_library_files_to_model(user_hash: Optional[str], session_id: str, model_id: str, ids: list[str]) -> int:
    """Copy the balloons of library ids into the model folder (presets are never copied)."""
    copied = 0
    for directivity_id in ids:
        if not is_library_id(directivity_id):
            continue
        dest = soundscape_file(session_id, model_id, directivity_id)
        src = library_file(user_hash, directivity_id) if user_hash else None
        if src is None or not src.exists():
            continue  # a collaborator saving: the owner's copy is already next to the soundscape
        if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        copied += 1
    return copied


def record_for_snapshot(directivity_id: str, user_hash: Optional[str]) -> Optional[DirectivityRecord]:
    if not is_library_id(directivity_id) or not user_hash:
        return None
    row = metadata_store.get_user_directivity(user_hash, directivity_id)
    return to_api(row, origin="shared") if row else None


# ── measured presets ────────────────────────────────────────────────────────

def presets_missing() -> list[str]:
    return [pid for pid in DIRECTIVITY_MEASURED_PRESETS if not preset_file(pid).exists()]


def _marker_fresh(path: Path) -> bool:
    try:
        return time.time() - path.stat().st_mtime < DIRECTIVITY_PRESET_BUILD_MARKER_TTL_S
    except OSError:
        return False


async def ensure_presets_built() -> Optional[str]:
    """Enqueue the preset build job when a measured preset is missing (API startup).

    Returns the job id, or None when nothing was enqueued (built, or Redis down).
    """
    missing = presets_missing()
    if not missing:
        return None
    preset_dir = Path(DIRECTIVITY_PRESET_DIR)
    preset_dir.mkdir(parents=True, exist_ok=True)
    marker = preset_dir / _PRESET_BUILD_MARKER
    if _marker_fresh(marker):
        return None
    sofa = bundled_sofa_path() or (downloaded_sofa_path() if downloaded_sofa_path().exists() else None)
    payload = {
        "variant": "directivity_preset_build",
        "kwargs": dict(
            build_id="presets",
            sofa_path=str(sofa) if sofa else None,
            download_url=DIRECTIVITY_SOFA_FALLBACK_URL,
            download_path=str(downloaded_sofa_path()),
            dest_dir=str(preset_dir),
            presets={pid: label for pid, (label, _name) in DIRECTIVITY_MEASURED_PRESETS.items() if pid in missing},
        ),
    }
    try:
        from services.job_store import job_store

        job_id = await job_store.enqueue(JOB_TYPE_DIRECTIVITY_PRESET_BUILD, None, payload)
    except Exception as exc:  # Redis down (local dev without workers): presets stay unavailable
        print(f"[directivity] preset build not enqueued: {exc}")
        return None
    marker.write_text(job_id)
    print(f"[directivity] building measured presets {missing} (job {job_id})")
    return job_id


def preset_marker_clear() -> None:
    try:
        os.remove(Path(DIRECTIVITY_PRESET_DIR) / _PRESET_BUILD_MARKER)
    except OSError:
        pass
