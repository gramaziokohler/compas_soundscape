"""Hybrid wave-based + geometric simulation (child process of the PFFDTD worker).

One job, three stages, on one Speckle geometry and one set of source-listener pairs:

1. **Geometric part** — compas_acoustics (services/compas_acoustics_engine.py): image sources,
   ray tracing, optional edge diffraction; mono or first-order ambisonic.
2. **Crossover** — from the room: Schroeder frequency ``2000 sqrt(T60 / V)`` with T60 measured on
   the geometric responses (median over the pairs with a reliable decay; Eyring's prediction
   otherwise) and V the prepared air volume; or a frequency given by the user
   (utils/hybrid_crossover.plan_crossover). The wave solver then only has to reach
   ``HYBRID_WAVE_FMAX_MARGIN`` x the crossover, which keeps the GPU run small.
3. **Wave part** — PFFDTD (services/pffdtd_job._run_from_geometry) up to that frequency, then each
   pair's two responses are joined with a 4th-order Linkwitz-Riley crossover
   (utils/hybrid_crossover.combine) and written over the wave response, with metrics recomputed.

Both engines keep the propagation delay and write at the app's level (free field at 1 m, 1/r),
and both write first-order ambisonics in the same listener frame (the wave solver turns its
world-axis channels into it, pffdtd_backend/listener_frame.py). Results use the PFFDTD file
names and results JSON (served by /api/pffdtd/get-result-file), with a ``hybrid`` header and per-pair ``hybrid`` block.
"""

from __future__ import annotations

import json
import threading
import traceback
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from scipy.io import wavfile

from config.constants import (
    AUDIO_SAMPLE_RATE,
    CA_DIFFRACTION_DEFAULT,
    CA_RAY_ENERGY_THRESHOLD_DB_DEFAULT,
    CA_SEED_DEFAULT,
    HYBRID_CROSSOVER_FACTOR_DEFAULT,
    HYBRID_PARTS_BOTH,
    HYBRID_PARTS_RAYS,
    HYBRID_PARTS_WAVE,
    HYBRID_PROGRESS_WAVE_END,
    HYBRID_WAVE_ADJUSTMENT_KEY,
    HYBRID_WAVE_DURATION_T60_FACTOR,
    PFFDTD_DEFAULT_PPW,
    PFFDTD_DURATION_MAX,
    PFFDTD_DURATION_MIN,
    PFFDTD_FMAX_MAX,
    PYROOMACOUSTICS_MAX_PROCESSES,
    PYROOMACOUSTICS_RECIPROCITY_ENABLED,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
    PYROOMACOUSTICS_SIMULATION_MODE_MONO,
)
from models.schemas import MeshPrepSettings
from services.pffdtd_job import _atomic_write, _run_from_geometry, _write_progress, geometry_dict, pffdtd_available
from services.gpu_arbiter import wave_gpu_budget_bytes
from services.hybrid_single_part import run_rays_only, run_wave_only, wave_only_fmax
from services.pffdtd_scene_export import bounding_box
from services.progress_lanes import HybridProgress
from services.pyroomacoustics_room_builder import room_offset
from services.simulation_geometry_loader import load_speckle_simulation_geometry
from services.simulation_mesh_service import MeshPrepOptions, SimulationMeshService
from utils.acoustic_measurement import try_measure_ir
from utils.audio_processing import trim_ir
from utils.geometry import seeds_from_pairs
from utils.run_timing import solve_started, solve_time_s
from utils.hybrid_crossover import (
    CROSSOVER_MANUAL, CROSSOVER_SCHROEDER, CrossoverPlan, combine, plan_crossover, schroeder_frequency, wave_ppw,
)
from utils.hybrid_wave_fit import fit_wave
from utils.pffdtd_grid import pffdtd_precision

METHOD_NAME = "Hybrid (PFFDTD + compas_acoustics)"


