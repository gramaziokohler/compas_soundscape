"""One benchmark = one scene (scenes.py) x one fmax stage -> report.md, plots, animation MP4.

CLI (from backend/, with backend/ and backend/tests on PYTHONPATH):

    python -m benchmarks.bras.bras_benchmark --list
    python -m benchmarks.bras.bras_benchmark --scene RS2_1m_rigid --fmax 500 --pairs all
    python -m benchmarks.bras.bras_benchmark --scene RS2_1m_rigid --all-stages --pairs all

Every reference scene in one go: ``run_all.py``.
Outputs: <BRAS_OUTPUT_ROOT>/<scene>/f<fmax>/ (report.md, results.json, plots/, animation/).
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Optional

import numpy as np

from benchmarks.bras import bras_constants as K
from benchmarks.bras.bras_analysis import analyze_broadband_run, analyze_run, average_response, metric_band
from benchmarks.bras.bras_animation import animation_source, export_animation, load_bundle
from benchmarks.bras.bras_directivity import balloon_cache_path, load_or_build_balloon, measured_spec
from benchmarks.bras.bras_domain import DomainPlan, domain_plan, edge_padding_m
from benchmarks.bras.bras_geometry import (
    SceneMesh,
    control_scene_geometry,
    enclosed_geometry,
    load_scene_mesh,
    material_table,
    scene_geometry,
)
from benchmarks.bras.bras_pra import ENGINE_LABEL, PraConfig, simulate_pra
from benchmarks.bras.bras_plots import plot_animation_preview, plot_average, plot_overview, plot_pair
from benchmarks.bras.bras_report import write_report, write_results
from benchmarks.bras.bras_setup_plots import plot_setup
from benchmarks.bras.bras_runner import RunConfig, simulate
from benchmarks.bras.bras_scene import (
    MeasuredPair,
    apply_label_positions,
    build_pairs_data,
    check_orientations,
    load_sofa_pairs,
    pair_geometry,
    select_pairs,
    source_forward,
    speed_of_sound,
    unique_sources,
)
from benchmarks.bras.bras_source_phase import SourcePhase
from benchmarks.bras.bras_source_phase import load_or_build as load_source_phase
from benchmarks.bras.scenes import SCENES, Scene, SourceInput, get_scene, missing_inputs
from config.constants import (
    PFFDTD_HIGH_ORDER_DIRECTIVITY_ENV,
    PFFDTD_HO_BALLOON_ORDER,
    PFFDTD_HO_BESSEL_FLOOR,
    PFFDTD_HO_MAX_ORDER,
    PFFDTD_HO_PROBE_RADIUS_CELLS,
    PFFDTD_SEED_CLEARANCE_CELLS,
)
from services.directivity_formats import FORMAT_BRAS_CSV


@dataclass
class SceneData:
    scene: Scene
    mesh: SceneMesh
    measured: list[MeasuredPair]
    balloon: Optional[dict]
    phase: Optional[SourcePhase]
    source: SourceInput = None            # the scene's source with the orientations of the model's labels
    position_notes: list = field(default_factory=list)   # label vs SOFA positions that differ
    positions_from: str = "sofa"


GAIN_ON_AXIS = "on_axis"
GAIN_SCENE = "scene"


@dataclass
class RunOptions:
    fmax: float
    ppw: float
    pair_keys: list
    directional: bool = True
    material_mode: str = "csv"
    animation: bool = True
    force: bool = False
    pra: bool = True                      # also run pyroomacoustics (when the scene enables it)
    high_order: bool = True               # PFFDTD: the whole measured balloon, not the first-order fit
    ho_params: dict = field(default_factory=dict)   # directional_ho overrides (radius_cells, max_order, ...)
    gain_pair: str = GAIN_ON_AXIS         # on_axis | scene | a pair key


@dataclass
class RunPlan:
    """Everything a run needs, decided without the GPU (also what ``run_all --dry-run`` prints)."""
    pairs: list
    geoms: dict
    domain: DomainPlan
    padding: dict                         # free air per face, required vs used (bras_benchmark._plan_domain)
    coeffs: dict
    scene_geo: dict
    ctl_geo: dict
    fit: Optional[dict]
    source_label: str
    pairs_data: list
    moved: list                           # seeds raised to the solver's clearance above the floor
    cfg: RunConfig
    engine_runs: int                      # GPU runs of the IRs (scene + control)
    est_s: float                          # rough GPU time, IR runs + animation
    sim_pairs: list = field(default_factory=list)   # the pairs at their simulated positions (see ``moved``)
    gain_pair: str = ""                   # the pair whose direct sound sets the global gain

    @property
    def bounds(self) -> tuple:
        return self.domain.bmin, self.domain.bmax


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def load_scene(scene: Scene) -> SceneData:
    missing = missing_inputs(scene)
    if missing:
        raise FileNotFoundError(f"{scene.name}: missing inputs {[str(p) for p in missing]} (paths in scenes.py)")
    mesh = load_scene_mesh(scene.geometry, scene.materials)
    measured = load_sofa_pairs(scene.measurements)
    labels = mesh.skp.labels if mesh.skp is not None else {}
    src, notes, positions_from = scene.source, [], "sofa"
    if scene.positions == "labels" or (scene.positions == "auto" and labels):
        measured, notes = apply_label_positions(measured, labels)
        positions_from = "labels"
    if not src.orientations and labels:
        src = replace(src, orientations={k: v.orientation for k, v in labels.items() if v.orientation is not None})
    check_orientations(unique_sources(measured), src)
    balloon = load_or_build_balloon(src.directivity, src.directivity_format) if src.directivity else None
    phase = None
    phase_on = os.environ.get(K.ENV_SOURCE_PHASE, "on").strip().lower() not in ("off", "0", "no", "false")
    if src.directivity and src.phase and phase_on and src.directivity_format == FORMAT_BRAS_CSV:
        phase = load_source_phase(src.directivity)
    return SceneData(scene, mesh, measured, balloon, phase, src, notes, positions_from)


def options_from_env(data: SceneData) -> RunOptions:
    bt = data.scene.band_test
    stages = list(bt.stages)
    fmax = float(os.environ.get(K.ENV_FMAX, stages[0]))
    ppw = float(os.environ.get(K.ENV_PPW, bt.stages.get(fmax, bt.stages[stages[0]])))
    raw = os.environ.get(K.ENV_PAIRS, "").strip()
    if _env_flag(K.ENV_FULL):
        pairs = [p.key for p in data.measured]
    else:
        pairs = [p.strip() for p in raw.split(",") if p.strip()] if raw else list(data.scene.smoke_pairs)
    return RunOptions(fmax=fmax, ppw=ppw, pair_keys=pairs, directional=not _env_flag(K.ENV_OMNI),
                      material_mode=os.environ.get(K.ENV_MATERIAL, "csv"), force=_env_flag(K.ENV_FORCE),
                      pra=os.environ.get(K.ENV_PRA, "on").strip().lower() not in ("off", "0", "no", "false"),
                      high_order=os.environ.get(K.ENV_HIGH_ORDER, "on").strip().lower() not in ("off", "0", "no", "false"),
                      gain_pair=os.environ.get(K.ENV_GAIN_PAIR, GAIN_ON_AXIS).strip() or GAIN_ON_AXIS)


def _ho_params(opts: RunOptions) -> dict:
    """The high-order parameters in full (constants + overrides): they are in the spec, hence in the run cache key."""
    return {"radius_cells": PFFDTD_HO_PROBE_RADIUS_CELLS, "max_order": PFFDTD_HO_MAX_ORDER,
            "bessel_floor": PFFDTD_HO_BESSEL_FLOOR, "balloon_order": PFFDTD_HO_BALLOON_ORDER, **opts.ho_params}


def choose_gain_pair(pairs: list, geoms: dict, mode: str, scene_pair: str) -> str:
    """The calibration pair: ``on_axis`` = the line-of-sight pair closest to its loudspeaker's axis
    (then the shortest), ``scene`` = the scene's ``gain_pair``, else that pair key."""
    keys = [p.key for p in pairs]
    if mode == GAIN_SCENE:
        return scene_pair
    if mode != GAIN_ON_AXIS:
        if mode not in keys:
            raise ValueError(f"gain pair {mode} is not among the simulated pairs {keys}")
        return mode
    los = [k for k in keys if geoms[k].line_of_sight] or keys
    return min(los, key=lambda k: (round(geoms[k].offaxis_direct_deg if geoms[k].offaxis_direct_deg is not None else 180.0, 1),
                                   geoms[k].d_direct))


