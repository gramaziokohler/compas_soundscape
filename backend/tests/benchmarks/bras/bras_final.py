"""Final BRAS comparison: PFFDTD and compas_acoustics on every reference scene and every measured pair.

- PFFDTD: the 2.5 kHz stage, compared from 67.5 Hz to 2.5 kHz.
- compas_acoustics (mono): image sources to order 3 + ray tracing (20 000 rays), once without
  diffraction and once with UDFA, compared from 67.5 Hz to 16 kHz.

PFFDTD has its own global gain (the calibration pair's direct sound in its band). compas_acoustics has one
gain per scene, fitted on the run without diffraction and applied to every diffraction model: diffraction
adds level near the calibration pair's direct sound and must not turn the whole scene down. The PFFDTD runs
are cached with the regular benchmark (<BRAS_OUTPUT_ROOT>/<scene>/f2500/runs); every figure, report
and the summary go to <BRAS_OUTPUT_ROOT>/<name>/ (default ``final``). From backend/:

    python tests/benchmarks/bras/bras_final.py --dry-run          # plan and GPU estimate only
    python tests/benchmarks/bras/bras_final.py                    # every reference scene
    python tests/benchmarks/bras/bras_final.py --scenes RS5 --pairs smoke

Set PFFDTD_GPU_MEMORY_GB to the free GPU memory (the default 8 GB coarsens or crops the 2.5 kHz grids).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field, replace
from fnmatch import fnmatch
from pathlib import Path

_TESTS = Path(__file__).resolve().parents[2]   # backend/tests
for _p in (str(_TESTS.parent), str(_TESTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np  # noqa: E402

from benchmarks.bras import bras_constants as K  # noqa: E402
from benchmarks.bras.bras_analysis import analyze_broadband_run, analyze_run, average_response, metric_band  # noqa: E402
from benchmarks.bras.bras_benchmark import RunOptions, load_scene, output_dir, plan_run, use_precision  # noqa: E402
from benchmarks.bras.bras_domain import describe_padding  # noqa: E402
from benchmarks.bras.bras_plots_multi import (plot_average_multi, plot_overview_multi, plot_pair_multi,  # noqa: E402
                                              plot_summary)
from benchmarks.bras.bras_pra import PraConfig, simulate_pra  # noqa: E402
from benchmarks.bras.bras_report import write_results  # noqa: E402
from benchmarks.bras.bras_runner import is_cached, simulate  # noqa: E402
from benchmarks.bras.scenes import RS_SCENES, SCENES, missing_inputs  # noqa: E402


@dataclass(frozen=True)
class FinalSpec:
    name: str = "final"                   # sub-folder of BRAS_OUTPUT_ROOT
    fmin_hz: float = 67.5                 # lower end of every compared band
    pffdtd_fmax_hz: float = 2500.0        # PFFDTD stage, compared up to it
    ga_fmax_hz: float = 16000.0           # geometric acoustics compared up to this
    ga_max_order: int = 3
    ga_ray_tracing: bool = True
    ga_n_rays: int = 20000
    ga_diffraction: tuple = ("off", "udfa")
    cached_pffdtd: bool = False           # only cached PFFDTD runs: a missing one fails the scene instead of simulating
    animation: bool = True                # the wave animation of the scene's loudspeaker (2 more GPU runs)
    ga_shared_gain: bool = True           # every diffraction model takes the no-diffraction run's gain


GA_LABELS = {"off": "compas_acoustics, no diffraction", "udfa": "compas_acoustics, UDFA"}
PF_COLOR = "#eb6834"
GA_COLORS = ("#8a63d2", "#1baf7a")   # compas_acoustics without / with diffraction
STAGE_PPW = 10.0                     # points per wavelength requested off the scene's stages (the planner may coarsen to PPW_MIN)

# PFFDTD precision per scene (default double, as in the app). The RS2 rigid plates are 0.3-0.5 m short of an
# edge-clean domain at 2.5 kHz in double precision; single precision (half the GPU memory per node) makes them
# edge-clean at the same cost. Single vs double on one grid: <= 0.02 dB per band (bras_precision_check.py), and
# the double-precision runs at the highest edge-clean fmax (~2.4 kHz) agreed to 0.07 dB. RS3 stays not
# edge-clean: its 100 ms window would need 15-17 m of free air, and a 31 ms window or a ~0.9 kHz edge-clean
# run both moved its mean |dL| by <= 0.13 dB.
PF_PRECISION = {"RS2_1m_rigid": "single", "RS2_2m_rigid": "single"}
ENGINE_KEYS = (("pffdtd", "PFFDTD", PF_COLOR),
               ("ga_off", GA_LABELS["off"], GA_COLORS[0]), ("ga_udfa", GA_LABELS["udfa"], GA_COLORS[1]))


@dataclass
class Engine:
    key: str
    label: str
    color: str
    band: tuple
    results: list = field(default_factory=list)
    average: dict | None = None
    gain_db: float = 0.0
    notes: list = field(default_factory=list)
    wall_s: float = 0.0
    config: dict = field(default_factory=dict)

    def as_plot(self) -> dict:
        return {"label": self.label, "color": self.color, "band": self.band, "results": self.results, "average": self.average}

    def split(self) -> dict:
        """Mean |dL| over all pairs, the line-of-sight ones and the shadowed ones."""
        out = {}
        for what, sel in (("all", lambda r: True), ("los", lambda r: r.line_of_sight), ("shadow", lambda r: not r.line_of_sight)):
            v = [r.mean_abs_dl_db for r in self.results if sel(r)]
            if v:
                out[what] = round(float(np.mean(v)), 2)
                out[f"n_{what}"] = len(v)
        return out


def select(patterns: list) -> list:
    if not patterns:
        return list(RS_SCENES)
    return [n for n in SCENES if any(fnmatch(n, p) for p in patterns)]


def scene_options(data, spec: FinalSpec, pairs: str, fmax: float | None = None, precision: str = "double") -> RunOptions:
    bt = data.scene.band_test
    fmax = spec.pffdtd_fmax_hz if fmax is None else float(fmax)
    keys = [p.key for p in data.measured] if pairs == "all" else list(data.scene.smoke_pairs)
    return RunOptions(fmax=fmax, ppw=bt.stages.get(fmax, STAGE_PPW), pair_keys=keys, animation=spec.animation, pra=True,
                      ga_ray_tracing=spec.ga_ray_tracing, ga_diffraction="udfa", precision=precision)


def scene_plan(data, spec: FinalSpec, pairs: str):
    """(options, plan, precision) of the scene's PFFDTD run at FinalSpec.pffdtd_fmax_hz."""
    precision = PF_PRECISION.get(data.scene.name, "double")
    opts = scene_options(data, spec, pairs, spec.pffdtd_fmax_hz, precision)
    return opts, plan_run(data, opts), precision