def measured_rt60(responses, fs: int = AUDIO_SAMPLE_RATE) -> Optional[float]:
    """Median reverberation time (ISO T30 of 500 Hz - 1 kHz) over the geometric responses whose
    decay is reliable; None if none is. Uses the metrics the engine already measured."""
    values = []
    for response in responses:
        metrics = getattr(response, "metrics", None) or try_measure_ir(response.rir, fs)
        params = metrics.get("acoustic_parameters") or {}
        t30 = params.get("t30")
        if t30 and np.isfinite(t30) and t30 > 0 and params.get("t30_reliable", False):
            values.append(float(t30))
    return float(np.median(values)) if values else None


def predicted_rt60(geometry) -> Optional[float]:
    """Eyring's reverberation time of the room at 500 Hz - 1 kHz (compas_acoustics), or None."""
    try:
        from compas_acoustics.room.diffuse import predicted_rt
        from compas_acoustics.room.geometry import SYNTHESIS_BANDS

        rt = np.asarray(predicted_rt(geometry, model="eyring", warn=False), dtype=float)
        mid = [i for i, f in enumerate(SYNTHESIS_BANDS) if 400.0 <= f <= 1100.0]
        value = float(np.mean(rt[mid]))
        return value if np.isfinite(value) and value > 0 else None
    except Exception as exc:  # noqa: BLE001
        print(f"[hybrid] Eyring prediction unavailable: {exc}")
        return None


def min_seed_surface_distance(mesh, seed_meta: list, pairs_data: list) -> Optional[float]:
    """Smallest distance (m) from a source or listener to a surface of the prepared mesh, or None."""
    from services.simulation_preflight_service import (
        ENGINE_PYROOMACOUSTICS, PreflightContext, SeedMeta, SimulationPreflightService,
    )

    try:
        analysis = SimulationPreflightService.analyze(mesh, PreflightContext(
            engine=ENGINE_PYROOMACOUSTICS, seeds=[SeedMeta(**s) for s in seed_meta],
            pairs=[(str(p["source_id"]), str(p["receiver_id"])) for p in pairs_data],
        ))
        distances = [d for d in analysis.seed_surface_distance if d is not None and np.isfinite(d) and d > 0]
        return float(min(distances)) if distances else None
    except Exception as exc:  # noqa: BLE001 - only used to refine the grid
        print(f"[hybrid] seed clearance unavailable: {exc}")
        return None


def fit_wave_part(mesh, parts: str, plan: CrossoverPlan, ppw: float, precision: str, duration: float,
                  seed_distance: Optional[float], replan: Callable[[float], CrossoverPlan]):
    """``(adjustment, plan, ppw, precision)`` the wave part runs with: the card's when its grid fits the GPU free
    now and clears the sources / listeners as set (adjustment None), else the recommended fitted option
    (utils/hybrid_wave_fit.py). Raises when no setting can run."""
    bmin, bmax = bounding_box(mesh)
    adjustment = fit_wave(np.asarray(bmax) - np.asarray(bmin), wave_gpu_budget_bytes(), precision, parts,
                          plan.crossover_hz, ppw, duration, seed_distance)
    if adjustment is None:
        return None, plan, ppw, precision
    option = adjustment.option(adjustment.applied)
    if option is None:
        raise RuntimeError(adjustment.message)
    print(f"[hybrid] wave fit ({adjustment.reason}): {adjustment.message} -> {option.key}: {option.label}")
    if abs(option.crossover_hz - plan.crossover_hz) > 1e-6:
        notes = list(plan.notes)
        plan = replan(option.crossover_hz)
        plan.notes = notes + plan.notes
    return adjustment, plan, float(option.ppw), option.precision


def wave_duration(requested: Optional[float], rt60: Optional[float]) -> float:
    """Length of the wave run: the user's, else long enough for the low band to decay (a multiple of T60)."""
    if requested:
        return float(np.clip(requested, PFFDTD_DURATION_MIN, PFFDTD_DURATION_MAX))
    base = HYBRID_WAVE_DURATION_T60_FACTOR * rt60 if rt60 else 1.0
    return float(np.clip(base, 0.3, PFFDTD_DURATION_MAX))


def _mirror_progress(sub_file: str, report, stop: threading.Event) -> None:
    """Forward the wave run's progress file (value 0-100, status, partial) to ``report``."""
    while not stop.wait(0.5):
        try:
            with open(sub_file) as f:
                sub = json.load(f)
            report(float(sub.get("value", 0.0)), str(sub.get("status", "")), sub.get("partial"))
        except (OSError, ValueError):
            continue