def output_dir(scene: Scene, fmax: float) -> Path:
    return K.OUTPUT_ROOT / scene.name / f"f{fmax:g}"


def _material_rows(data: SceneData, coeffs: dict, ground_faces: int) -> list[dict]:
    rows = []
    for key, mi in data.scene.materials.items():
        faces = sum(1 for m in data.mesh.materials if m == key)
        labels = sorted({lab for lab, m in zip(data.mesh.labels, data.mesh.materials) if m == key and lab})
        if data.scene.ground is not None and data.scene.ground.material == key:
            faces += ground_faces
            labels.append("(floor)")
        src = Path(mi.csv).name if mi.csv is not None else f"constant alpha {mi.alpha:g}"
        rows.append({"key": key, "faces": faces, "labels": labels, "file": src, "coeffs": coeffs[key]})
    return rows


def _plan_domain(data: SceneData, opts: RunOptions, pairs: list, ground_z) -> tuple[DomainPlan, dict]:
    """Free air per face from geometry and arrival times (bras_domain.edge_padding_m). If that grid
    does not fit the GPU: a coarser grid, down to K.PPW_MIN; only then less padding (``clean`` False:
    an edge wave that meets an object may reach the window, the report says so)."""
    scene, mesh, bt = data.scene, data.mesh, data.scene.band_test
    window_s = bt.gate_ms * 1e-3 + K.FADE_OUT_S + K.EDGE_RINGING_S
    need_lo, need_hi = edge_padding_m([(p.source_position, p.receiver_position) for p in pairs], window_s,
                                      None if mesh.empty else (mesh.vertices, mesh.faces), ground_z,
                                      keep_s=2.0 * K.EDGE_SUBTRACT_KEEP_S)
    need_lo = np.maximum(need_lo + K.PADDING_MARGIN_M, K.PADDING_MIN_M)
    need_hi = np.maximum(need_hi + K.PADDING_MARGIN_M, K.PADDING_MIN_M)
    points = np.vstack([np.vstack([p.source_position, p.receiver_position]) for p in pairs])

    def plan_at(ppw: float, scale: float) -> DomainPlan:
        pad = (np.maximum(need_lo * scale, K.PADDING_MIN_M), np.maximum(need_hi * scale, K.PADDING_MIN_M))
        return domain_plan(mesh.bmin, mesh.bmax, points, opts.fmax, ppw, bt.duration_s, pad, ground_z)

    ppw, scale = float(opts.ppw), 1.0
    plan = plan_at(ppw, scale)
    ppw_effective_requested = plan.ppw_effective
    for _ in range(20):  # coarser grid: the node count goes with ppw^3
        if plan.fits_gpu or ppw <= K.PPW_MIN:
            break
        ppw = max(K.PPW_MIN, round(ppw * min(0.97, 0.99 * (plan.gpu_budget_gb / plan.gpu_gb) ** (1.0 / 3.0)), 2))
        plan = plan_at(ppw, scale)
    while not plan.fits_gpu and scale > 0.05:  # last resort: less free air than the window needs
        scale -= 0.05
        plan = plan_at(ppw, scale)
    if not plan.fits_gpu:
        raise RuntimeError(f"{scene.name}: domain needs {plan.gpu_gb:.1f} GB > budget {plan.gpu_budget_gb:.1f} GB even "
                           f"at {ppw:.1f} points per wavelength and {K.PADDING_MIN_M:g} m of padding (lower fmax)")
    pts_lo = np.minimum(points.min(axis=0), mesh.bmin) if not mesh.empty else points.min(axis=0)
    pts_hi = np.maximum(points.max(axis=0), mesh.bmax) if not mesh.empty else points.max(axis=0)
    padding = {
        "required_lo": need_lo.round(3).tolist(), "required_hi": need_hi.round(3).tolist(),
        "lo": (pts_lo - np.asarray(plan.bmin)).round(3).tolist(), "hi": (np.asarray(plan.bmax) - pts_hi).round(3).tolist(),
        "clean": scale >= 1.0, "ppw": ppw, "ppw_requested": float(opts.ppw), "window_ms": window_s * 1e3,
        "ppw_effective": plan.ppw_effective, "ppw_effective_requested": ppw_effective_requested,
    }
    if ground_z is not None:
        padding["lo"][2] = padding["required_lo"][2] = 0.0   # the floor: the domain stops just under it
    return plan, padding