def ga_configs(data, rp, spec: FinalSpec) -> list:
    scene = data.scene
    return [PraConfig(scene.name, spec.ga_max_order, spec.ga_ray_tracing, [p.key for p in rp.pairs], rp.fit is not None,
                      "csv", temperature_c=scene.temperature_c, humidity=scene.humidity, diffraction=d, n_rays=spec.ga_n_rays)
            for d in spec.ga_diffraction]


def _ga_engine(i: int, cfg: PraConfig, run, rp, bt_ga, spec: FinalSpec, gain_db: float | None = None) -> Engine:
    """``gain_db``: the global gain to apply (another run's); None fits it on the calibration pair."""
    e = Engine(f"ga_{cfg.diffraction}", GA_LABELS.get(cfg.diffraction, cfg.short_label()), GA_COLORS[i % len(GA_COLORS)],
               (spec.fmin_hz, spec.ga_fmax_hz), wall_s=run.wall_s, config=asdict(cfg))
    e.notes.append(f"{cfg.describe()}; {run.wall_s:.0f} s on the CPU" + (" (cached)" if run.cached else "") + ".")
    if run.error:
        e.notes.append(f"It failed: {run.error}")
        return e
    if run.no_path:
        e.notes.append("No sound path (pair left out): " + ", ".join(run.no_path) + ".")
    gain, results = analyze_broadband_run(rp.pairs, run.irs, run.fs, rp.geoms, bt_ga, spec.ga_fmax_hz, rp.gain_pair, gain_db)
    if gain_db is not None:
        e.notes.append(f"Global gain of the run without diffraction ({gain_db:+.2f} dB), not fitted on this run.")
    if results:
        e.results, e.gain_db, e.average = results, gain, average_response(results, bt_ga, spec.ga_fmax_hz)
    return e


