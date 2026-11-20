"""
Sound Event Detection (SED) subprocess worker.

Runs as a subprocess via multiprocessing.Process. Reports progress via
atomic JSON file writes.

Progress file: {"value": 0-100, "status": "<human text>"}
Result file:   {"type": "done",  "result": {"audio_info": {...}, "detected_sounds": [...], "total_classes_analyzed": int}}
            or {"type": "error", "message": "<str>"}
"""
from __future__ import annotations

import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.sed_service import SEDService
from utils.atomic_json import write_json, write_progress_json


def _write_progress(progress_file: str, value: int, status: str) -> None:
    write_progress_json(progress_file, {"value": value, "status": status})


def _write_result(result_file: str, payload: dict) -> None:
    write_json(result_file, payload)


def run_sed_analysis(
    task_id: str,
    progress_file: str,
    result_file: str,
    audio_file_path: str,
    num_sounds: int,
    top_n_classes: int,
    analyze_amplitudes: bool,
    analyze_durations: bool,
) -> None:
    try:
        _write_progress(progress_file, 5, "Loading YAMNet model...")
        sed_service = SEDService()

        _write_progress(progress_file, 20, "Loading audio file...")
        _write_progress(progress_file, 35, "Running YAMNet inference...")

        analysis_result = sed_service.analyze_audio_file(
            file_path=audio_file_path,
            top_n_classes=top_n_classes,
            analyze_amplitudes=analyze_amplitudes,
            analyze_durations=analyze_durations,
        )

        if not analysis_result["success"]:
            _write_result(result_file, {
                "type": "error",
                "message": analysis_result.get("error", "SED analysis failed"),
            })
            return

        _write_progress(progress_file, 90, "Preparing results...")

        all_results = analysis_result["results"]
        detected_sounds = [
            {
                "name": s["name"],
                "confidence": s["mean_score"],
                "max_amplitude_db": s["max_amplitude_db"],
                "max_amplitude_0_1": s["max_amplitude_0_1"],
                "avg_amplitude_db": s["avg_amplitude_db"],
                "avg_amplitude_0_1": s["avg_amplitude_0_1"],
                "max_detection_duration_sec": s["max_detection_duration_sec"],
                "max_silence_duration_sec": s["max_silence_duration_sec"],
                "detection_segments": s.get("detection_segments", []),
            }
            for s in all_results[:num_sounds]
        ]

        _write_result(result_file, {
            "type": "done",
            "result": {
                "audio_info": {**analysis_result["audio_info"], "channels": "Mono"},
                "detected_sounds": detected_sounds,
                "total_classes_analyzed": len(all_results),
            },
        })

    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[sed_worker] Error: {exc}\n{tb}", file=sys.stderr)
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
    finally:
        try:
            if os.path.exists(audio_file_path):
                os.remove(audio_file_path)
        except Exception:
            pass