def _raise_to_clearance(pairs: list[MeasuredPair], ground_z, h: float) -> tuple[list[MeasuredPair], list]:
    """Simulated positions: a seed closer to the floor than the solver's clearance is raised to it
    (the BRAS floor microphones sit 6 mm above the tiles; the measured positions stay as they are)."""
    if ground_z is None:
        return pairs, []
    z_min = ground_z + (PFFDTD_SEED_CLEARANCE_CELLS + K.CLEARANCE_MARGIN_CELLS) * h
    moved, out = {}, []
    for p in pairs:
        pos = []
        for dev_id, x in ((p.source_id, p.source_position), (p.receiver_id, p.receiver_position)):
            x = np.asarray(x, np.float64)
            if x[2] < z_min:
                moved[dev_id] = (round(float(x[2]), 4), round(float(z_min), 4))
                x = np.array([x[0], x[1], z_min])
            pos.append(x)
        out.append(MeasuredPair(p.source_id, p.receiver_id, pos[0], pos[1], p.ir, p.fs))
    return out, [{"id": k, "z_m": a, "simulated_z_m": b} for k, (a, b) in sorted(moved.items())]


def plan_run(data: SceneData, opts: RunOptions) -> RunPlan:
    scene, mesh, bt = data.scene, data.mesh, data.scene.band_test
    pairs = select_pairs(data.measured, opts.pair_keys)
    ground_z = scene.ground.z if scene.ground is not None else None
    c_meas = speed_of_sound(scene.temperature_c)
    geoms = {p.key: pair_geometry(p, mesh.vertices, mesh.faces, data.source, c_meas) for p in pairs}
    plan, padding = _plan_domain(data, opts, pairs, ground_z)
    bounds = (plan.bmin, plan.bmax)
    coeffs = material_table(scene, opts.material_mode)
    scene_geo = scene_geometry(mesh, coeffs, scene.ground, bounds, plan.h)
    ctl_geo = control_scene_geometry(mesh, coeffs, scene.ground, bounds, plan.h)
    fit = data.balloon["fit"] if (opts.directional and data.balloon is not None) else None
    label = Path(data.source.directivity).stem if data.source.directivity else "omni"
    sim_pairs, moved = _raise_to_clearance(pairs, ground_z, plan.h)
    balloon_file = balloon_cache_path(data.source.directivity) if fit else None
    high_order = bool(opts.high_order and fit is not None)
    # benchmark-only switch of the app's PFFDTD job (services/pffdtd_directivity.py); this process only
    if high_order:
        os.environ[PFFDTD_HIGH_ORDER_DIRECTIVITY_ENV] = "1"
    else:
        os.environ.pop(PFFDTD_HIGH_ORDER_DIRECTIVITY_ENV, None)
    specs = {sid: measured_spec(fit, source_forward(sid, pos, data.source), label, balloon_file,
                                _ho_params(opts) if high_order else None)
             for sid, pos in unique_sources(sim_pairs).items()} if fit else {}
    cfg = RunConfig(scene=scene.name, fmax=opts.fmax, ppw=padding["ppw"], grid_spacing=plan.h, duration=bt.duration_s,
                    pair_keys=[p.key for p in pairs], directional=fit is not None, material_mode=opts.material_mode,
                    padding_m=float(max(padding["lo"] + padding["hi"])), high_order=high_order)
    # a directional job runs once per microphone (reciprocity), an omni one once per loudspeaker
    per_geometry = len({p.receiver_id for p in pairs}) if fit else len({p.source_id for p in pairs})
    engine_runs = per_geometry * (1 if mesh.empty else 2)
    est = engine_runs * plan.est_runtime_s
    if opts.animation and animation_source(pairs, scene.animation) is not None:
        est += 2 * plan.est_runtime_s * (1.0 + scene.animation.duration_ms * 1e-3 / bt.duration_s)
    return RunPlan(pairs, geoms, plan, padding, coeffs, scene_geo, ctl_geo, fit, label,
                   build_pairs_data(sim_pairs, specs), moved, cfg, engine_runs, est, sim_pairs,
                   choose_gain_pair(pairs, geoms, opts.gain_pair, scene.gain_pair))