def _pffdtd_run(data, rp, precision: str, fmax: float, runs: Path, spec: FinalSpec, force: bool):
    """Simulate (scene + empty-domain control) and analyse the scene's PFFDTD run."""
    mesh, scene = data.mesh, data.scene
    use_precision(precision)
    if spec.cached_pffdtd:
        missing = [what for what, c, g in (("scene", rp.cfg, rp.scene_geo), ("control", replace(rp.cfg, control=True), rp.ctl_geo))
                   if not (what == "control" and mesh.empty) and not is_cached(c, g, rp.pairs_data, rp.bounds, runs)]
        if missing:
            raise RuntimeError(f"PFFDTD {' and '.join(missing)} run not cached ({rp.cfg.tag()}); run without --cached-pffdtd")
    plate = simulate(rp.cfg, rp.scene_geo, rp.pairs_data, rp.bounds, force, out_root=runs)
    control = plate if mesh.empty else simulate(replace(rp.cfg, control=True), rp.ctl_geo, rp.pairs_data, rp.bounds,
                                                force, out_root=runs)
    ground_z = scene.ground.z if scene.ground is not None else None
    phase = data.phase if rp.fit is not None else None
    bt_pf = replace(scene.band_test, fmin_hz=spec.fmin_hz, fmax_fraction=1.0)
    gain, results = analyze_run(rp.pairs, plate.irs, control.irs, rp.geoms, bt_pf, fmax, rp.bounds, rp.gain_pair, phase, ground_z)
    d = rp.domain
    e = Engine("pffdtd", "PFFDTD", PF_COLOR, (spec.fmin_hz, fmax), results,
               average_response(results, bt_pf, fmax), gain, wall_s=plate.wall_s + (0.0 if mesh.empty else control.wall_s),
               config=asdict(rp.cfg))
    e.notes.append(f"{precision} precision; h = {d.h * 1e3:.2f} mm ({d.ppw_effective:.1f} points per wavelength at {fmax:g} Hz), "
                   f"{d.nodes / 1e6:.0f} M nodes, {d.gpu_gb:.1f} GB; window {scene.band_test.gate_ms:g} ms; "
                   f"{describe_padding(rp.padding)}; {e.wall_s:.0f} s on the GPU" + (" (cached)" if plate.cached else "") + ".")
    return e, results, phase, ground_z


