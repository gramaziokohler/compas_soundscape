"""Single-part runs of the hybrid card: the wave solver alone, or the rays alone.

The "Hybrid simulation 2" card can switch either part off (form field ``parts``). The job then runs
one engine, but keeps the hybrid's planning (room, Schroeder frequency) and writes its results like
a hybrid run: PFFDTD file names, results JSON and result payload, with the ``hybrid`` header and its
``parts``. So the card's import, refresh recovery and read-outs stay the same.

- ``wave``: PFFDTD up to the card's crossover, used as the top of the wave band. Nothing above it is
  simulated (no headroom margin: no join to protect).
- ``rays``: compas_acoustics over the full band; its responses are the run's IRs.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from scipy.io import wavfile

from config.constants import (
    AUDIO_SAMPLE_RATE,
    HYBRID_PARTS_RAYS,
    HYBRID_PARTS_WAVE,
    HYBRID_PROGRESS_PARTS_START,
    HYBRID_PROGRESS_WAVE_END,
    PFFDTD_FMAX_MAX,
    PFFDTD_FMAX_MIN,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
)
from services.pffdtd_job import CHANNELS_FOA, _atomic_write, _run_from_geometry, _write_progress
from utils.acoustic_measurement import try_measure_ir
from utils.audio_processing import trim_ir
from utils.run_timing import solve_time_s

METHOD_WAVE_ONLY = "Hybrid card, wave part only (PFFDTD)"
METHOD_RAYS_ONLY = "Hybrid card, geometric part only (compas_acoustics)"
GEOMETRY_KEYS = ("vertices", "faces", "object_face_ranges", "face_materials")


def wave_only_fmax(crossover_hz: float) -> float:
    """Top frequency of a wave-only run: the card's crossover, within the solver's range."""
    return float(np.clip(crossover_hz, PFFDTD_FMAX_MIN, PFFDTD_FMAX_MAX))


def run_wave_only(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    geometry: dict,
    pairs_data: list,
    simulation_mode: str,
    simulation_name: str,
    rir_output_dir: str,
    temp_dir: str,
    mesh_settings: Optional[dict],
    header_meta: Optional[dict],
    fmax: float,
    ppw: float,
    duration: float,
    air_absorption: bool,
    precision: Optional[str],
    hybrid_header: dict,
    started: float,
) -> None:
    """PFFDTD up to ``fmax``, then the hybrid header on its results (raises on failure)."""
    _run_from_geometry(
        simulation_id, progress_file, result_file,
        {k: geometry[k] for k in GEOMETRY_KEYS}, pairs_data, simulation_mode,
        fmax, ppw, duration, air_absorption, simulation_name, rir_output_dir, temp_dir, mesh_settings,
        header_meta=header_meta, precision=precision, started=started,
    )
    with open(result_file) as f:
        done = json.load(f)
    if done.get("type") != "done":
        raise RuntimeError(done.get("message") or "The wave solver failed")
    results_path = Path(temp_dir) / done["result"]["results_file"]
    with open(results_path) as f:
        results_json = json.load(f)
    header = {**hybrid_header, "parts": HYBRID_PARTS_WAVE, "wave_fmax": round(fmax, 2)}
    results_json.update(method=METHOD_WAVE_ONLY, engine="hybrid", hybrid=header)
    with open(results_path, "w") as f:
        json.dump(results_json, f, indent=2)
    done["result"].update(
        method=METHOD_WAVE_ONLY, hybrid=header,
        message=f"Wave-only simulation completed ({len(results_json['results'])} IR file(s), up to {fmax:.0f} Hz)",
    )
    _atomic_write(result_file, done)


def _ga_progress(progress_file: str) -> Callable[[float, str, Optional[dict]], None]:
    """The geometric part's ``(fraction, text, partial)`` reports as the job's progress."""
    span = HYBRID_PROGRESS_WAVE_END - HYBRID_PROGRESS_PARTS_START

    def report(fraction: float, text: str, partial: Optional[dict] = None) -> None:
        _write_progress(progress_file, HYBRID_PROGRESS_PARTS_START + span * min(max(fraction, 0.0), 1.0), text, partial)

    return report


def run_rays_only(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    mesh,
    offset: np.ndarray,
    pairs_data: list,
    settings,
    simulation_mode: str,
    simulation_name: str,
    rir_output_dir: str,
    temp_dir: str,
    header_meta: Optional[dict],
    air_absorption: bool,
    hybrid_header: dict,
    measure_rt60: Callable[[list], Optional[float]],
    schroeder: Callable[[float, float], Optional[float]],
    volume: Optional[float],
    started: float,
) -> None:
    """compas_acoustics over the full band, exported as the run's IRs (PFFDTD names and results JSON)."""
    from services.compas_acoustics_engine import simulate_pairs

    foa = simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA
    ga = simulate_pairs(mesh, offset, pairs_data, settings, _ga_progress(progress_file))
    _write_progress(progress_file, HYBRID_PROGRESS_WAVE_END, "Writing impulse responses...")

    rir_dir = Path(rir_output_dir)
    rir_dir.mkdir(parents=True, exist_ok=True)
    ir_files, results = [], []
    for response in ga.responses:
        p = pairs_data[response.pair_index]
        sid, rid = str(p["source_id"]), str(p["receiver_id"])
        rir = np.asarray(response.rir, dtype=np.float64)
        metrics = response.metrics or try_measure_ir(rir, AUDIO_SAMPLE_RATE, f"{sid}->{rid}") or {}
        filename = f"pffdtd_{simulation_id}_src_{sid}_rcv_{rid}.wav"
        trimmed = trim_ir(rir, AUDIO_SAMPLE_RATE) if np.any(rir) else rir
        wavfile.write(str(rir_dir / filename), AUDIO_SAMPLE_RATE, np.ascontiguousarray(trimmed, dtype=np.float32))
        ir_files.append(filename)
        entry = {
            "source_id": sid, "receiver_id": rid,
            "source_position": p["source_position"], "receiver_position": p["receiver_position"],
            "ir_file": filename, "sample_rate": AUDIO_SAMPLE_RATE, "simulation_mode": simulation_mode,
            "num_channels": 4 if foa else 1, "air_absorption": bool(air_absorption),
            "engine": "compas_acoustics", "band_limited": False,
            "ir_reference": "free field at 1 m (direct path 1/r, as pyroomacoustics)",
        }
        if foa:
            entry.update({"channel_ordering": "ACN", "normalization_convention": "SN3D", "format": "AmbiX",
                          "encoding_method": "compas_acoustics", "channel_names": CHANNELS_FOA})
        if not np.any(rir):
            entry["no_sound_path"] = True
        entry.update(metrics)
        results.append(entry)

    measured = measure_rt60(ga.responses)
    header = {
        **hybrid_header,
        "parts": HYBRID_PARTS_RAYS,
        "measured_rt60": None if measured is None else round(float(measured), 3),
        "measured_schroeder_hz": None if measured is None else _round(schroeder(measured, volume or 0.0)),
    }
    results_filename = f"pffdtd_{simulation_id}_results.json"
    results_json = {
        "simulation_id": simulation_id,
        "simulation_name": simulation_name,
        "method": METHOD_RAYS_ONLY,
        "engine": "hybrid",
        "results": results,
        "hybrid": header,
        "compas_acoustics": {**ga.generation, "notes": ga.notes},
        "paths": ga.paths,  # sound paths of the IRs (services/acoustic_paths_service.py)
        **(header_meta or {}),
        "solve_time_s": solve_time_s(started),
    }
    with open(Path(temp_dir) / results_filename, "w") as f:
        json.dump(results_json, f, indent=2)
    _atomic_write(result_file, {
        "type": "done",
        "result": {
            "simulation_id": simulation_id,
            "message": f"Rays-only simulation completed ({len(ir_files)} IR file(s), full band)",
            "ir_files": ir_files,
            "results_file": results_filename,
            "method": METHOD_RAYS_ONLY,
            "hybrid": header,
        },
    })


def _round(value: Optional[float]) -> Optional[float]:
    return None if value is None else round(float(value), 2)
