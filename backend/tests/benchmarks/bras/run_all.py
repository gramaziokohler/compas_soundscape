"""Run every BRAS reference scene (RS1-RS7) in sequence: one benchmark per scene and fmax stage.

From backend/, with the compas-toy python:

    python tests/benchmarks/bras/run_all.py --dry-run          # check everything first: no GPU
    python tests/benchmarks/bras/run_all.py                    # all scenes, all stages, every pair
    python tests/benchmarks/bras/run_all.py --scenes "RS1*" RS5 --stages 500 --pairs smoke
    python tests/benchmarks/bras/run_all.py --scenes RS5 --stages 500 --ga-ray-tracing on   # + ray tracing

Each benchmark writes its report, plots and animation MP4 as it finishes
(<BRAS_OUTPUT_ROOT>/<scene>/f<fmax>/); ``index.md`` in the output root lists them all and is
rewritten after every benchmark. A failing scene is recorded and the run goes on. Finished
simulations are cached, so an interrupted run resumes where it stopped.

``--dry-run`` reads every input, plans every grid and runs the app's geometry preflight, builds the
geometric-acoustics room (with compas_acoustics: the edges its diffraction will use), then prints what
would be simulated (``plan.md`` in the output root).
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback
from fnmatch import fnmatch
from pathlib import Path

_TESTS = Path(__file__).resolve().parents[2]   # backend/tests
for _p in (str(_TESTS.parent), str(_TESTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np  # noqa: E402

from benchmarks.bras import bras_constants as K  # noqa: E402
from benchmarks.bras.bras_benchmark import (RunOptions, SceneData, ga_ray_tracing_arg, load_scene, output_dir,  # noqa: E402
                                            plan_run, run_benchmark)
from benchmarks.bras.bras_domain import describe_padding  # noqa: E402
from benchmarks.bras.bras_pra import ENGINE_LABEL, env_diffraction, ga_scene  # noqa: E402
from benchmarks.bras.bras_scene import onset_time  # noqa: E402
from benchmarks.bras.scenes import RS_SCENES, SCENES, missing_inputs  # noqa: E402

INDEX = "index.md"
ICON_MATERIALS = ("raven__", "[Color")   # loudspeaker, microphone, head and axis icons of the BRAS models
PLAN = "plan.md"


def select_scenes(patterns: list[str]) -> list[str]:
    if not patterns:
        return list(RS_SCENES)
    names = [n for n in SCENES if any(fnmatch(n, p) for p in patterns)]
    if not names:
        raise SystemExit(f"No scene matches {patterns}; scenes: {sorted(SCENES)}")
    return names


def stage_options(data: SceneData, stages: list[str], pairs: str, args) -> list[RunOptions]:
    bt = data.scene.band_test
    fmaxes = list(bt.stages) if stages == ["all"] else [float(s) for s in stages]
    keys = [p.key for p in data.measured] if pairs == "all" else list(data.scene.smoke_pairs)
    return [RunOptions(fmax=f, ppw=bt.stages[f], pair_keys=keys, directional=not args.omni,
                       animation=not args.no_animation, force=args.force,
                       pra=not args.no_pra, high_order=not args.first_order,
                       gain_pair=args.gain_pair, ga_ray_tracing=ga_ray_tracing_arg(args.ga_ray_tracing),
                       ga_diffraction=args.ga_diffraction or env_diffraction()) for f in fmaxes if f in bt.stages]


def preflight_errors(rp) -> list[str]:
    """The checks the PFFDTD job runs before the GPU (mesh preparation + geometry preflight)."""
    from services.pffdtd_job import prepare_pffdtd_mesh
    from services.simulation_preflight_service import ENGINE_PFFDTD, PreflightContext, SeedMeta, SimulationPreflightService

    mesh, seed_meta = prepare_pffdtd_mesh(rp.scene_geo, rp.pairs_data, None)
    ctx = PreflightContext(engine=ENGINE_PFFDTD, seeds=[SeedMeta(**s) for s in seed_meta],
                           pairs=[(p["source_id"], p["receiver_id"]) for p in rp.pairs_data],
                           pffdtd_fmax=rp.cfg.fmax, pffdtd_ppw=rp.cfg.ppw, pffdtd_duration=rp.cfg.duration)
    issues = SimulationPreflightService.analyze(mesh, ctx).issues
    # the grid-size check uses the object bbox; the padded domain is checked by the plan itself
    return [f"{i.title}: {i.detail}" for i in issues
            if i.severity == "error" and i.code.startswith("pffdtd_") and i.code != "pffdtd_grid_too_large"]


def describe_scene(data: SceneData) -> list[str]:
    scene, mesh = data.scene, data.mesh
    lines = [f"## {scene.name}: {scene.label}", "",
             f"- Geometry: `{scene.geometry.path.name}`; {len(mesh.faces)} triangles kept, bbox "
             f"{np.round(mesh.bmin, 3).tolist()} to {np.round(mesh.bmax, 3).tolist()} m"
             + (" (no object: floor only)" if mesh.empty else ""),
             f"- Chamber: {scene.chamber}, {scene.temperature_c:g} degC, {scene.humidity:g} % RH"
             + (f"; reflective floor at z = {scene.ground.z:g} m" if scene.ground else "")]
    for key, mi in scene.materials.items():
        labels = sorted({lab for lab, m in zip(mesh.labels, mesh.materials) if m == key})
        n = sum(1 for m in mesh.materials if m == key)
        where = f"{n} triangles" + (f" (model material {', '.join(labels)})" if labels and labels != [key] else "")
        if scene.ground is not None and scene.ground.material == key:
            where = "the floor"
        lines.append(f"- Material `{Path(mi.csv).name if mi.csv else mi.alpha}` on {where}")
    if mesh.dropped:
        other = [f"{k} ({v['tris']} tri, {v['area_m2']:.2f} m2)" for k, v in
                 sorted(mesh.dropped.items(), key=lambda kv: -kv[1]["area_m2"]) if not k.startswith(ICON_MATERIALS)]
        lines.append("- Left out: " + ", ".join(other + ["the loudspeaker / microphone / axis icons"]))
    if mesh.skp is not None and mesh.skp.hidden_faces:
        lines.append(f"- Hidden in the model (not used): {mesh.skp.hidden_faces} triangles")
    src = data.source
    lines.append("- Loudspeakers (phi, theta): " + ", ".join(f"{k} {tuple(v)}" for k, v in sorted(src.orientations.items()))
                 + ("; all aim at " + str(src.aim_point) if src.aim_point else ""))
    lines.append(f"- Positions from the {'model labels' if data.positions_from == 'labels' else 'SOFA file'}; "
                 f"{len(data.measured)} measured pairs; level calibrated on {scene.gain_pair}")
    for n in data.position_notes:
        lines.append(f"  - {n['id']}: label {n['label']}, SOFA {n['sofa']} ({n['deviation_m'] * 100:.1f} cm apart)")
    from benchmarks.bras.bras_scene import pair_geometry, speed_of_sound

    c = speed_of_sound(scene.temperature_c)
    devs = []
    for p in data.measured:
        g = pair_geometry(p, mesh.vertices, mesh.faces, src, c)
        if g.line_of_sight:
            devs.append(abs(onset_time(p.ir, p.fs) - g.t_direct) * 1e3)
    if devs:
        lines.append(f"- Measured direct-sound onset vs geometry (line-of-sight pairs): max {max(devs):.2f} ms, "
                     f"mean {np.mean(devs):.2f} ms")
    return lines


def describe_stage(data: SceneData, opts: RunOptions) -> tuple[list[str], float, list[str]]:
    rp = plan_run(data, opts)
    d, bt = rp.domain, data.scene.band_test
    errors = preflight_errors(rp)
    lines = [f"- **fmax {opts.fmax:g} Hz**: compared {bt.fmin_hz:g} to {bt.fmax_fraction * opts.fmax:g} Hz, window "
             f"{bt.gate_ms:g} ms; h = {d.h * 1e3:.2f} mm ({d.ppw_effective:.1f} points per wavelength), "
             f"{d.nodes / 1e6:.0f} M nodes, {d.gpu_gb:.1f} of {d.gpu_budget_gb:.1f} GB; "
             f"{len(rp.pairs)} pairs, {rp.engine_runs} GPU runs + animation, about {rp.est_s / 60:.0f} min",
             f"  - {describe_padding(rp.padding)}"]
    for m in rp.moved:
        lines.append(f"  - {m['id']} at {m['z_m'] * 1e3:.0f} mm above the floor is simulated at {m['simulated_z_m'] * 1e3:.0f} mm")
    lines += [f"  - PREFLIGHT ERROR: {e}" for e in errors]
    lines += describe_ga(rp, errors)
    return lines, rp.est_s, errors


def describe_ga(rp, errors: list) -> list[str]:
    """The geometric-acoustics run: settings, and the room the engine builds (walls, closure, the
    edges its diffraction will use). A failure to build it is a dry-run error."""
    if rp.ga is None:
        return ["  - Geometric acoustics: off"]
    lines = [f"  - {rp.ga.describe()}; {len(rp.pairs)} pairs on the CPU"]
    try:
        ga = ga_scene(rp.ga, rp.ga_geo, rp.ga_pairs_data)
    except Exception as exc:  # reported, and the dry run goes on
        errors.append(f"geometric-acoustics room: {exc}")
        return lines + [f"  - GEOMETRIC-ACOUSTICS ERROR: {type(exc).__name__}: {exc}"]
    lines.append(f"    - room: {ga.describe()} (inside the absorbing shell"
                 + (", whose bottom is the floor)" if rp.ga_geo and K.PRA_FLOOR_KEY in rp.ga_geo["object_face_ranges"] else ")"))
    shadowed = [p.key for p in rp.pairs if not rp.geoms[p.key].line_of_sight]
    if rp.ga.diffracts and not ga.scene_edges:
        lines.append("    - NO EDGE OF THE SCENE DIFFRACTS" + (": the shadowed pairs will get no diffracted sound" if shadowed else ""))
        if shadowed:
            errors.append("geometric acoustics: diffraction on, but no edge of the scene diffracts")
    if shadowed:
        lines.append(f"    - {len(shadowed)} pairs without line of sight (diffraction only): {', '.join(shadowed)}")
    lines += [f"    - compas_acoustics warning: {w}" for w in ga.warnings]
    return lines


def dry_run(names: list[str], args) -> int:
    lines, total, problems = ["# BRAS reference scenes: run plan (dry run, nothing simulated)", ""], 0.0, []
    for name in names:
        scene = SCENES[name]
        miss = missing_inputs(scene)
        if miss:
            lines += [f"## {name}", "", f"- MISSING INPUTS: {[str(p) for p in miss]}", ""]
            problems.append(name)
            continue
        try:
            data = load_scene(scene)
            lines += describe_scene(data)
            for opts in stage_options(data, args.stages, args.pairs, args):
                stage_lines, est, errors = describe_stage(data, opts)
                lines += stage_lines
                total += est
                if errors:
                    problems.append(f"{name} f{opts.fmax:g}")
        except Exception as exc:  # report and go on: the point of a dry run
            lines += [f"## {name}", "", f"- FAILED TO PLAN: {exc}"]
            problems.append(name)
        lines.append("")
    lines += [f"Total GPU time, rough estimate: {total / 3600:.1f} h.",
              ("Problems: " + ", ".join(problems)) if problems else "No problem found."]
    text = "\n".join(lines)
    K.OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    (K.OUTPUT_ROOT / PLAN).write_text(text, encoding="utf-8")
    print(text)
    print(f"\n-> {K.OUTPUT_ROOT / PLAN}")
    return 1 if problems else 0


def write_index(rows: list[dict]) -> Path:
    lines = ["# BRAS reference scenes vs PFFDTD", "",
             "| Scene | fmax (Hz) | Pairs | Mean abs dL, PFFDTD (dB) | Mean abs dL, geometric acoustics (dB) | Report | Average response "
             "| Animation | Time (min) |", "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if r.get("error"):
            lines.append(f"| {r['scene']} | {r['fmax']:g} | - | FAILED: {r['error']} | - | - | - | - | - |")
            continue
        rel = f"{r['scene']}/f{r['fmax']:g}"
        mp4 = f"[mp4]({rel}/{r['mp4']})" if r.get("mp4") else "-"
        pra = f"{r['pra']:.2f} ({r.get('pra_label') or ENGINE_LABEL})" if r.get("pra") is not None else "-"
        lines.append(f"| {r['label']} | {r['fmax']:g} | {r['pairs']} | {r['mean_abs_dl']:.2f} | {pra} | [report]({rel}/report.md) "
                     f"| ![average]({rel}/plots/average.png) | {mp4} | {r['minutes']:.0f} |")
    path = K.OUTPUT_ROOT / INDEX
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def run(names: list[str], args) -> int:
    rows, failed = [], 0
    for name in names:
        scene = SCENES[name]
        try:
            data = load_scene(scene)
            stages = stage_options(data, args.stages, args.pairs, args)
        except Exception as exc:
            traceback.print_exc()
            rows.append({"scene": name, "fmax": 0.0, "error": str(exc)[:200]})
            failed += 1
            write_index(rows)
            continue
        for opts in stages:
            t0 = time.time()
            print(f"\n===== {name}, fmax {opts.fmax:g} Hz, {len(opts.pair_keys)} pairs =====", flush=True)
            try:
                out = run_benchmark(data, opts)
                mp4 = next((p for p in out["animation_files"] if p.suffix == ".mp4"), None)
                rows.append({"scene": name, "label": scene.label, "fmax": opts.fmax, "pairs": len(out["results"]),
                             "mean_abs_dl": out["average"]["mean_abs_dl_db"],
                             "pra": ((out.get("geometric_acoustics") or {}).get("average") or {}).get("mean_abs_dl_db"),
                             "pra_label": (out.get("geometric_acoustics") or {}).get("label"), "minutes": (time.time() - t0) / 60.0,
                             "mp4": mp4.relative_to(output_dir(scene, opts.fmax)).as_posix() if mp4 else None})
                print(f"----- {name} f{opts.fmax:g}: mean |dL| {out['average']['mean_abs_dl_db']:.2f} dB -> {out['out_dir']}")
            except Exception as exc:
                traceback.print_exc()
                rows.append({"scene": name, "fmax": opts.fmax, "error": str(exc).splitlines()[0][:200]})
                failed += 1
            print(f"index -> {write_index(rows)}", flush=True)
    return 1 if failed else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenes", nargs="*", default=[], help="scene names or patterns (default: every reference scene)")
    ap.add_argument("--stages", nargs="*", default=["all"], help="fmax stages in Hz (default: all of each scene)")
    ap.add_argument("--pairs", default="all", choices=("all", "smoke"), help="every measured pair, or the smoke pairs")
    ap.add_argument("--dry-run", action="store_true", help="plan and check everything without simulating")
    ap.add_argument("--no-animation", action="store_true")
    ap.add_argument("--no-pra", action="store_true", help="skip the geometric-acoustics (compas_acoustics / pyroomacoustics) curve")
    ap.add_argument("--omni", action="store_true", help="omnidirectional loudspeakers")
    ap.add_argument("--force", action="store_true", help="ignore cached simulations")
    ap.add_argument("--first-order", action="store_true",
                    help="PFFDTD with the app's first-order directivity fit (default: the whole measured balloon)")
    ap.add_argument("--gain-pair", default="on_axis", help="on_axis (default), scene, or a pair key")
    ap.add_argument("--ga-ray-tracing", choices=("on", "off", "scene"), default="scene",
                    help="geometric acoustics: ray tracing (default: each scene's setting, or BRAS_GA_RAY_TRACING)")
    ap.add_argument("--ga-diffraction", choices=K.GA_DIFFRACTION_MODELS, default=None,
                    help=f"geometric acoustics: edge diffraction (default: {K.GA_DIFFRACTION_DEFAULT}, or BRAS_GA_DIFFRACTION)")
    args = ap.parse_args(argv)
    names = select_scenes(args.scenes)
    return dry_run(names, args) if args.dry_run else run(names, args)


if __name__ == "__main__":
    sys.exit(main())