def run_scene(name: str, spec: FinalSpec, pairs: str, root: Path, force: bool = False) -> dict:
    data = load_scene(SCENES[name])
    scene = data.scene
    bt = scene.band_test
    bt_ga = replace(bt, fmin_hz=spec.fmin_hz, fmax_fraction=1.0)
    opts, rp, precision = scene_plan(data, spec, pairs)
    fmax = spec.pffdtd_fmax_hz
    out = root / name
    plots = out / "plots"
    plots.mkdir(parents=True, exist_ok=True)
    dd = rp.domain
    print(f"[final] {name}: {len(rp.pairs)} pairs; PFFDTD {precision} precision, h = {dd.h * 1e3:.2f} mm, "
          f"{dd.nodes / 1e6:.0f} M nodes, {dd.gpu_gb:.1f} GB, {'edge-clean' if rp.padding['clean'] else 'NOT edge-clean'}, "
          f"~{rp.est_s / 60:.0f} min", flush=True)

    runs = output_dir(scene, fmax) / "runs"
    cfgs = ga_configs(data, rp, spec)
    pool = ThreadPoolExecutor(max_workers=1)   # the CPU engine runs beside the GPU
    futures = [pool.submit(simulate_pra, c, rp.ga_geo, rp.ga_pairs_data, runs, force) for c in cfgs]
    t0 = time.time()
    pf, results, phase, ground_z = _pffdtd_run(data, rp, precision, fmax, runs, spec, force)
    engines = [pf]
    shared = None   # the no-diffraction run's gain (ga_configs lists it first)
    for i, (c, fu) in enumerate(zip(cfgs, futures)):
        e = _ga_engine(i, c, fu.result(), rp, bt_ga, spec, shared if c.diffracts else None)
        if spec.ga_shared_gain and not c.diffracts and e.results:
            shared = e.gain_db
        engines.append(e)
    pool.shutdown()
    print(f"[final] {name}: simulated in {(time.time() - t0) / 60:.1f} min; mean |dL| "
          + ", ".join(f"{e.label} {e.average['mean_abs_dl_db']:.2f}" for e in engines if e.average), flush=True)
    d = rp.domain
    bt_pf = replace(bt, fmin_hz=spec.fmin_hz, fmax_fraction=1.0)

    # figures
    files = []
    try:
        from benchmarks.bras.bras_setup_plots import plot_setup

        use_precision(precision)
        files.append(plot_setup(data, replace(rp, ga=cfgs[-1]), plots, metric_band(bt_pf, fmax)))
    except Exception:  # a figure never fails the run
        traceback.print_exc()
    eng = [e.as_plot() for e in engines]
    for p in rp.pairs:
        files.append(plot_pair_multi(p.key, eng, bt.smoothing_fraction, plots / f"pair_{p.key}.png", scene.label))
    files.append(plot_average_multi(eng, len(rp.pairs), bt.smoothing_fraction, plots / "average.png", scene.label))
    los = {k: g.line_of_sight for k, g in rp.geoms.items()}
    files.append(plot_overview_multi(eng, [p.key for p in rp.pairs], los, plots / "overview.png", scene.label))
    anim_files = []
    if spec.animation:
        try:   # the omni-pulse wave animation (MP4 + preview), next to the figures
            from benchmarks.bras.bras_benchmark import write_animation

            use_precision(precision)   # the animation runs on the scene run's domain
            anim_files = write_animation(rp, data, results, ground_z, out, opts, phase)
            files += anim_files
        except Exception:  # an animation never fails the run
            traceback.print_exc()
    mp4 = next((Path(f) for f in anim_files if Path(f).suffix == ".mp4"), None)

    info = {"scene": name, "label": scene.label, "pairs": [p.key for p in rp.pairs], "gain_pair": rp.gain_pair,
            "chamber": scene.chamber, "temperature_c": scene.temperature_c, "humidity": scene.humidity,
            "window": f"{bt.pre_ms:g} ms before to {bt.gate_ms:g} ms after the direct sound",
            "grid": d.as_dict(), "padding": rp.padding, "moved": rp.moved, "spec": asdict(spec)}
    strip = ("f", "meas_db", "sim_db")
    payload = {"info": info, "engines": [{"key": e.key, "label": e.label, "band": e.band, "gain_db": e.gain_db,
                                          "notes": e.notes, "wall_s": e.wall_s, "config": e.config, "split": e.split(),
                                          "average": {k: v for k, v in (e.average or {}).items() if k not in strip},
                                          "pairs": [r.as_dict() for r in e.results]} for e in engines]}
    write_results(out / "results.json", payload)
    (out / "report.md").write_text(report(info, engines, rp, [Path(f).relative_to(out).as_posix() for f in files]),
                                   encoding="utf-8")
    use_precision("double")
    return {"scene": name, "label": scene.label, "pairs": len(rp.pairs), "gpu_min": pf.wall_s / 60,
            "cpu_min": sum(e.wall_s for e in engines[1:]) / 60, "precision": precision,
            "engines": {e.key: e.split() for e in engines}, "labels": {e.key: e.label for e in engines},
            "gains": {e.key: e.gain_db for e in engines},
            "mp4": mp4.relative_to(root).as_posix() if mp4 else None}


def _table(header: list, rows: list) -> list:
    return ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)] + ["| " + " | ".join(r) + " |" for r in rows]