def plan_room(room_rt60: Optional[float], room_volume: Optional[float], room, source: Optional[str]) -> tuple:
    """``(rt60, volume, source)`` the crossover and the wave run's length are planned with, before either part runs:
    the card's (its last run's measurement, or its Eyring estimate of the acoustic region), else the Eyring
    prediction of the prepared mesh."""
    volume = float(room.volume) if room.has_volume else None
    if room_rt60 and room_rt60 > 0:
        return float(room_rt60), float(room_volume) if room_volume and room_volume > 0 else volume, source or "the card's estimate"
    return predicted_rt60(room), volume, "Eyring prediction of the simulation mesh"


def join_pairs(
    wave_dir: Path,
    wave_results: dict,
    ga_by_pair: dict,
    plan: CrossoverPlan,
    foa: bool,
    level_match: bool,
) -> list[dict]:
    """Join every pair's wave and geometric responses in place; returns the updated result entries."""
    entries = []
    for entry in wave_results["results"]:
        key = (str(entry["source_id"]), str(entry["receiver_id"]))
        if key not in ga_by_pair:
            raise RuntimeError(f"No geometric response for '{key[0]}' -> '{key[1]}'")
        path = wave_dir / entry["ir_file"]
        fs, wave = wavfile.read(str(path))
        if fs != AUDIO_SAMPLE_RATE:
            raise RuntimeError(f"Wave response at {fs} Hz, expected {AUDIO_SAMPLE_RATE}")
        wave = np.asarray(wave, dtype=np.float64)  # already in the listener frame
        joined, info = combine(wave, ga_by_pair[key], AUDIO_SAMPLE_RATE, plan.crossover_hz, level_match=level_match)
        metrics = try_measure_ir(joined, AUDIO_SAMPLE_RATE, f"{key[0]}->{key[1]}")   # before the trim
        joined = trim_ir(joined, AUDIO_SAMPLE_RATE)
        wavfile.write(str(path), AUDIO_SAMPLE_RATE, np.ascontiguousarray(joined, dtype=np.float32))

        updated = dict(entry)
        updated.update({
            "engine": "hybrid", "band_limited": False,
            "hybrid": {"crossover_hz": plan.crossover_hz, "wave_fmax": plan.wave_fmax, **info},
        })
        if foa:
            updated["encoding_method"] = "hybrid (pressure gradient below, compas_acoustics above the crossover)"
        updated.pop("acoustic_parameters", None)        # the wave part's own, below the crossover only
        updated.pop("acoustic_parameters_bands", None)
        updated.update(metrics)
        entries.append(updated)
    return entries


def run_hybrid_simulation(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    speckle_project_id: str,
    speckle_version_id: str,
    layer_name: str,
    object_ids_filter: Optional[list],
    object_materials_dict: dict,
    pairs_data: list,
    object_scattering_dict: Optional[dict] = None,
    **options,
) -> None:
    """Job entry (PFFDTD queue, variant "hybrid"): Speckle geometry, then ``run_hybrid_from_geometry``."""
    started = solve_started()
    try:
        reason = None if options.get("parts") == HYBRID_PARTS_RAYS else pffdtd_available()
        if reason:
            raise RuntimeError(reason)
        inputs = load_speckle_simulation_geometry(
            speckle_project_id, speckle_version_id, layer_name, object_ids_filter,
            object_materials_dict, object_scattering_dict or {},
            progress=lambda v, s: _write_progress(progress_file, min(v * 0.1, 8.0), s),
        )
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[hybrid_job] Error [{simulation_id}]: {exc}\n{tb}")
        _atomic_write(result_file, {"type": "error", "message": str(exc), "traceback": tb})
        return
    run_hybrid_from_geometry(
        simulation_id, progress_file, result_file,
        {**geometry_dict(inputs), "face_scattering": inputs.face_scattering}, pairs_data,
        header_meta={"speckle_source": {"project_id": speckle_project_id, "version_id": speckle_version_id, "layer_name": layer_name}},
        started=started,
        **options,
    )