def _notes(data: SceneData, rp: RunPlan) -> list[str]:
    notes = [f"Positions from the {'model labels' if data.positions_from == 'labels' else 'SOFA file'}."]
    for n in data.position_notes:
        notes.append(f"{n['id']}: label {n['label']} m, SOFA file {n['sofa']} m ({n['deviation_m'] * 100:.1f} cm apart).")
    for m in rp.moved:
        notes.append(f"{m['id']} is {m['z_m'] * 1e3:.0f} mm above the floor; simulated at {m['simulated_z_m'] * 1e3:.0f} mm "
                     "(the solver needs 3 cells of clearance).")
    if data.mesh.dropped:
        left = ", ".join(f"{k} ({v['tris']} triangles)" for k, v in sorted(data.mesh.dropped.items(),
                                                                         key=lambda kv: -kv[1]["area_m2"])[:6])
        notes.append(f"Left out of the model (no material mapped): {left}.")
    if data.mesh.empty:
        notes.append("No object in this scene: the simulation is the floor alone.")
    return notes


def run_benchmark(data: SceneData, opts: RunOptions) -> dict:
    scene, mesh, bt = data.scene, data.mesh, data.scene.band_test
    rp = plan_run(data, opts)
    plan, bounds, pairs, fit = rp.domain, rp.bounds, rp.pairs, rp.fit
    ground_z = scene.ground.z if scene.ground is not None else None
    out = output_dir(scene, opts.fmax)
    print(f"[bras] {scene.name} f{opts.fmax:g}: h = {plan.h * 1e3:.2f} mm, grid {plan.shape} "
          f"({plan.nodes / 1e6:.0f} M nodes, {plan.gpu_gb:.1f} GB), ~{plan.est_runtime_s:.0f} s per engine run", flush=True)

    runs = out / "runs"
    # the geometric-acoustics engine (compas_acoustics / pyroomacoustics) on the CPU, in a thread, while the GPU runs PFFDTD
    pool = ThreadPoolExecutor(max_workers=1)
    pra_future = None
    if opts.pra and scene.pra.enabled:
        pra_cfg = PraConfig(scene.name, scene.pra.max_order, scene.pra.ray_tracing, [p.key for p in pairs],
                            fit is not None, opts.material_mode, temperature_c=scene.temperature_c, humidity=scene.humidity)
        pra_geo = enclosed_geometry(rp.scene_geo, bounds) if K.PRA_CLOSED_ROOM else rp.scene_geo
        pra_future = pool.submit(simulate_pra, pra_cfg, pra_geo, rp.pairs_data, runs, opts.force)
    plate = simulate(rp.cfg, rp.scene_geo, rp.pairs_data, bounds, opts.force, out_root=runs)
    # without objects the scene run already is the empty-domain run
    control = plate if mesh.empty else simulate(replace(rp.cfg, control=True), rp.ctl_geo, rp.pairs_data, bounds,
                                                opts.force, out_root=runs)
    phase = data.phase if fit is not None else None
    gain_db, results = analyze_run(pairs, plate.irs, control.irs, rp.geoms, bt, opts.fmax, bounds, rp.gain_pair,
                                   phase, ground_z)
    avg = average_response(results, bt, opts.fmax)
    second = _second_engine(pra_future, pairs, rp, bt, opts.fmax, scene) if pra_future is not None else None
    pool.shutdown()
    pra_by_key = {r.key: r for r in second["results"]} if second and second["results"] else {}
    pra_avg = second["average"] if pra_by_key else None

    plots = out / "plots"
    shutil.rmtree(plots, ignore_errors=True)
    plots.mkdir(parents=True)
    band = metric_band(bt, opts.fmax)
    files = []
    setup_png = None
    try:  # right after the PFFDTD runs: their voxels are still in the solver's cache
        setup_png = plot_setup(data, rp, plots, band)
        files.append(setup_png)
    except Exception:  # a figure never fails a benchmark
        traceback.print_exc()
    for r in results:
        files.append(plot_pair(r, band, opts.fmax, bt.smoothing_fraction, plots / f"pair_{r.key}.png", scene.label,
                               pra_by_key.get(r.key)))
    files.append(plot_average(avg, band, opts.fmax, bt.smoothing_fraction, len(results), plots / "average.png",
                              scene.label, pra_avg))
    files.append(plot_overview(results, plots / "overview.png", scene.label))
    anim_files = write_animation(rp, data, results, ground_z, out, opts, phase)

    c_meas = speed_of_sound(scene.temperature_c)
    info = {
        "scene": scene.name, "scene_label": scene.label, "fmax_hz": opts.fmax,
        "inputs": {"Geometry": scene.geometry.path, "Measurements (SOFA)": scene.measurements,
                   "Loudspeaker directivity": data.source.directivity or "omni"},
        "materials": _material_rows(data, rp.coeffs, 2 if scene.ground is not None else 0),
        "chamber": scene.chamber or ("hemi-anechoic" if scene.ground is not None else "anechoic"),
        "temperature_c": scene.temperature_c, "humidity": scene.humidity, "c_measured": c_meas,
        "ground": (f"reflective floor at z = {scene.ground.z:g} m ({scene.ground.material})" if scene.ground is not None
                   else "no floor"),
        "n_faces": int(len(mesh.faces)), "bbox": f"{np.round(mesh.bmin, 3).tolist()} to {np.round(mesh.bmax, 3).tolist()} m",
        "source_model": (f"{rp.source_label}, imported as the app does (first-order pattern per octave band), "
                         + ("loudspeaker phase applied" if phase is not None else "zero phase")) if fit else "omnidirectional",
        "grid": plan.as_dict(), "padding": rp.padding, "duration_s": bt.duration_s,
        "wall_s": plate.wall_s + (0.0 if mesh.empty else control.wall_s),
        "window": f"{bt.pre_ms:g} ms before to {bt.gate_ms:g} ms after the direct sound (half-Hann fades)",
        "band": band, "bands_per_octave": bt.bands_per_octave, "smoothing": bt.smoothing_fraction,
        "gain_db": gain_db, "gain_pair": rp.gain_pair, "notes": _notes(data, rp),
        "setup_plot": Path(setup_png).relative_to(out).as_posix() if setup_png else None,
        "files": [Path(f).relative_to(out).as_posix() for f in files + anim_files] + ["results.json"],
    }
    strip = ("f", "meas_db", "sim_db")
    payload = {"info": info, "average": {k: v for k, v in avg.items() if k not in strip},
               "pairs": [r.as_dict() for r in results]}
    if second:
        payload["pyroomacoustics"] = {"gain_db": second["gain_db"], "notes": second["notes"],
                                      "average": {k: v for k, v in (second["average"] or {}).items() if k not in strip},
                                      "pairs": [r.as_dict() for r in second["results"]]}
    write_results(out / "results.json", payload)
    write_report(out / "report.md", info, results, avg, second if pra_by_key else None)
    return {"info": info, "gain_db": gain_db, "results": results, "average": avg, "plan": plan, "out_dir": out,
            "animation_files": anim_files, "pyroomacoustics": second}