def report(info: dict, engines: list, rp, files: list) -> str:
    lines = [f"# {info['label']}", "", f"Scene `{info['scene']}`, {len(info['pairs'])} pairs, generated "
             f"{time.strftime('%Y-%m-%d %H:%M')}. {info['chamber']}, {info['temperature_c']:g} degC, "
             f"{info['humidity']:g} % RH. Window: {info['window']}; level differences per 1/3 octave band "
             "(a band counts when its centre lies in the compared range, a quarter band of tolerance).", "",
             "![setup](plots/setup.png)", "", "## Engines", ""]
    mp4 = next((f for f in files if f.endswith(".mp4")), None)
    if mp4:
        lines[-2:-2] = [f"Wave animation (PFFDTD, omni pulse): [{Path(mp4).name}]({mp4})",
                        "", "![animation preview](plots/animation_preview.png)", ""]
    for e in engines:
        shared = any(n.startswith("Global gain of the run without diffraction") for n in e.notes)
        lines += [f"- **{e.label}**: compared {e.band[0]:g} Hz to {e.band[1] / 1000:g} kHz, global gain {e.gain_db:+.2f} dB "
                  + ("(the run without diffraction's)." if shared else f"(direct sound of {info['gain_pair']}).")] + [f"  - {n}" for n in e.notes]
    for m in info["moved"]:
        lines.append(f"- PFFDTD: {m['id']} simulated at {m['simulated_z_m'] * 1e3:.0f} mm (measured {m['z_m'] * 1e3:.0f} mm; "
                     "3 cells of clearance above the floor).")
    lines += ["", "## Mean |dL| (dB)", ""]
    rows = []
    for e in engines:
        s = e.split()
        rows.append([e.label] + [f"{s[w]:.2f} ({s['n_' + w]})" if w in s else "-" for w in ("all", "los", "shadow")])
    lines += _table(["Engine", "All pairs", "Line of sight", "Shadowed"], rows)
    lines += ["", "![average](plots/average.png)", "", "![overview](plots/overview.png)", "", "## Per pair", ""]
    by = [{r.key: r for r in e.results} for e in engines]
    rows = []
    for p in rp.pairs:
        g = rp.geoms[p.key]
        rows.append([p.key, f"{g.d_direct:.2f}", "yes" if g.line_of_sight else "no"]
                    + [f"{b[p.key].mean_abs_dl_db:.2f}" if p.key in b else "-" for b in by])
    lines += _table(["Pair", "Distance (m)", "Line of sight"] + [f"{e.label} mean abs dL" for e in engines], rows)
    lines += ["", "## Per band (mean over the pairs, simulated - measured, dB)", ""]
    bands = sorted({b for e in engines if e.average for b in e.average["bands_hz"]})
    cols = [dict(zip(e.average["bands_hz"], e.average["dl_mean_db"])) if e.average else {} for e in engines]
    lines += _table(["Band (Hz)"] + [e.label for e in engines],
                    [[f"{b:g}"] + [f"{c[b]:+.2f}" if b in c else "" for c in cols] for b in bands])
    lines += ["", "## Figures", ""] + [f"- [{f}]({f})" for f in files] + [""]
    return "\n".join(lines)