def run_hybrid_from_geometry(
    simulation_id: str,
    progress_file: str,
    result_file: str,
    geometry: dict,
    pairs_data: list,
    simulation_mode: str,
    simulation_name: str,
    rir_output_dir: str,
    temp_dir: str,
    mesh_settings: Optional[dict] = None,
    header_meta: Optional[dict] = None,
    # crossover
    crossover_mode: str = CROSSOVER_SCHROEDER,
    crossover_hz: Optional[float] = None,
    crossover_factor: float = HYBRID_CROSSOVER_FACTOR_DEFAULT,
    wave_fmax_cap: float = PFFDTD_FMAX_MAX,
    level_match: bool = False,
    # wave part
    ppw: float = PFFDTD_DEFAULT_PPW,
    duration: Optional[float] = None,
    precision: Optional[str] = None,
    # geometric part
    max_order: int = 3,
    ray_tracing: bool = True,
    n_rays: int = 10000,
    air_absorption: bool = True,
    sound_speed: float = 343.0,
    diffraction: str = CA_DIFFRACTION_DEFAULT,
    tail: str = "auto",
    n_slopes: int = 1,
    ray_energy_threshold_db: float = CA_RAY_ENERGY_THRESHOLD_DB_DEFAULT,
    seed: int = CA_SEED_DEFAULT,
    scattering_split: bool = False,
    air_temperature: Optional[float] = None,
    air_humidity: float = 50.0,
    excluded_edges: Optional[list] = None,
    paths_diffraction: bool = False,
    parallel: bool = True,
    # the room the crossover is planned with (Schroeder mode), from the card; else predicted here
    room_rt60: Optional[float] = None,
    room_volume: Optional[float] = None,
    room_estimate_source: Optional[str] = None,
    started: Optional[float] = None,
    # which parts run: both (joined), the wave solver alone, or the rays alone (services/hybrid_single_part.py)
    parts: str = HYBRID_PARTS_BOTH,
) -> None:
    """The geometric part (compas_acoustics, CPU processes) and the wave part (PFFDTD, GPU) run at once, then join.

    The crossover is planned before either runs, from the card's room (``room_rt60``, ``room_volume``) or a manual
    frequency; the reverberation time measured on the geometric responses is reported for the next run."""
    started = solve_started(started)
    stop = threading.Event()
    try:
        reason = None if parts == HYBRID_PARTS_RAYS else pffdtd_available()
        if reason:
            raise RuntimeError(reason)
        if simulation_mode not in (PYROOMACOUSTICS_SIMULATION_MODE_MONO, PYROOMACOUSTICS_SIMULATION_MODE_FOA):
            raise ValueError("The hybrid simulation outputs mono or first-order ambisonics")
        from services.compas_acoustics_engine import EngineSettings, room_geometry, simulate_pairs

        foa = simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA

        # ── 1. Mesh, crossover and wave plan ─────────────────────────────────
        _write_progress(progress_file, 9.0, "Preparing the simulation mesh...")
        seed_meta = seeds_from_pairs(pairs_data)
        mesh = SimulationMeshService.prepare(
            geometry["vertices"], geometry["faces"], geometry["object_face_ranges"], geometry["face_materials"],
            geometry.get("face_scattering"),
            [s["position"] for s in seed_meta], MeshPrepOptions.from_settings(MeshPrepSettings(**(mesh_settings or {}))),
        )
        offset = room_offset(mesh)
        settings = EngineSettings(
            ambisonic_order=1 if foa else 0, max_order=max_order, ray_tracing=ray_tracing,
            air_absorption=air_absorption, n_rays=n_rays, sound_speed=sound_speed,
            air_temperature=air_temperature, air_humidity=air_humidity,
            diffraction=diffraction or CA_DIFFRACTION_DEFAULT,
            n_jobs=PYROOMACOUSTICS_MAX_PROCESSES if parallel else 1,
            reciprocity=PYROOMACOUSTICS_RECIPROCITY_ENABLED, seed=int(seed), tail=tail or "auto",
            n_slopes=int(n_slopes), ray_energy_threshold_db=float(ray_energy_threshold_db), scattering_split=bool(scattering_split), excluded_edges=list(excluded_edges or []),
            paths_diffraction=bool(paths_diffraction),
        )
        room = room_geometry(mesh, offset)
        rt60, volume, rt60_source = plan_room(room_rt60, room_volume, room, room_estimate_source)
        plan = plan_crossover(crossover_mode, rt60, volume, manual_hz=crossover_hz, factor=crossover_factor,
                              wave_fmax_cap=wave_fmax_cap)
        run_duration = wave_duration(duration, rt60)

        # The wave part as set may not run (GPU memory, a seed near a surface): run a fitted set instead
        # and report both options live (progress partial) and in the results (utils/hybrid_wave_fit.py)
        seed_distance = None
        adjustment = None
        if parts != HYBRID_PARTS_RAYS:
            _write_progress(progress_file, 9.5, "Planning the wave grid...")
            seed_distance = min_seed_surface_distance(mesh, seed_meta, pairs_data)
            precision = precision or pffdtd_precision()
            adjustment, plan, ppw, precision = fit_wave_part(
                mesh, parts, plan, ppw, precision, run_duration, seed_distance,
                lambda hz: plan_crossover(CROSSOVER_MANUAL, rt60, volume, manual_hz=hz, wave_fmax_cap=wave_fmax_cap),
            )
        extra = {HYBRID_WAVE_ADJUSTMENT_KEY: adjustment.as_dict()} if adjustment else {}

        def write(value: float, text: str, partial: Optional[dict] = None) -> None:
            _write_progress(progress_file, value, text, {**(partial or {}), **extra} or None)

        if extra:
            write(9.8, "Planning the wave grid...")
        if parts == HYBRID_PARTS_RAYS:
            run_rays_only(
                simulation_id, progress_file, result_file, mesh, offset, pairs_data, settings,
                simulation_mode, simulation_name, rir_output_dir, temp_dir, header_meta, air_absorption,
                {**plan.as_dict(), "rt60_source": rt60_source}, measured_rt60, schroeder_frequency, volume, started,
            )
            return
        if parts == HYBRID_PARTS_WAVE:
            fmax = wave_only_fmax(plan.crossover_hz)
            run_ppw, ppw_note = wave_ppw(ppw, fmax, seed_distance)
            # the solver writes a sub-progress file; forwarded with the fit so the card keeps showing it
            sub_progress = progress_file + ".wave"
            mirror = threading.Thread(target=_mirror_progress, daemon=True, args=(sub_progress, write, stop))
            mirror.start()
            try:
                run_wave_only(
                    simulation_id, sub_progress, result_file, geometry, pairs_data, simulation_mode, simulation_name,
                    rir_output_dir, temp_dir, mesh_settings, header_meta, fmax, run_ppw, run_duration, air_absorption,
                    precision,
                    {**plan.as_dict(), "notes": plan.notes + ([ppw_note] if ppw_note else []), "rt60_source": rt60_source,
                     "wave_duration_s": round(run_duration, 3), "wave_ppw": round(run_ppw, 1), **extra},
                    started,
                )
            finally:
                stop.set()
                mirror.join(timeout=2.0)
            return
        run_ppw, ppw_note = wave_ppw(ppw, plan.wave_fmax, seed_distance)
        if ppw_note:
            plan.notes.append(ppw_note)
        print(
            f"[hybrid {simulation_id[:8]}] T60 {rt60} s ({rt60_source}), V {volume} m^3 -> Schroeder {plan.schroeder_hz} Hz; "
            f"crossover {plan.crossover_hz} Hz, wave to {plan.wave_fmax} Hz for {run_duration:.2f} s"
        )
        for note in plan.notes:
            print(f"  [note] {note}")

        # ── 2. Wave part (GPU, a thread driving the PFFDTD pipeline) and geometric part (CPU) at once ──
        progress = HybridProgress(write)
        sub_progress = progress_file + ".wave"
        sub_result = result_file + ".wave"
        mirror = threading.Thread(target=_mirror_progress, daemon=True, args=(sub_progress, progress.wave_part, stop))
        wave_failure: list[BaseException] = []

        def wave_part() -> None:
            try:
                _run_from_geometry(
                    simulation_id, sub_progress, sub_result,
                    {k: geometry[k] for k in ("vertices", "faces", "object_face_ranges", "face_materials")},
                    pairs_data, simulation_mode,
                    plan.wave_fmax, run_ppw, run_duration, air_absorption, simulation_name, rir_output_dir, temp_dir,
                    mesh_settings,
                    header_meta=header_meta,
                    precision=precision,
                )
            except BaseException as exc:  # noqa: BLE001 - re-raised on the job's thread
                wave_failure.append(exc)

        # daemon: if the geometric part fails, the job's process ends and the pipeline, watching it, stops
        wave = threading.Thread(target=wave_part, daemon=True, name=f"hybrid-wave-{simulation_id[:8]}")
        mirror.start()
        wave.start()
        try:
            ga = simulate_pairs(mesh, offset, pairs_data, settings, progress.geometric)
            progress.finish("geometric")
            wave.join()
        finally:
            stop.set()
            mirror.join(timeout=2.0)
        if wave_failure:
            raise wave_failure[0]
        progress.finish("wave")
        with open(sub_result) as f:
            wave_result = json.load(f)
        if wave_result.get("type") != "done":
            raise RuntimeError(wave_result.get("message") or "The wave part failed")
        ga_by_pair = {
            (str(pairs_data[r.pair_index]["source_id"]), str(pairs_data[r.pair_index]["receiver_id"])): r.rir
            for r in ga.responses
        }
        # what the geometric responses measure: the card plans the next run's crossover with it
        measured = measured_rt60(ga.responses)
        measured_schroeder = schroeder_frequency(measured or 0.0, volume or 0.0)

        # ── 3. Join ──────────────────────────────────────────────────────────

        write(HYBRID_PROGRESS_WAVE_END, f"Joining at {plan.crossover_hz:.0f} Hz...")
        results_path = Path(temp_dir) / wave_result["result"]["results_file"]
        with open(results_path) as f:
            results_json = json.load(f)
        results_json["results"] = join_pairs(Path(rir_output_dir), results_json, ga_by_pair, plan, foa, level_match)
        mismatches = [e["hybrid"]["overlap_mismatch_db"] for e in results_json["results"] if e["hybrid"]["overlap_mismatch_db"] is not None]
        results_json["method"] = METHOD_NAME
        results_json["engine"] = "hybrid"
        results_json["hybrid"] = {
            **plan.as_dict(),
            "rt60_source": rt60_source,
            "measured_rt60": None if measured is None else round(float(measured), 3),
            "measured_schroeder_hz": None if measured_schroeder is None else round(float(measured_schroeder), 2),
            "wave_duration_s": round(run_duration, 3),
            "wave_ppw": round(run_ppw, 1),
            "level_match": bool(level_match),
            "filter": "Linkwitz-Riley 4th order",
            "median_overlap_mismatch_db": round(float(np.median(mismatches)), 2) if mismatches else None,
            **extra,
        }
        results_json["compas_acoustics"] = {**ga.generation, "notes": ga.notes}
        results_json["paths"] = ga.paths  # sound paths of the IRs (services/acoustic_paths_service.py)
        results_json["solve_time_s"] = solve_time_s(started)  # both parts + the join
        with open(results_path, "w") as f:
            json.dump(results_json, f, indent=2)

        _atomic_write(result_file, {
            "type": "done",
            "result": {
                **wave_result["result"],
                "message": (
                    f"Hybrid simulation completed ({len(results_json['results'])} IR file(s)): wave below "
                    f"{plan.crossover_hz:.0f} Hz, rays above"
                ),
                "method": METHOD_NAME,
                "hybrid": results_json["hybrid"],
            },
        })
    except Exception as exc:
        stop.set()
        tb = traceback.format_exc()
        print(f"[hybrid_job] Error [{simulation_id}]: {exc}\n{tb}")
        _atomic_write(result_file, {"type": "error", "message": str(exc), "traceback": tb})
    finally:
        for leftover in (progress_file + ".wave", result_file + ".wave"):
            for p in (leftover, leftover + ".tmp"):
                Path(p).unlink(missing_ok=True)
