"""Run the PFFDTD validation suite and write a report (JSON + plots + markdown summary).

    cd backend
    python -m pffdtd_backend.validation.run_validation --work-dir D:/pffdtd_val [--quick] [--only A3,A4]

Each test module exposes run(work_dir, quick) -> dict with a "pass" key; results are
written to <work-dir>/report/<test>.json as they finish, so a long sweep can be resumed
(A3/A4 cache per-run results inside their simulation folders).
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
import time
import traceback
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

TESTS = {
    "B1": "pffdtd_backend.validation.test_b1_parity",
    "A2": "pffdtd_backend.validation.test_a2_cube",
    "A1": "pffdtd_backend.validation.test_a1_free_field",
    "A3": "pffdtd_backend.validation.test_a3_shoebox",
    "A4": "pffdtd_backend.validation.test_a4_rotated",
    "B2": "pffdtd_backend.validation.test_b2_absorption",
    "B3": "pffdtd_backend.validation.test_b3_energy",
    "C1": "pffdtd_backend.validation.test_c1_reciprocity",
}


def _plot(report_dir: Path, results: dict) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    for key, err_key, xlabel in (("A1", "rel_linf_error", "1/h (1/m)"), ("A2", "linf_error", "1/h (1/m)")):
        res = results.get(key)
        if not res or "series" not in res:
            continue
        fig, ax = plt.subplots(figsize=(6, 4))
        for s in res["series"]:
            x = [c["inv_h"] for c in s["cases"]]
            y = [c[err_key] for c in s["cases"]]
            label = f"{s['grid']}" + (f" C={s['courant_factor']:g}x" if "courant_factor" in s else "") + f" (rate {s['rate']:.2f})"
            ax.loglog(x, y, "o-", label=label)
        ax.set_xlabel(xlabel)
        ax.set_ylabel("L-inf error")
        ax.grid(True, which="both", alpha=0.3)
        ax.legend(fontsize=8)
        ax.set_title(res["name"])
        fig.tight_layout()
        fig.savefig(report_dir / f"{key}_convergence.png", dpi=130)
        plt.close(fig)

    fig, ax = plt.subplots(figsize=(6, 4))
    any_line = False
    for key, groups in (("A3", ("cartesian", "fcc")), ("A4", ("cartesian", "fcc"))):
        res = results.get(key)
        if not res:
            continue
        for g in groups:
            rows = res.get(g) or []
            if rows:
                any_line = True
                ax.plot([r["ppw_at_500hz"] for r in rows], [r["worst_cplx_err_db"] for r in rows], "o-", label=f"{key} {g}")
    if any_line:
        ax.axhline(-20, color="k", ls="--", lw=1, label="-20 dB criterion")
        ax.set_xlabel("PPW at 500 Hz")
        ax.set_ylabel("worst complex error (dB)")
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=8)
        ax.set_title("A3/A4: complex error vs grid resolution")
        fig.tight_layout()
        fig.savefig(report_dir / "A3_A4_error_vs_ppw.png", dpi=130)
    plt.close(fig)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--only", default=None, help="comma-separated test keys, e.g. A3,A4")
    args = ap.parse_args()

    work_dir = Path(args.work_dir).resolve()
    report_dir = work_dir / "report"
    report_dir.mkdir(parents=True, exist_ok=True)
    keys = args.only.split(",") if args.only else list(TESTS)

    results = {}
    for p in report_dir.glob("*.json"):
        results[p.stem] = json.loads(p.read_text())
    for key in keys:
        t0 = time.time()
        print(f"=== {key} ===", flush=True)
        try:
            res = importlib.import_module(TESTS[key]).run(work_dir, args.quick)
        except Exception as exc:  # keep going; record the failure
            res = {"name": key, "pass": False, "error": f"{exc}\n{traceback.format_exc()}"}
        res["wall_s"] = time.time() - t0
        results[key] = res
        (report_dir / f"{key}.json").write_text(json.dumps(res, indent=1, default=str))
        print(f"=== {key}: {'PASS' if res['pass'] else 'FAIL'} ({res['wall_s']:.0f} s) ===", flush=True)
    _plot(report_dir, results)
    summary = {k: results[k]["pass"] for k in TESTS if k in results}
    (report_dir / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0 if all(summary.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
