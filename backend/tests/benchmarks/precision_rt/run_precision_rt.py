"""Single vs double precision PFFDTD as a function of the room's reverberation time.

Finds the reverberation time below which single precision (half the GPU memory per node) gives the
same impulse responses as double. Validation A3 (rigid shoebox) fails in single precision while the
absorbing BRAS scenes match to 0.02 dB, so the error depends on how weakly the room is damped.

Each case is a shoebox run in both precisions on the identical grid, processed exactly like the app
(pffdtd_backend.postprocess.to_ir: 10 Hz low-cut, low-pass at fmax, 48 kHz), air absorption off (the
filter is linear and identical for both precisions, so it only hides tail differences). Two absorber
layouts:
  - uniform:     every face absorbs (all modes damped alike);
  - floor_ceil:  floor and ceiling absorb, the walls are rigid (horizontal modes barely damped: the
                 hard case, typical of a carpet + acoustic ceiling room).
The absorption is frequency independent and set from Eyring's formula for a target RT. The RT used to
state the crossover is T30 from Schroeder backward integration of the double-precision IR.

Metrics per receiver and octave band (single vs double), for IR windows of 0.5 to 5 s:
  band level difference (dB), Schroeder decay curve difference down to -50 dB (dB), T30 and EDT
  relative difference (%), C80 difference (dB), and the error floor: the largest 50 ms frame of the
  incoherent error (single minus the best-gain double) from 0.2 s on, re the band's peak frame (dB).
  Broadband: the sub-audio drift (error power below 10 Hz re the peak), with the app's low-cut and
  with an extra 20 Hz high-pass (a candidate fix; the drift is the integrated rounding noise of the
  differentiated source that single precision uses).

Run from backend/ in the compas-pffdtd env (the env the PFFDTD worker uses):

    python -m tests.benchmarks.precision_rt.run_precision_rt --grid default
    python -m tests.benchmarks.precision_rt.run_precision_rt --report

Results (cached per case) go to <repo>/../compas_soundscape_benchmarks/precision_rt/.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

_BACKEND = Path(__file__).resolve().parents[3]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from config.constants import (  # noqa: E402
    AUDIO_SAMPLE_RATE,
    PFFDTD_LOWCUT_HZ,
    PFFDTD_LOWCUT_ORDER,
    PFFDTD_LOWPASS_ORDER,
    PFFDTD_SPEED_OF_SOUND,
    PFFDTD_TEMPERATURE_C,
    PFFDTD_RELATIVE_HUMIDITY,
)
from utils.pffdtd_grid import aligned_spacing  # noqa: E402

OUT_ROOT = Path(os.environ.get("PRECISION_RT_OUTPUT_ROOT", _BACKEND.parents[1] / "compas_soundscape_benchmarks" / "precision_rt"))

# grids: (room dims, fmax, ppw, simulated duration)
GRIDS = {
    "default": dict(dims=(6.0, 5.0, 3.5), fmax=500.0, ppw=20.0, duration=5.0),   # app defaults (fmax 500, PPW 20)
    "fine": dict(dims=(4.0, 3.0, 2.5), fmax=1000.0, ppw=20.0, duration=5.0),     # 2x the steps per second
    "finer": dict(dims=(3.2, 2.5, 2.1), fmax=2000.0, ppw=20.0, duration=2.0),    # 4x the steps per second
}
LAYOUTS = {
    "uniform": ("x0", "x1", "y0", "y1", "z0", "z1"),
    "floor_ceil": ("z0", "z1"),
}
# single-precision variants, each compared with double (impulse source):
#   single      the app's single path: PFFDTD's differentiated source (bilinear), integrated after the run
#   (a plain impulse source is not possible: the single-precision engine asserts a differentiated source)
VARIANTS = {"single": None}   # name -> SimSpec.diff_source (None: the default, differentiated in single)
RT_TARGETS = [0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 10.0]   # Eyring, s; plus a rigid room
ALPHA_MAX = 0.95
BANDS_HZ = [63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0]
MAT_BANDS = [125, 250, 500, 1000, 2000, 4000]
WINDOWS_S = [0.5, 1.0, 2.0, 3.0, 5.0]
EDC_FLOOR_DB = -50.0                # decay curve compared down to here (T30 uses -5..-35 dB)
FRAME_S = 0.05                      # frames for the error floor
FLOOR_FROM_S = 0.2                  # error floor: frames from here on (after the direct sound and early reflections)
DRIFT_HZ = 10.0                     # sub-audio drift: error power below this
EXTRA_HP_HZ = 20.0                  # candidate fix: an extra high-pass after the app's low-cut
SRC_FRAC = (0.23, 0.31, 0.41)       # source and receivers as fractions of the room dims (no symmetry)
RCV_FRACS = [(0.71, 0.62, 0.47), (0.55, 0.19, 0.33), (0.86, 0.83, 0.58)]

# Pass criteria: what is heard. Energy decay (level, T30, EDT, C80) at a fraction of the perceptual JNDs
# (level 1 dB, RT 5 %, C80 1 dB), and the waveform of the direct sound + early reflections. The late
# tail's fine structure drifts in phase in single precision (error re the signal ~-20 dB at 1 s, -10 dB
# at 3 s, at any damping) while its envelope and spectrum stay; that and the error floor are reported,
# not judged.
TOL_BAND_DB = 0.1
TOL_RT_PCT = 1.0
TOL_C80_DB = 0.1
EARLY_S = 0.1           # early part: direct sound + first reflections (from the direct sound on)
TOL_EARLY_DB = -30.0    # incoherent error of the early part re its energy
TOL_EDC_DB = 0.5        # reported only
TOL_FLOOR_DB = -80.0    # reported only


def eyring_alpha(dims, faces, rt: float) -> float:
    """Uniform alpha on ``faces`` giving Eyring RT ``rt`` (the other faces rigid). Capped at ALPHA_MAX."""
    lx, ly, lz = dims
    area = {"x0": ly * lz, "x1": ly * lz, "y0": lx * lz, "y1": lx * lz, "z0": lx * ly, "z1": lx * ly}
    S = sum(area.values())
    S_abs = sum(area[f] for f in faces)
    V = lx * ly * lz
    k = 24.0 * math.log(10.0) / PFFDTD_SPEED_OF_SOUND
    mean_alpha = 1.0 - math.exp(-k * V / (S * rt))
    return min(mean_alpha * S / S_abs, ALPHA_MAX)


def eyring_rt(dims, faces, alpha: float) -> float:
    lx, ly, lz = dims
    area = {"x0": ly * lz, "x1": ly * lz, "y0": lx * lz, "y1": lx * lz, "z0": lx * ly, "z1": lx * ly}
    S = sum(area.values())
    mean_alpha = sum(area[f] for f in faces) * alpha / S
    if mean_alpha <= 0:
        return math.inf
    return 24.0 * math.log(10.0) / PFFDTD_SPEED_OF_SOUND * lx * ly * lz / (-S * math.log(1.0 - mean_alpha))


def simulate(case_dir: Path, grid: dict, faces, alpha: float, precision: str, diff_source=None,
             tag: str = "") -> tuple[np.ndarray, dict]:
    """IRs [Nr, n] at 48 kHz, processed like the app, plus run info."""
    from pffdtd_backend.engine import run_engine
    from pffdtd_backend.materials import material_def_file
    from pffdtd_backend.outputs import read_receivers
    from pffdtd_backend.postprocess import to_ir
    from pffdtd_backend.sim_prepare import SimSpec, prepare
    from pffdtd_backend.validation.scenes import box_scene

    dims = np.asarray(grid["dims"])
    h, _ = aligned_spacing(dims, PFFDTD_SPEED_OF_SOUND / (grid["fmax"] * grid["ppw"]))
    mats = {}
    face_materials = None
    if alpha > 0:
        mats = {"absorber": str(material_def_file([alpha] * len(MAT_BANDS), MAT_BANDS, OUT_ROOT / "materials"))}
        face_materials = {f: "absorber" for f in faces}
    scene = box_scene(dims, [tuple(dims * SRC_FRAC)], [tuple(dims * np.asarray(r)) for r in RCV_FRACS],
                      face_materials=face_materials)
    spec = SimSpec(sim_dir=case_dir / f"sim_{tag or precision}", scene=scene, duration=grid["duration"], h=h,
                   fcc=False, precision=precision, mat_files=mats, diff_source=diff_source,
                   Tc=PFFDTD_TEMPERATURE_C, rh=PFFDTD_RELATIVE_HUMIDITY)
    prep = prepare(spec)
    runtime = run_engine(prep.gpu_dir, precision)
    r_out, Ts = read_receivers(prep.gpu_dir)
    irs = to_ir(r_out, Ts, fmax=grid["fmax"], out_fs=AUDIO_SAMPLE_RATE, duration=grid["duration"],
                lowcut_hz=PFFDTD_LOWCUT_HZ, lowcut_order=PFFDTD_LOWCUT_ORDER, lowpass_order=PFFDTD_LOWPASS_ORDER,
                air_absorption=False, Tc=PFFDTD_TEMPERATURE_C, rh=PFFDTD_RELATIVE_HUMIDITY)
    info = {"h": float(h), "shape": list(map(int, prep.shape)), "nodes": int(np.prod(prep.shape)), "steps": int(prep.Nt),
            "Ts": float(Ts), "gpu_runtime_s": float(runtime)}
    shutil.rmtree(spec.sim_dir, ignore_errors=True)   # the setup/GPU files are large; the IRs are kept
    return irs, info


# ---------------------------------------------------------------- metrics

def bands_for(fmax: float) -> list[float]:
    return [fc for fc in BANDS_HZ if fc * math.sqrt(2.0) <= fmax and fc / math.sqrt(2.0) > PFFDTD_LOWCUT_HZ * 2]


def band(x: np.ndarray, fc: float, fs: float) -> np.ndarray:
    sos = butter(4, [fc / math.sqrt(2.0), fc * math.sqrt(2.0)], btype="band", fs=fs, output="sos")
    return sosfilt(sos, x)


def edc_db(x: np.ndarray) -> np.ndarray:
    e = np.cumsum((x ** 2)[::-1])[::-1]
    return 10.0 * np.log10(np.maximum(e / e[0], 1e-300))


def decay_time(edc: np.ndarray, fs: float, hi: float, lo: float) -> float | None:
    """RT60 from a line fit of the EDC between hi and lo dB (None if the EDC does not reach lo)."""
    idx = np.nonzero((edc <= hi) & (edc >= lo))[0]
    if idx.size < 10 or edc.min() > lo:
        return None
    t = idx / fs
    slope = np.polyfit(t, edc[idx], 1)[0]
    return -60.0 / slope if slope < 0 else None


def c80_db(x: np.ndarray, fs: float, t_direct: float) -> float:
    n0 = max(int(round(t_direct * fs)) - int(0.002 * fs), 0)
    n80 = n0 + int(round(0.080 * fs))
    early = float(np.sum(x[n0:n80] ** 2))
    late = float(np.sum(x[n80:] ** 2))
    return 10.0 * math.log10(early / late) if late > 0 and early > 0 else float("nan")


def rel_pct(a, b):
    if a is None or b is None:
        return None
    return 100.0 * abs(a - b) / b


def frames_db(x: np.ndarray, fs: float) -> np.ndarray:
    fr = int(round(FRAME_S * fs))
    n = x.size // fr
    return 10.0 * np.log10(np.mean(x[: n * fr].reshape(n, fr) ** 2, axis=1) + 1e-300)


def drift_db(s: np.ndarray, d: np.ndarray, fs: float, extra_hp: bool) -> float:
    """Error power below DRIFT_HZ re the IR's peak power (dB)."""
    e = s - d
    if extra_hp:
        e = sosfilt(butter(4, EXTRA_HP_HZ, btype="high", fs=fs, output="sos"), e)
    E = np.fft.rfft(e)
    f = np.fft.rfftfreq(e.size, 1.0 / fs)
    p_lf = np.sum(np.abs(E[f < DRIFT_HZ]) ** 2) / e.size ** 2 * 2
    return 10.0 * math.log10(p_lf / float(np.max(d ** 2)) + 1e-300)