def write_index(rows: list, root: Path, spec: FinalSpec) -> Path:
    ok = [r for r in rows if not r.get("error") and "labels" in r]
    used = [k for k in ENGINE_KEYS if any(k[0] in r["engines"] for r in ok)]
    if ok:
        plot_summary(ok, used, root / "summary.png")
    lines = ["# BRAS reference scenes: final comparison", "",
             f"PFFDTD at {spec.pffdtd_fmax_hz:g} Hz, compared {spec.fmin_hz:g} Hz to its fmax; compas_acoustics (mono, image "
             f"sources to order {spec.ga_max_order}, ray tracing with {spec.ga_n_rays} rays), without diffraction and with UDFA, "
             f"compared {spec.fmin_hz:g} Hz to {spec.ga_fmax_hz / 1000:g} kHz. PFFDTD and compas_acoustics each have their own "
             "global gain per scene; with UDFA, compas_acoustics keeps the gain of its run without diffraction. Mean |dL| "
             "in dB (number of pairs). A pair an engine finds no sound path for is left out of its means: without "
             "diffraction that is every shadowed pair, so its 'all' covers the line-of-sight pairs only.", "",
             "PFFDTD runs in double precision, except the RS2 rigid plates (single precision, which makes their 2.5 kHz "
             "domain edge-clean; single vs double differs by <= 0.02 dB per band). RS3's domain is not edge-clean for its "
             "100 ms window (it would need 15-17 m of free air); a 31 ms window or a ~0.9 kHz edge-clean run moved its "
             "mean |dL| by <= 0.13 dB.", "",
             "![summary](summary.png)", ""]
    head = (["Scene", "Pairs"] + [f"{name}: all / LOS / shadowed" for _, name, _ in used]
            + ["PFFDTD precision", "Report", "Animation", "PFFDTD GPU (min)", "compas_acoustics CPU (min)"])
    body = []
    for r in rows:
        if r.get("error") or "labels" not in r:
            body.append([r["scene"], "-", *[f"FAILED: {r.get('error', 'not run with this version')}" if i == 0 else "-"
                                            for i in range(len(used))], "-", "-", "-", "-", "-"])
            continue
        cells = []
        for key, _, _ in used:
            sp = r["engines"].get(key) or {}
            cells.append(" / ".join(f"{sp[w]:.2f} ({sp['n_' + w]})" if w in sp else "-" for w in ("all", "los", "shadow")))
        body.append([r["scene"], str(r["pairs"]), *cells, r.get("precision", "double"), f"[report]({r['scene']}/report.md)",
                     f"[mp4]({r['mp4']})" if r.get("mp4") else "-", f"{r.get('gpu_min', 0):.0f}", f"{r.get('cpu_min', 0):.1f}"])
    lines += _table(head, body)
    path = root / "index.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (root / "index.json").write_text(json.dumps(rows, indent=1, default=str), encoding="utf-8")
    return path


def dry_run(names: list, spec: FinalSpec, pairs: str) -> int:
    total = 0.0
    for name in names:
        try:
            data = load_scene(SCENES[name])
            _, rp, precision = scene_plan(data, spec, pairs)
            d = rp.domain
            total += rp.est_s
            print(f"{name:24s} {precision:6s} {len(rp.pairs):3d} pairs  h {d.h * 1e3:5.2f} mm  "
                  f"{d.ppw_effective:4.1f} ppw  {d.nodes / 1e6:5.0f} M nodes  {d.gpu_gb:4.1f}/{d.gpu_budget_gb:.1f} GB  "
                  f"~{rp.est_s / 60:4.0f} min  {'edge-clean' if rp.padding.get('clean', True) else 'NOT edge-clean'}",
                  flush=True)
            use_precision("double")
        except Exception as exc:
            print(f"{name}: FAILED TO PLAN: {exc}")
    print(f"total PFFDTD estimate: {total / 3600:.1f} h (+ the CPU engine in parallel)")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenes", nargs="*", default=[], help="scene names or patterns (default: every reference scene)")
    ap.add_argument("--pairs", default="all", choices=("all", "smoke"))
    ap.add_argument("--name", default=FinalSpec.name, help="output sub-folder of BRAS_OUTPUT_ROOT")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="ignore cached simulations")
    ap.add_argument("--cached-pffdtd", action="store_true",
                    help="PFFDTD from the cache only (a scene whose PFFDTD run is not cached fails); compas_acoustics runs")
    args = ap.parse_args(argv)
    spec = FinalSpec(name=args.name, cached_pffdtd=args.cached_pffdtd)
    names = select(args.scenes)
    missing = [n for n in names if missing_inputs(SCENES[n])]
    if missing:
        raise SystemExit(f"missing inputs: {missing}")
    if args.dry_run:
        return dry_run(names, spec, args.pairs)
    root = K.OUTPUT_ROOT / spec.name
    root.mkdir(parents=True, exist_ok=True)
    store = root / "index.json"
    rows = {r["scene"]: r for r in json.loads(store.read_text(encoding="utf-8"))} if store.exists() else {}
    failed = 0
    for name in names:
        print(f"\n===== {name} =====", flush=True)
        try:
            rows[name] = run_scene(name, spec, args.pairs, root, args.force)
        except Exception as exc:
            traceback.print_exc()
            rows[name] = {"scene": name, "error": str(exc).splitlines()[0][:200]}
            failed += 1
        order = {n: i for i, n in enumerate(SCENES)}
        print(f"index -> {write_index(sorted(rows.values(), key=lambda r: order.get(r['scene'], 99)), root, spec)}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
