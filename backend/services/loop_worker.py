"""
Loop-analysis subprocess worker.

Runs as a subprocess via multiprocessing.Process. Reports progress via atomic
JSON file writes, mirroring sed_worker.py.

Progress file: {"value": 0-100, "status": "<human text>"}
Result file:   {"type": "done",  "result": {"start": <0-1>, "end": <0-1>, "length_sec": <float>, "match_score": <float>}}
            or {"type": "done",  "result": null}         # no usable loop found
            or {"type": "error", "message": "<str>"}
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.audio_processing import compute_loop_region_from_file


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


def run_loop_analysis(
    task_id: str,
    progress_file: str,
    result_file: str,
    audio_file_path: str,
) -> None:
    try:
        _write_progress(progress_file, 10, "Loading audio file...")

        if not os.path.exists(audio_file_path):
            _write_result(result_file, {
                "type": "error",
                "message": f"Audio file not found: {audio_file_path}",
            })
            return

        _write_progress(progress_file, 40, "Analyzing loop period...")
        result = compute_loop_region_from_file(audio_file_path)

        _write_progress(progress_file, 90, "Preparing result...")

        if result is None:
            _write_result(result_file, {"type": "done", "result": None})
            return

        _write_result(result_file, {"type": "done", "result": result})

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[loop_worker] Error: {exc}\n{tb}", file=sys.stderr)
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