def _second_engine(future, pairs, rp: RunPlan, bt, fmax: float, scene: Scene) -> dict:
    """The pyroomacoustics comparison (same windows, bands and gain rule), or why there is none."""
    run = future.result()
    spec = scene.pra
    cfg_diffraction = (run.config or {}).get("diffraction", "off")
    notes = [f"{ENGINE_LABEL}: image sources up to order {spec.max_order}"
             + (" + ray tracing" if spec.ray_tracing else "") + ", the measured loudspeaker balloon, "
             + ("no diffraction" if cfg_diffraction == "off" else f"{cfg_diffraction.upper()} edge diffraction")
             + (f", air at {run.config['temperature_c']:g} degC / {run.config['humidity']:g} % RH"
                if (run.config or {}).get("temperature_c") is not None else "")
             + (", inside a fully absorbing shell (a closed room, so the objects block paths)" if K.PRA_CLOSED_ROOM else "")
             + f"; {run.wall_s:.0f} s on the CPU."]
    if run.error:
        return {"results": [], "average": None, "gain_db": 0.0, "notes": notes + [f"It failed: {run.error}"]}
    if run.no_path:
        notes.append("No sound path (pair left out): " + ", ".join(run.no_path) + ".")
    gain_db, results = analyze_broadband_run(pairs, run.irs, run.fs, rp.geoms, bt, fmax, rp.gain_pair)
    return {"results": results, "average": average_response(results, bt, fmax), "gain_db": gain_db, "notes": notes}


