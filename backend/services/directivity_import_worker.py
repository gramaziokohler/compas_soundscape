"""Directivity import / preset build — CPU-queue subprocess workers.

Same progress_file / result_file contract as the other workers (loop_worker.py):

Progress file: {"value": 0-100, "status": "<human text>"}
Result file:   {"type": "done", "result": {"directivity": DirectivityRecord}}   (import)
               {"type": "done", "result": {"built": [...], "warnings": [...]}}  (preset build)
            or {"type": "error", "message": "<str>"}

Parsing a 64k-line BRAS CSV or a 90 MB SOFA file takes seconds to minutes, so it never
runs on the API thread. The import worker is the only worker that writes SQLite
(``user_directivities``); the store is WAL-mode and ``init_db`` is idempotent.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
import urllib.request
import uuid
from pathlib import Path
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.constants import DIRECTIVITY_FRONT_CHECK_MAX_DEG, DIRECTIVITY_ID_PREFIX  # noqa: E402
from services.directivity_formats import read_balloon, read_sofa_source_balloon  # noqa: E402
from services.directivity_processing import process_balloon, save_npz  # noqa: E402


def _write_progress(progress_file: str, value: int, status: str) -> None:
    tmp = progress_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"value": value, "status": status}, f)
    for attempt in range(10):
        try:
            os.replace(tmp, progress_file)
            break
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.02)


def _write_result(result_file: str, payload: dict) -> None:
    tmp = result_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, result_file)


def run_directivity_import(
    import_id: str,
    progress_file: str,
    result_file: str,
    user_hash: str,
    source_path: str,
    fmt: str,
    name: str,
    sofa_source: Optional[str],
    dest_dir: str,
) -> None:
    try:
        _write_progress(progress_file, 5, "Reading the directivity file...")
        balloon = read_balloon(source_path, fmt, sofa_source)
        _write_progress(progress_file, 45, f"Processing {balloon.directions.shape[0]} directions...")
        processed = process_balloon(balloon)
        _write_progress(progress_file, 85, "Saving to your library...")
        directivity_id = f"{DIRECTIVITY_ID_PREFIX}{uuid.uuid4().hex}"
        save_npz(Path(dest_dir) / f"{directivity_id}.npz", processed)

        from services.directivity_service import to_api
        from services.metadata_store import MetadataStore

        store = MetadataStore()
        store.init_db()
        row = store.create_user_directivity(
            user_hash, directivity_id, name, processed.meta.get("format", fmt), balloon.label or "",
            processed.fs, processed.n_points, processed.taps, json.dumps(processed.fit), json.dumps(processed.preview),
        )
        _write_result(result_file, {"type": "done", "result": {"directivity": to_api(row).model_dump()}})
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[directivity_import] Error: {exc}\n{tb}", file=sys.stderr)
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
    finally:
        try:
            os.unlink(source_path)
        except OSError:
            pass


def _download(url: str, dest: Path, progress_file: str) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(url, timeout=120) as resp, open(tmp, "wb") as out:  # noqa: S310 - fixed CC0 URL
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                _write_progress(progress_file, 5 + int(30 * done / total), f"Downloading the loudspeaker balloons ({done / 1e6:.0f} / {total / 1e6:.0f} MB)...")
    os.replace(tmp, dest)
    return dest


def run_directivity_preset_build(
    build_id: str,
    progress_file: str,
    result_file: str,
    sofa_path: Optional[str],
    download_url: str,
    download_path: str,
    dest_dir: str,
    presets: dict,
) -> None:
    """Process the measured presets (``{preset_id: label}``) from the DIRPAT SOFA file."""
    built, warnings = [], []
    try:
        path = Path(sofa_path) if sofa_path else None
        if path is None or not path.exists():
            _write_progress(progress_file, 5, "Downloading the loudspeaker balloons...")
            path = _download(download_url, Path(download_path), progress_file)
        n = max(len(presets), 1)
        for i, (preset_id, label) in enumerate(presets.items()):
            base = 40 + int(55 * i / n)
            _write_progress(progress_file, base, f"Processing {label}...")
            processed = process_balloon(read_sofa_source_balloon(path, label))
            angle = float(processed.meta.get("front_angle_deg", 0.0))
            if angle > DIRECTIVITY_FRONT_CHECK_MAX_DEG:
                warnings.append(f"{label}: maximum 1-4 kHz energy is {angle:.0f} deg off the +x front axis")
            save_npz(Path(dest_dir) / f"{preset_id}.npz", processed)
            built.append(preset_id)
        for w in warnings:
            print(f"[directivity_preset_build] WARNING {w}", file=sys.stderr)
        _write_result(result_file, {"type": "done", "result": {"built": built, "warnings": warnings}})
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[directivity_preset_build] Error: {exc}\n{tb}", file=sys.stderr)
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
    finally:
        try:
            os.remove(Path(dest_dir) / ".building")
        except OSError:
            pass
