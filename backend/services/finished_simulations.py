"""Durable records of finished acoustics simulation jobs.

A simulation's result lives in its Redis job hash only for ``JOB_RESULT_TTL_S``
(1 h) after it completes, and a client only applies it while it is polling. When
the browser tab dies, a reload filters the job out, or the run outlasts the
client's bookkeeping, the result is otherwise lost although its IR files are on
disk. The worker therefore writes one JSON record per finished simulation job:

    temp/finished_simulations/<workspace>/<job_id>.json
    {"job_id", "job_type", "completed", "model_id", "meta", "result"}

``meta`` is the card mapping the submitting client attached to the job (model id,
card ``configId``, version id). The client lists the records of its model
(``GET /api/finished-simulations``) and applies those its cards have not got yet
(``reconcileFinishedSimulations`` in ``frontend/src/hooks/useJobRecovery.ts``).
The records sit in temp/ and are pruned by the temp janitor together with the
IR files their results point to.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Optional

from config.constants import (
    JOB_TYPE_PFFDTD,
    JOB_TYPE_PYROOMACOUSTICS,
    TEMP_FINISHED_SIMULATIONS_DIR,
)
from utils.atomic_json import write_json

# Job variants whose result is a card's simulation (not a preflight, path view, SED ...).
_SIMULATION_VARIANTS = {
    JOB_TYPE_PYROOMACOUSTICS: {"pyroomacoustics_speckle", "pyroomacoustics_geometry", "hybrid_rays"},
    JOB_TYPE_PFFDTD: {None, "pffdtd", "hybrid"},
}


def is_simulation_job(job_type: str, payload: Optional[dict]) -> bool:
    variants = _SIMULATION_VARIANTS.get(job_type)
    return variants is not None and (payload or {}).get("variant") in variants


def _safe_name(value: str) -> str:
    return "".join(ch for ch in value if ch.isalnum() or ch in "-_")


def _workspace_dir(session_id: str) -> Path:
    return Path(TEMP_FINISHED_SIMULATIONS_DIR) / _safe_name(session_id)


def write_record(
    job_id: str,
    job_type: str,
    session_id: str,
    payload: Optional[dict],
    meta: Optional[dict],
    result: Any,
) -> Optional[Path]:
    """Write the record of a finished simulation job; None when the job is not one."""
    if not session_id or not is_simulation_job(job_type, payload):
        return None
    kwargs = (payload or {}).get("kwargs") or {}
    model_id = (meta or {}).get("modelId") or kwargs.get("model_id") or None
    record = {
        "job_id": job_id,
        "job_type": job_type,
        "completed": time.time(),
        "model_id": model_id,
        "meta": meta or None,
        "result": result,
    }
    path = _workspace_dir(session_id) / f"{_safe_name(job_id)}.json"
    os.makedirs(path.parent, exist_ok=True)
    write_json(str(path), record)
    return path


def list_records(session_id: str, model_id: str) -> list[dict]:
    """Records of one workspace's model, newest first. Unreadable files are skipped."""
    folder = _workspace_dir(session_id)
    if not session_id or not model_id or not folder.is_dir():
        return []
    records = []
    for path in folder.glob("*.json"):
        try:
            with open(path, encoding="utf-8") as f:
                record = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(record, dict) and record.get("model_id") == model_id:
            records.append(record)
    records.sort(key=lambda r: float(r.get("completed") or 0.0), reverse=True)
    return records
