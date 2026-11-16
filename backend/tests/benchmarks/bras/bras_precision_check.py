"""Single vs double precision PFFDTD on one BRAS scene, on the same grid and domain.

The app runs PFFDTD in double precision (single failed validation A3, a long low-loss shoebox IR). The
final BRAS run uses single precision where a double-precision domain does not fit the GPU; this check
runs one edge-clean scene in both precisions on the identical grid and compares the IRs and the level
differences per band. From backend/:

    python tests/benchmarks/bras/bras_precision_check.py --scene RS2_1m_absorbing

Writes <BRAS_OUTPUT_ROOT>/final/_precision_check/<scene>.md and .json.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

_TESTS = Path(__file__).resolve().parents[2]   # backend/tests
for _p in (str(_TESTS.parent), str(_TESTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np  # noqa: E402

from benchmarks.bras import bras_constants as K  # noqa: E402
from benchmarks.bras.bras_analysis import analyze_run  # noqa: E402
from benchmarks.bras.bras_benchmark import RunOptions, load_scene, output_dir, plan_run, use_precision  # noqa: E402
from benchmarks.bras.bras_runner import simulate  # noqa: E402
from benchmarks.bras.scenes import SCENES  # noqa: E402

FMIN_HZ = 67.5
TOL_DB = 0.1          # largest band level difference single vs double accepted


def run(scene_name: str, fmax: float, out_dir: Path) -> dict:
    data = load_scene(SCENES[scene_name])
    scene, mesh = data.scene, data.mesh
    keys = [p.key for p in data.measured]
    bt = replace(scene.band_test, fmin_hz=FMIN_HZ, fmax_fraction=1.0)
    opts = RunOptions(fmax=fmax, ppw=scene.band_test.stages.get(fmax, 10.0), pair_keys=keys, animation=False, pra=False)
    rp_d = plan_run(data, opts)
    if not rp_d.padding["clean"]:
        raise SystemExit(f"{scene_name} is not edge-clean in double precision at {fmax:g} Hz: pick another scene")
    # same requested ppw as the double plan settled on: the single plan fits at once, so the same grid
    rp_s = plan_run(data, replace(opts, ppw=rp_d.padding["ppw"], precision="single"))
    same = np.isclose(rp_s.domain.h, rp_d.domain.h) and np.allclose(rp_s.bounds[0], rp_d.bounds[0]) \
        and np.allclose(rp_s.bounds[1], rp_d.bounds[1])
    if not same:
        raise SystemExit("the single-precision plan differs from the double one (grid or domain)")
    runs = output_dir(scene, fmax) / "runs"
    ground_z = scene.ground.z if scene.ground is not None else None
    phase = data.phase if rp_d.fit is not None else None
    out = {}
    for prec, rp in (("double", rp_d), ("single", rp_s)):
        use_precision(prec)
        plate = simulate(rp.cfg, rp.scene_geo, rp.pairs_data, rp.bounds, out_root=runs)
        control = plate if mesh.empty else simulate(replace(rp.cfg, control=True), rp.ctl_geo, rp.pairs_data, rp.bounds,
                                                    out_root=runs)
        gain, results = analyze_run(rp.pairs, plate.irs, control.irs, rp.geoms, bt, fmax, rp.bounds, rp.gain_pair, phase, ground_z)
        out[prec] = {"plate": plate, "results": {r.key: r for r in results}, "gain_db": gain}
    use_precision("double")
    rows, worst, ir_err = [], 0.0, []
    for k in keys:
        a, b = out["double"]["results"][k], out["single"]["results"][k]
        diff = np.abs(np.asarray(b.dl_db) - np.asarray(a.dl_db))
        worst = max(worst, float(diff.max()))
        x, y = out["double"]["plate"].irs[k], out["single"]["plate"].irs[k]
        n = min(len(x), len(y))
        err_db = 10 * np.log10(np.sum((y[:n] - x[:n]) ** 2) / np.sum(x[:n] ** 2))
        ir_err.append(err_db)
        rows.append({"pair": k, "max_band_diff_db": round(float(diff.max()), 3), "ir_error_db": round(float(err_db), 1),
                     "mean_abs_dl_double": a.mean_abs_dl_db, "mean_abs_dl_single": b.mean_abs_dl_db})
    verdict = worst <= TOL_DB
    summary = {"scene": scene_name, "fmax_hz": fmax, "h_mm": rp_d.domain.h * 1e3, "nodes_m": rp_d.domain.nodes / 1e6,
               "gb_double": rp_d.domain.gpu_gb, "gb_single": rp_s.domain.gpu_gb,
               "gpu_s_double": out["double"]["plate"].wall_s, "gpu_s_single": out["single"]["plate"].wall_s,
               "gain_db_double": out["double"]["gain_db"], "gain_db_single": out["single"]["gain_db"],
               "worst_band_diff_db": round(worst, 3), "worst_ir_error_db": round(float(max(ir_err)), 1),
               "tolerance_db": TOL_DB, "pass": verdict, "pairs": rows}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{scene_name}.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    lines = [f"# Single vs double precision PFFDTD: {scene_name}, {fmax:g} Hz", "",
             f"Same grid and domain (h = {summary['h_mm']:.2f} mm, {summary['nodes_m']:.0f} M nodes): "
             f"{summary['gb_double']:.1f} GB in double, {summary['gb_single']:.1f} GB in single; scene run "
             f"{summary['gpu_s_double']:.0f} s vs {summary['gpu_s_single']:.0f} s on the GPU.", "",
             f"**{'PASS' if verdict else 'FAIL'}**: largest band level difference between the precisions "
             f"{worst:.3f} dB (tolerance {TOL_DB} dB, 1/3 octave bands {FMIN_HZ:g} Hz to {fmax:g} Hz); largest IR "
             f"difference {max(ir_err):.1f} dB re the IR's energy. Global gain {summary['gain_db_double']:+.3f} dB (double) vs "
             f"{summary['gain_db_single']:+.3f} dB (single).", "",
             "| Pair | Max band diff (dB) | IR difference (dB re IR) | Mean abs dL double | Mean abs dL single |",
             "|---|---|---|---|---|"]
    lines += [f"| {r['pair']} | {r['max_band_diff_db']:.3f} | {r['ir_error_db']:.1f} | {r['mean_abs_dl_double']:.2f} | "
              f"{r['mean_abs_dl_single']:.2f} |" for r in rows]
    (out_dir / f"{scene_name}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:5]), flush=True)
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scene", default="RS2_1m_absorbing")
    ap.add_argument("--fmax", type=float, default=2500.0)
    args = ap.parse_args(argv)
    summary = run(args.scene, args.fmax, K.OUTPUT_ROOT / "final" / "_precision_check")
    return 0 if summary["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