def compare(ir_s: np.ndarray, ir_d: np.ndarray, fs: float, fmax: float, t_direct: list[float]) -> dict:
    """Single vs double over every window and band; worst value over the receivers."""
    out = {}
    k0 = int(round(FLOOR_FROM_S / FRAME_S))
    for w in WINDOWS_S:
        n = int(round(w * fs))
        if n > ir_d.shape[-1]:
            continue
        worst = {"band_db": 0.0, "edc_db": 0.0, "t30_pct": 0.0, "edt_pct": 0.0, "c80_db": 0.0, "floor_db": -np.inf,
                 "early_db": -np.inf, "late1s_db": None,
                 "ir_diff_db": -np.inf, "drift_db": -np.inf, "drift_hp20_db": -np.inf}
        per_band = {}
        for r in range(ir_d.shape[0]):
            s, d = ir_s[r, :n], ir_d[r, :n]
            worst["ir_diff_db"] = max(worst["ir_diff_db"], 10.0 * math.log10(np.sum((s - d) ** 2) / np.sum(d ** 2) + 1e-300))
            worst["drift_db"] = max(worst["drift_db"], drift_db(s, d, fs, False))
            worst["drift_hp20_db"] = max(worst["drift_hp20_db"], drift_db(s, d, fs, True))
            for fc in bands_for(fmax):
                bs, bd = band(s, fc, fs), band(d, fc, fs)
                ldiff = abs(10.0 * math.log10(np.sum(bs ** 2) / np.sum(bd ** 2)))
                g = float(np.dot(bs, bd) / np.dot(bd, bd))          # coherent gain (harmless) removed
                es, ed = edc_db(bs), edc_db(bd)
                m = ed >= EDC_FLOOR_DB
                edc_dev = float(np.max(np.abs(es[m] - ed[m]))) if m.any() else 0.0
                t30_d, t30_s = decay_time(ed, fs, -5, -35), decay_time(es, fs, -5, -35)
                edt_d, edt_s = decay_time(ed, fs, 0, -10), decay_time(es, fs, 0, -10)
                c80 = abs(c80_db(bs, fs, t_direct[r]) - c80_db(bd, fs, t_direct[r]))
                t30p, edtp = rel_pct(t30_s, t30_d), rel_pct(edt_s, edt_d)
                if t30_d is not None and t30_d > w:     # the window ends before the decay: truncation artefact
                    t30p = None
                n0 = max(int(round(t_direct[r] * fs)) - int(0.002 * fs), 0)
                n1 = n0 + int(round(EARLY_S * fs))
                ge = float(np.dot(bs[n0:n1], bd[n0:n1]) / np.dot(bd[n0:n1], bd[n0:n1]))
                early = 10.0 * math.log10(np.sum((bs[n0:n1] - ge * bd[n0:n1]) ** 2) / np.sum(bd[n0:n1] ** 2) + 1e-300)
                k1 = int(round(1.0 / FRAME_S))
                late1 = float(frames_db(bs - g * bd, fs)[k1] - frames_db(bd, fs)[k1]) if n >= int(1.2 * fs) else None
                fe, fd = frames_db(bs - g * bd, fs), frames_db(bd, fs)
                floor = float(fe[k0:].max() - fd.max()) if fe.size > k0 else -np.inf
                worst["band_db"] = max(worst["band_db"], ldiff)
                worst["edc_db"] = max(worst["edc_db"], edc_dev)
                worst["t30_pct"] = max(worst["t30_pct"], t30p or 0.0)
                worst["edt_pct"] = max(worst["edt_pct"], edtp or 0.0)
                worst["c80_db"] = max(worst["c80_db"], c80 if np.isfinite(c80) else 0.0)
                worst["floor_db"] = max(worst["floor_db"], floor)
                worst["early_db"] = max(worst["early_db"], early)
                if late1 is not None:
                    worst["late1s_db"] = late1 if worst["late1s_db"] is None else max(worst["late1s_db"], late1)
                pb = per_band.setdefault(f"{fc:g}", {"band_db": 0.0, "edc_db": 0.0, "t30_pct": 0.0, "floor_db": -np.inf})
                pb["band_db"] = max(pb["band_db"], ldiff)
                pb["edc_db"] = max(pb["edc_db"], edc_dev)
                pb["t30_pct"] = max(pb["t30_pct"], t30p or 0.0)
                pb["floor_db"] = max(pb["floor_db"], floor)
        worst["pass"] = bool(worst["band_db"] <= TOL_BAND_DB and worst["t30_pct"] <= TOL_RT_PCT
                             and worst["edt_pct"] <= TOL_RT_PCT and worst["c80_db"] <= TOL_C80_DB
                             and worst["early_db"] <= TOL_EARLY_DB)
        worst["bands"] = per_band
        out[f"{w:g}"] = worst
    return out


