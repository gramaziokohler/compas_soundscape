"""One benchmark = one scene (scenes.py) x one fmax stage -> report.md, plots, animation MP4.

CLI (from backend/, with backend/ and backend/tests on PYTHONPATH):

    python -m benchmarks.bras.bras_benchmark --list
    python -m benchmarks.bras.bras_benchmark --scene RS2_1m_rigid --fmax 500 --pairs all
    python -m benchmarks.bras.bras_benchmark --scene RS2_1m_rigid --all-stages --pairs all

Outputs: backend/temp/benchmarks/bras/<scene>/f<fmax>/ (report.md, results.json, plots/, animation/).
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Optional

import numpy as np

from benchmarks.bras import bras_constants as K
from benchmarks.bras.bras_analysis import analyze_run, average_response, metric_band
from benchmarks.bras.bras_animation import animation_source, export_animation, load_bundle
from benchmarks.bras.bras_directivity import load_or_build_balloon, measured_spec
from benchmarks.bras.bras_domain import domain_plan
from benchmarks.bras.bras_geometry import (
    SceneMesh,
    control_scene_geometry,
    load_scene_mesh,
    material_table,
    scene_geometry,
)
from benchmarks.bras.bras_plots import plot_animation_preview, plot_average, plot_overview, plot_pair
from benchmarks.bras.bras_report import write_report, write_results
from benchmarks.bras.bras_runner import RunConfig, simulate
from benchmarks.bras.bras_scene import (
    MeasuredPair,
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
from benchmarks.bras.scenes import SCENES, Scene, get_scene, missing_inputs
from services.directivity_formats import FORMAT_BRAS_CSV


@dataclass
class SceneData:
    scene: Scene
    mesh: SceneMesh
    measured: list[MeasuredPair]
    balloon: Optional[dict]
    phase: Optional[SourcePhase]


@dataclass
class RunOptions:
    fmax: float
    ppw: float
    pair_keys: list
    directional: bool = True
    material_mode: str = "csv"
    animation: bool = True
    force: bool = False


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def load_scene(scene: Scene) -> SceneData:
    missing = missing_inputs(scene)
    if missing:
        raise FileNotFoundError(f"{scene.name}: missing inputs {[str(p) for p in missing]} (paths in scenes.py)")
    mesh = load_scene_mesh(scene.geometry, scene.materials)
    measured = load_sofa_pairs(scene.measurements)
    check_orientations(unique_sources(measured), scene.source)
    src = scene.source
    balloon = load_or_build_balloon(src.directivity, src.directivity_format) if src.directivity else None
    phase = None
    phase_on = os.environ.get(K.ENV_SOURCE_PHASE, "on").strip().lower() not in ("off", "0", "no", "false")
    if src.directivity and src.phase and phase_on and src.directivity_format == FORMAT_BRAS_CSV:
        phase = load_source_phase(src.directivity)
    return SceneData(scene, mesh, measured, balloon, phase)


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
                      material_mode=os.environ.get(K.ENV_MATERIAL, "csv"), force=_env_flag(K.ENV_FORCE))


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


def run_benchmark(data: SceneData, opts: RunOptions) -> dict:
    scene, mesh, bt = data.scene, data.mesh, data.scene.band_test
    pairs = select_pairs(data.measured, opts.pair_keys)
    ground_z = scene.ground.z if scene.ground is not None else None
    c_meas = speed_of_sound(scene.temperature_c)
    geoms = {p.key: pair_geometry(p, mesh.vertices, mesh.faces, scene.source, c_meas) for p in pairs}
    points = np.vstack([np.vstack([p.source_position, p.receiver_position]) for p in pairs])
    padding = float(bt.padding_m.get(opts.fmax, scene.padding_m))
    plan = domain_plan(mesh.bmin, mesh.bmax, points, opts.fmax, opts.ppw, bt.duration_s, padding, ground_z)
    if not plan.fits_gpu:
        raise RuntimeError(f"{scene.name}: domain needs {plan.gpu_gb:.1f} GB > budget {plan.gpu_budget_gb:.1f} GB "
                           "(lower ppw / fmax or the padding)")
    bounds = (plan.bmin, plan.bmax)
    coeffs = material_table(scene, opts.material_mode)
    scene_geo = scene_geometry(mesh, coeffs, scene.ground, bounds, plan.h)
    ctl_geo = control_scene_geometry(mesh, coeffs, scene.ground, bounds, plan.h)
    fit = data.balloon["fit"] if (opts.directional and data.balloon is not None) else None
    label = Path(scene.source.directivity).stem if scene.source.directivity else "omni"
    specs = {sid: measured_spec(fit, source_forward(sid, pos, scene.source), label)
             for sid, pos in unique_sources(pairs).items()} if fit else {}
    pairs_data = build_pairs_data(pairs, specs)
    out = output_dir(scene, opts.fmax)
    print(f"[bras] {scene.name} f{opts.fmax:g}: h = {plan.h * 1e3:.2f} mm, grid {plan.shape} "
          f"({plan.nodes / 1e6:.0f} M nodes, {plan.gpu_gb:.1f} GB), ~{plan.est_runtime_s:.0f} s per engine run", flush=True)

    cfg = RunConfig(scene=scene.name, fmax=opts.fmax, ppw=opts.ppw, grid_spacing=plan.h, duration=bt.duration_s,
                    pair_keys=[p.key for p in pairs], directional=fit is not None, material_mode=opts.material_mode,
                    padding_m=padding)
    runs = out / "runs"
    plate = simulate(cfg, scene_geo, pairs_data, bounds, opts.force, out_root=runs)
    control = simulate(replace(cfg, control=True), ctl_geo, pairs_data, bounds, opts.force, out_root=runs)
    phase = data.phase if fit is not None else None
    gain_db, results = analyze_run(pairs, plate.irs, control.irs, geoms, bt, opts.fmax, bounds, scene.gain_pair,
                                   phase, ground_z)
    avg = average_response(results, bt, opts.fmax)

    plots = out / "plots"
    shutil.rmtree(plots, ignore_errors=True)
    plots.mkdir(parents=True)
    band = metric_band(bt, opts.fmax)
    files = []
    for r in results:
        files.append(plot_pair(r, band, opts.fmax, bt.smoothing_fraction, plots / f"pair_{r.key}.png", scene.label))
    files.append(plot_average(avg, band, opts.fmax, bt.smoothing_fraction, len(results), plots / "average.png", scene.label))
    files.append(plot_overview(results, plots / "overview.png", scene.label))
    anim_files = write_animation(cfg, data, pairs, results, scene_geo, ctl_geo, bounds, ground_z, out, opts, phase)

    info = {
        "scene": scene.name, "scene_label": scene.label, "fmax_hz": opts.fmax,
        "inputs": {"Geometry (OBJ)": scene.geometry.obj, "Measurements (SOFA)": scene.measurements,
                   "Loudspeaker directivity": scene.source.directivity or "omni"},
        "materials": _material_rows(data, coeffs, 2 if scene.ground is not None else 0),
        "chamber": "hemi-anechoic" if scene.ground is not None else "anechoic",
        "temperature_c": scene.temperature_c, "humidity": scene.humidity, "c_measured": c_meas,
        "ground": (f"reflective floor at z = {scene.ground.z:g} m ({scene.ground.material})" if scene.ground is not None
                   else "no floor"),
        "n_faces": int(len(mesh.faces)), "bbox": f"{np.round(mesh.bmin, 3).tolist()} to {np.round(mesh.bmax, 3).tolist()} m",
        "source_model": (f"{label}, imported as the app does (first-order pattern per octave band), "
                         + ("loudspeaker phase applied" if phase is not None else "zero phase")) if fit else "omnidirectional",
        "grid": plan.as_dict(), "padding_m": padding, "duration_s": bt.duration_s,
        "wall_s": plate.wall_s + control.wall_s,
        "window": f"{bt.pre_ms:g} ms before to {bt.gate_ms:g} ms after the direct sound (half-Hann fades)",
        "band": band, "bands_per_octave": bt.bands_per_octave, "smoothing": bt.smoothing_fraction,
        "gain_db": gain_db, "gain_pair": scene.gain_pair,
        "files": [Path(f).relative_to(out).as_posix() for f in files + anim_files] + ["results.json"],
    }
    write_results(out / "results.json", {"info": info, "average": {k: v for k, v in avg.items() if k not in ("f", "meas_db", "sim_db")},
                                         "pairs": [r.as_dict() for r in results]})
    write_report(out / "report.md", info, results, avg)
    return {"info": info, "gain_db": gain_db, "results": results, "average": avg, "plan": plan, "out_dir": out,
            "animation_files": anim_files}


def write_animation(cfg: RunConfig, data: SceneData, pairs, results, scene_geo, ctl_geo, bounds, ground_z,
                    out: Path, opts: RunOptions, phase) -> list[Path]:
    """Animation bundle of the scene's loudspeaker, its MP4 and a preview PNG (empty list when off)."""
    spec = data.scene.animation
    if not opts.animation or animation_source(pairs, spec) is None:
        return []
    from benchmarks.bras.bras_render import render  # matplotlib animation writers only when needed

    sid = animation_source(pairs, spec)
    hl = next((p for p in pairs if p.source_id == sid and p.receiver_id == spec.receiver),
              next(p for p in pairs if p.source_id == sid))
    sim = next(r for r in results if r.key == hl.key).curves["sim_full"]
    irs = {"measured": (hl.fs, hl.ir), "simulated": (K.ANALYSIS_FS, sim)}
    meta = export_animation(cfg, scene_geo, ctl_geo, pairs, spec, bounds, out, data.scene.label,
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
            print(f"{name:20s} {sc.label}" + (f"  [missing: {', '.join(Path(p).name for p in miss)}]" if miss else ""))
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
