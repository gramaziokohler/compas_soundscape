"""results.json + report.md of one benchmark (scene x fmax stage)."""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

from benchmarks.bras.bras_analysis import PairResult

REPORT_OCTAVES_HZ = [125, 250, 500, 1000, 2000, 4000]


def _jsonable(x):
    if isinstance(x, dict):
        return {str(k): _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonable(v) for v in x]
    if isinstance(x, np.ndarray):
        return x.tolist()
    if isinstance(x, (np.floating, np.integer)):
        return x.item()
    if isinstance(x, Path):
        return str(x)
    return x


def write_results(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_jsonable(payload), indent=2))
    return path


def _fmt(v, spec: str = "+.2f") -> str:
    return "-" if v is None else format(v, spec)


def _alpha_at(coeffs: dict, f: float) -> float:
    fc = np.asarray(coeffs["center_freqs"], np.float64)
    order = np.argsort(fc)
    return float(np.interp(np.log2(f), np.log2(fc[order]), np.asarray(coeffs["coeffs"], np.float64)[order]))


def _table(header: list, rows: list) -> list[str]:
    return ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)] + ["| " + " | ".join(r) + " |" for r in rows]


def report_markdown(info: dict, results: list[PairResult], avg: dict) -> str:
    s = info
    lines = [f"# {s['scene_label']}: PFFDTD vs measured, fmax {s['fmax_hz']:g} Hz", "",
             f"Scene `{s['scene']}`, generated {time.strftime('%Y-%m-%d %H:%M')}.", "", "## Inputs", ""]
    lines += _table(["Input", "File"], [[k, f"`{v}`"] for k, v in s["inputs"].items()])
    lines += ["", "Materials (absorption coefficient per octave band):", ""]
    head = ["Material", "Faces", "OBJ labels", "Source file"] + [f"{f:g} Hz" for f in REPORT_OCTAVES_HZ]
    rows = [[m["key"], str(m["faces"]), ", ".join(m["labels"]) or "-", m["file"]]
            + [f"{_alpha_at(m['coeffs'], f):.3f}" for f in REPORT_OCTAVES_HZ] for m in s["materials"]]
    lines += _table(head, rows)

    g = s["grid"]
    lines += ["", "## Setup", "",
              f"- Chamber: {s['chamber']}, {s['temperature_c']:g} degC, {s['humidity']:g} % RH "
              f"(speed of sound {s['c_measured']:.1f} m/s); {s['ground']}.",
              f"- Geometry: {s['n_faces']} triangles, objects bbox {s['bbox']}.",
              f"- Source: {s['source_model']}.",
              f"- Grid: h = {g['h'] * 1e3:.2f} mm ({g['ppw_effective']:.1f} points per wavelength at {s['fmax_hz']:g} Hz), "
              f"{g['shape']} = {g['nodes'] / 1e6:.0f} M nodes, domain {g['bmin']} to {g['bmax']} m "
              f"({s['padding_m']:g} m of free air around everything).",
              f"- Simulated IR length {s['duration_s'] * 1e3:.0f} ms, air absorption on; runtime {s['wall_s']:.0f} s.",
              f"- Comparison: {s['window']}; bands {s['band'][0]:g} to {s['band'][1]:g} Hz, "
              f"1/{s['bands_per_octave']} octave level differences, curves smoothed to 1/{s['smoothing']} octave.",
              f"- Level: one global gain of {s['gain_db']:+.2f} dB, fitted on the direct sound of {s['gain_pair']}.",
              "", "## Results", "",
              f"Mean |dL| over all pairs and bands: **{avg['mean_abs_dl_db']:.2f} dB** ({len(results)} pairs).", ""]
    rows = [[r.key, f"{r.distance_m:.2f}", "yes" if r.line_of_sight else "no", _fmt(r.offaxis_deg, ".0f"),
             f"{r.mean_abs_dl_db:.2f}", f"{r.max_abs_dl_db:.2f}", _fmt(r.direct_level_db)] for r in results]
    lines += _table(["Pair", "Distance (m)", "Line of sight", "Off-axis (deg)", "Mean abs dL (dB)",
                     "Max abs dL (dB)", "Direct level, sim - meas (dB)"], rows)
    lines += ["", "Per band (simulated - measured, dB):", ""]
    rows = [[f"{b:g}", f"{a:+.2f}", f"{m:+.2f}", f"{lo:+.2f}", f"{hi:+.2f}"] for b, a, m, lo, hi in
            zip(avg["bands_hz"], avg["dl_of_average_db"], avg["dl_mean_db"], avg["dl_min_db"], avg["dl_max_db"])]
    lines += _table(["Band (Hz)", "Average response", "Mean over pairs", "Min", "Max"], rows)
    lines += ["", "## Files", ""] + [f"- `{f}`" for f in s["files"]] + [""]
    return "\n".join(lines)


def write_report(path: Path, info: dict, results: list[PairResult], avg: dict) -> Path:
    path.write_text(report_markdown(info, results, avg), encoding="utf-8")
    return path