def schroeder_rt(ir_d: np.ndarray, fs: float, fmax: float) -> dict:
    """T30 (T20 when the EDC is too short) per band from Schroeder integration of the double IRs,
    mean over the receivers; 'broadband' = mean over the bands."""
    res = {}
    for fc in bands_for(fmax):
        vals = []
        for r in range(ir_d.shape[0]):
            e = edc_db(band(ir_d[r], fc, fs))
            v = decay_time(e, fs, -5, -35) or decay_time(e, fs, -5, -25)
            if v is not None:
                vals.append(v)
        res[f"{fc:g}"] = float(np.mean(vals)) if vals else None
    good = [v for v in res.values() if v is not None]
    res["broadband"] = float(np.mean(good)) if good else None
    return res


# ---------------------------------------------------------------- driver

def run_case(grid_name: str, layout: str, rt_target: float | None, force: bool = False, simulate_missing: bool = True):
    """Simulates double and every variant unless cached, then analyses. None if nothing is cached and not simulating."""
    grid = GRIDS[grid_name]
    faces = LAYOUTS[layout]
    tag = "rigid" if rt_target is None else f"rt{rt_target:g}"
    case_dir = OUT_ROOT / grid_name / layout / tag
    irs_file, run_file = case_dir / "irs.npz", case_dir / "run.json"
    alpha = 0.0 if rt_target is None else eyring_alpha(grid["dims"], faces, rt_target)
    irs = dict(np.load(irs_file)) if irs_file.exists() and not force else {}
    run = json.loads(run_file.read_text(encoding="utf-8")) if run_file.exists() and not force else {}
    missing = [k for k in ["double", *VARIANTS] if k not in irs or k not in run]
    if missing:
        if not simulate_missing:
            if "double" not in irs:
                return None
        else:
            case_dir.mkdir(parents=True, exist_ok=True)
            for k in missing:
                prec = "double" if k == "double" else "single"
                ir, info = simulate(case_dir, grid, faces, alpha, prec, None if k == "double" else VARIANTS[k], tag=k)
                irs[k], run[k] = ir.astype(np.float64), info
                np.savez_compressed(irs_file, **{**{n: v for n, v in irs.items() if n != "fs"}, "fs": AUDIO_SAMPLE_RATE})
                run_file.write_text(json.dumps(run), encoding="utf-8")
    dims = np.asarray(grid["dims"])
    src = dims * SRC_FRAC
    t_direct = [float(np.linalg.norm(dims * np.asarray(r) - src) / PFFDTD_SPEED_OF_SOUND) for r in RCV_FRACS]
    result = {
        "grid": grid_name, "layout": layout, "rt_target_eyring_s": rt_target, "alpha": alpha,
        "rt_eyring_s": None if alpha == 0 else eyring_rt(grid["dims"], faces, alpha),
        "rt_schroeder_s": schroeder_rt(irs["double"], AUDIO_SAMPLE_RATE, grid["fmax"]),
        "double": run["double"],
        "variants": {k: {"run": run[k], "windows": compare(irs[k], irs["double"], AUDIO_SAMPLE_RATE, grid["fmax"], t_direct)}
                     for k in VARIANTS if k in irs and k in run},
    }
    (case_dir / "result.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    return result


def summary_line(r: dict) -> str:
    rt = r["rt_schroeder_s"]["broadband"]
    head = (f"{r['grid']:7s} {r['layout']:10s} target {str(r['rt_target_eyring_s']):>5s} alpha {r['alpha']:.3f} "
            f"T30(Schroeder) {('%.2f' % rt) if rt else '  n/a'} s | GPU double {r['double']['gpu_runtime_s']:.0f}s")
    lines = [head]
    for k, v in r["variants"].items():
        ws = " ".join(
            f"{w}s:{'ok' if x['pass'] else 'FAIL'}(L{x['band_db']:.3f} E{x['edc_db']:.2f} T{x['t30_pct']:.2f}% "
            f"C{x['c80_db']:.3f} e{x['early_db']:.0f})" for w, x in v["windows"].items())
        lines.append(f"    {k:10s} GPU {v['run']['gpu_runtime_s']:.0f}s | {ws}")
    return "\n".join(lines)


def report() -> str:
    lines = ["# Single vs double precision PFFDTD vs reverberation time", ""]
    lines.append(f"Pass: band level <= {TOL_BAND_DB} dB, decay curve <= {TOL_EDC_DB} dB (to {EDC_FLOOR_DB:g} dB), "
                 f"T30/EDT <= {TOL_RT_PCT} %, C80 <= {TOL_C80_DB} dB, early {EARLY_S * 1e3:g} ms waveform error <= {TOL_EARLY_DB:g} dB "
                 f"(worst receiver and octave band). Cells: L band level (dB), T T30, D EDT, C C80 (dB), e early error (dB). "
                 f"T30 is not compared in a window shorter than the T30.")
    lines.append("")
    for grid_name, grid in GRIDS.items():
        for layout in LAYOUTS:
            rows = []
            for d in sorted(p for p in (OUT_ROOT / grid_name / layout).glob("*") if p.is_dir()):
                rt = None if d.name == "rigid" else float(d.name[2:])
                r = run_case(grid_name, layout, rt, simulate_missing=False)
                if r is not None:
                    rows.append(r)
            if not rows:
                continue
            rows.sort(key=lambda r: math.inf if r["rt_target_eyring_s"] is None else r["rt_target_eyring_s"])
            g = rows[0]["double"]
            for k in VARIANTS:
                vrows = [r for r in rows if k in r["variants"]]
                if not vrows:
                    continue
                lines.append(f"## {grid_name} grid ({grid['dims']} m, fmax {grid['fmax']:g} Hz, PPW {grid['ppw']:g}, "
                             f"h = {g['h'] * 1e3:.1f} mm, {g['nodes'] / 1e6:.1f} M nodes, {1 / g['Ts']:.0f} steps/s), "
                             f"{layout}, {k}")
                lines.append("")
                wins = list(vrows[0]["variants"][k]["windows"].keys())
                lines.append("| Eyring RT (s) | alpha | T30 Schroeder (s) | " + " | ".join(f"{w} s window" for w in wins)
                             + " | tail error at 1 s, dB re signal | error floor, dB re band peak | drift <10 Hz (app / +20 Hz HP), dB re peak | GPU s (double / single) |")
                lines.append("|---" * (7 + len(wins)) + "|")
                for r in vrows:
                    v = r["variants"][k]
                    rt = r["rt_schroeder_s"]["broadband"]
                    cells = []
                    for w in wins:
                        x = v["windows"].get(w)
                        cells.append("" if x is None else
                                     f"{'ok' if x['pass'] else '**FAIL**'} L{x['band_db']:.2f} T{x['t30_pct']:.1f}% "
                                     f"D{x['edt_pct']:.1f}% C{x['c80_db']:.2f} e{x['early_db']:.0f}")
                    ey = "rigid" if r["alpha"] == 0 else f"{r['rt_eyring_s']:.2f}"
                    last = v["windows"][wins[-1]]
                    lines.append(f"| {ey} | {r['alpha']:.3f} | {('%.2f' % rt) if rt else 'n/a'} | " + " | ".join(cells)
                                 + f" | {last['late1s_db']:.0f}" + f" | {last['floor_db']:.0f}"
                                 + f" | {last['drift_db']:.0f} / {last['drift_hp20_db']:.0f}"
                                 + f" | {r['double']['gpu_runtime_s']:.0f} / {v['run']['gpu_runtime_s']:.0f} |")
                lines.append("")
    text = "\n".join(lines)
    (OUT_ROOT / "REPORT.md").write_text(text, encoding="utf-8")
    return text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid", choices=list(GRIDS), action="append")
    ap.add_argument("--layout", choices=list(LAYOUTS), action="append")
    ap.add_argument("--rt", type=float, action="append", help="Eyring RT targets (default: the sweep + rigid)")
    ap.add_argument("--no-rigid", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    if a.report:
        print(report())
        return
    rts = a.rt or RT_TARGETS
    targets = list(rts) + ([] if a.no_rigid else [None])
    for grid_name in a.grid or ["default"]:
        for layout in a.layout or list(LAYOUTS):
            for rt in targets:
                if rt is None and layout != "uniform":
                    continue   # the rigid room is the same for every layout
                r = run_case(grid_name, layout, rt, force=a.force)
                print(summary_line(r), flush=True)
    print(report())


if __name__ == "__main__":
    main()