def write_animation(rp: RunPlan, data: SceneData, results, ground_z, out: Path, opts: RunOptions, phase) -> list[Path]:
    """Animation bundle of the scene's loudspeaker, its MP4 and a preview PNG (empty list when off)."""
    spec, pairs = data.scene.animation, rp.pairs
    if not opts.animation or animation_source(pairs, spec) is None:
        return []
    from benchmarks.bras.bras_render import render  # matplotlib animation writers only when needed

    sid = animation_source(pairs, spec)
    hl = next((p for p in pairs if p.source_id == sid and p.receiver_id == spec.receiver),
              next(p for p in pairs if p.source_id == sid))
    sim = next(r for r in results if r.key == hl.key).curves["sim_full"]
    irs = {"measured": (hl.fs, hl.ir), "simulated": (K.ANALYSIS_FS, sim)}
    # the forward animation runs need the simulated (clearance-safe) positions too
    meta = export_animation(rp.cfg, rp.scene_geo, rp.ctl_geo, rp.sim_pairs, spec, rp.bounds, out, data.scene.label,
                            (data.mesh.bmin, data.mesh.bmax), ground_z, pair_irs=irs, force=opts.force,
                            sim_source_phase=phase is not None)
    if meta is None:
        return []
    bundle = out / K.ANIMATION_DIR / meta["file"]
    preview = plot_animation_preview(load_bundle(bundle), out / "plots" / "animation_preview.png", K.ANIMATION_PREVIEW_FRAMES)
    return [bundle, *render(bundle, fmt="mp4"), preview]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list the scenes of scenes.py and their missing inputs")
    ap.add_argument("--scene", default=None, help="scene name in scenes.py (default: BRAS_SCENE or RS2_1m_rigid)")
    ap.add_argument("--fmax", type=float, default=None, help="one stage of the scene's band test (default: the first)")
    ap.add_argument("--all-stages", action="store_true", help="run every fmax stage of the band test")
    ap.add_argument("--ppw", type=float, default=None)
    ap.add_argument("--pairs", default="smoke", help="'smoke' (scene default), 'all' or 'LS1-MP1,LS4-MP4'")
    ap.add_argument("--omni", action="store_true")
    ap.add_argument("--material", default="csv", choices=K.MATERIAL_MODES)
    ap.add_argument("--no-animation", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    if args.list:
        for name, sc in SCENES.items():
            miss = missing_inputs(sc)
            print(f"{name:24s} {sc.label}" + (f"  [missing: {', '.join(Path(p).name for p in miss)}]" if miss else ""))
        return 0
    data = load_scene(get_scene(args.scene))
    bt = data.scene.band_test
    stages = list(bt.stages) if args.all_stages else [args.fmax if args.fmax is not None else list(bt.stages)[0]]
    pairs = ([p.key for p in data.measured] if args.pairs == "all" else list(data.scene.smoke_pairs)
             if args.pairs == "smoke" else args.pairs.split(","))
    for fmax in stages:
        opts = RunOptions(fmax=fmax, ppw=args.ppw or bt.stages.get(fmax, list(bt.stages.values())[0]), pair_keys=pairs,
                          directional=not args.omni, material_mode=args.material, animation=not args.no_animation,
                          force=args.force)
        res = run_benchmark(data, opts)
        print((res["out_dir"] / "report.md").read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
