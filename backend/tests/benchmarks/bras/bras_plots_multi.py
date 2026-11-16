"""Figures with several engines, each compared in its own band (bras_final).

An engine is ``{"label", "color", "band": (lo, hi), "results": [PairResult], "average": dict | None}``.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from benchmarks.bras.bras_plots import (BAR_W, DPI, LINE_W, STYLE, _band_labels, _freq_axis, _heatmap,  # noqa: E402
                                        _save, _style_axes)

ENGINE_COLORS = ("#eb6834", "#8a63d2", "#1baf7a", "#c9a227")   # PFFDTD, then the geometric-acoustics variants
TICKS_HZ = (63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)
RESPONSE_RANGE_DB = 40.0


def _freq_axis_wide(ax, fmin: float, fmax: float) -> None:
    _freq_axis(ax, fmin, fmax)
    ticks = [t for t in TICKS_HZ if fmin <= t <= fmax]
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{t / 1000:g}k" if t >= 1000 else str(t) for t in ticks])


def _band_spans(ax, engines: list) -> None:
    """Each engine's compared band, a thin bar in its colour at the bottom of the axes."""
    for i, e in enumerate(engines):
        ax.axvspan(*e["band"], ymin=0.012 * i, ymax=0.012 * (i + 1), color=e["color"], alpha=0.8, lw=0)


def _narrow_measured(ax, curves: list, wide: dict) -> None:
    """The measured response low-passed like a narrower engine (PFFDTD at its fmax), dashed: that engine's
    curve falls off with the same filter near its band's top, and its dL is taken against this one."""
    for hi in sorted({e["band"][1] for e, c in curves if c is not wide}):
        c = next(c for e, c in curves if e["band"][1] == hi)
        if c["f"][-1] < wide["f"][-1]:
            ax.plot(c["f"], c["meas_db"], color=STYLE["measured"], lw=0.9, ls="--",
                    label=f"Measured, low-passed at {hi / 1000:g} kHz")


def _multi_bars(ax, bands: list, values: list, engines: list, errors: list | None = None) -> None:
    """Bars per band, one per engine (``values``: {band: dB} or None); no value in a band leaves a gap."""
    x = np.arange(len(bands))
    n = len(engines)
    w = BAR_W / n
    for i, (e, vals) in enumerate(zip(engines, values)):
        if vals is None:
            continue
        pos = x - BAR_W / 2 + w * (i + 0.5)
        y = np.array([vals.get(b, np.nan) for b in bands], float)
        ax.bar(pos, y, w - 0.02, color=e["color"], label=e["label"])
        if errors is not None and errors[i] is not None:
            lo = np.array([errors[i][0].get(b, np.nan) for b in bands], float)
            hi = np.array([errors[i][1].get(b, np.nan) for b in bands], float)
            ok = np.isfinite(y)
            ax.errorbar(pos[ok], y[ok], yerr=[y[ok] - lo[ok], hi[ok] - y[ok]], fmt="none", ecolor=STYLE["ink2"],
                        elinewidth=0.8, capsize=2)
    ax.axhline(0.0, color=STYLE["axis"], lw=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels(_band_labels(bands), rotation=45)
    ax.set_xlabel("Band centre (Hz)")
    ax.set_ylabel("Simulated - measured (dB)")
    ax.legend(fontsize=7, frameon=False, ncol=n)


def plot_pair_multi(key: str, engines: list, smoothing: int, path: Path, scene_label: str) -> Path:
    """One pair, every engine: the gated IRs (top: PFFDTD with the measured IR in its band, then the
    broadband engines with the measured IR in theirs), the responses and the level difference per band."""
    res = [{r.key: r for r in e["results"]}.get(key) for e in engines]
    have = [(e, r) for e, r in zip(engines, res) if r is not None]
    first = have[0][1]
    bands_hi = sorted({e["band"][1] for e, _ in have})
    groups = [[(e, r) for e, r in have if e["band"][1] == hi] for hi in bands_hi]   # one IR panel per low-pass
    ng = len(groups)
    fig = plt.figure(figsize=(7.5 * max(ng, 2), 8.0), facecolor=STYLE["surface"])
    gs = fig.add_gridspec(2, 2 * ng)
    top = [fig.add_subplot(gs[0, 2 * i:2 * i + 2]) for i in range(ng)]
    bottom = [fig.add_subplot(gs[1, :ng]), fig.add_subplot(gs[1, ng:])]
    axes = np.array(top + bottom, dtype=object)
    for ax, group in zip(top, groups):
        ref = group[0][1].curves
        ax.plot(ref["t"] * 1e3, ref["meas_ir"], color=STYLE["measured"], lw=LINE_W, label="Measured")
        for e, r in group:
            ax.plot(r.curves["t"] * 1e3, r.curves["sim_ir"], color=e["color"], lw=1.1, label=e["label"])
        lo, hi = group[0][0]["band"]
        ax.set_xlabel("Time since emission (ms)")
        ax.set_ylabel("Pressure (Pa, band-limited)")
        ax.set_title(f"Gated IRs, low-passed at {hi / 1000:g} kHz", fontsize=10)
        ax.legend(fontsize=7, frameon=False, loc="upper right")
    a3, a4 = bottom
    ref = max(have, key=lambda er: er[0]["band"][1])[1].curves
    a3.plot(ref["f"], ref["meas_db"], color=STYLE["measured"], lw=LINE_W, label="Measured")
    _narrow_measured(a3, [(e, r.curves) for e, r in have], ref)
    for e, r in have:
        a3.plot(r.curves["f"], r.curves["sim_db"], color=e["color"], lw=1.1, label=f"{e['label']} ({r.mean_abs_dl_db:.1f} dB)")
    top = float(np.nanmax(ref["meas_db"]))
    a3.set_ylim(top - RESPONSE_RANGE_DB, top + 6.0)
    _band_spans(a3, [e for e, _ in have])
    _freq_axis_wide(a3, float(ref["f"][0]), max(e["band"][1] for e, _ in have))
    a3.set_ylabel("|H| (dB)")
    a3.set_title(f"Frequency response (1/{smoothing} oct); legend: mean |dL| in the engine's band", fontsize=10)
    a3.legend(fontsize=7, frameon=False, loc="lower left")
    bands = sorted({b for _, r in have for b in r.bands_hz})
    _multi_bars(a4, bands, [None if r is None else dict(zip(r.bands_hz, r.dl_db)) for r in res], engines)
    a4.set_title("Level difference per band", fontsize=10)
    for ax in np.ravel(axes):
        if ax.axison:
            _style_axes(ax)
    los = "line of sight" if first.line_of_sight else "direct path blocked: diffraction only"
    fig.suptitle(f"{scene_label}: {key}, {first.distance_m:.2f} m, {los}", fontsize=11, color=STYLE["ink"])
    return _save(fig, path)


def plot_average_multi(engines: list, n_pairs: int, smoothing: int, path: Path, scene_label: str) -> Path:
    """Power average of the pairs' responses per engine, and the mean level difference per band
    (bars) with the min-to-max range over the pairs (whiskers)."""
    have = [e for e in engines if e.get("average")]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(17.0, 4.8), facecolor=STYLE["surface"],
                                 gridspec_kw={"width_ratios": [1.0, 1.5]})
    wide = max(have, key=lambda e: e["band"][1])["average"]
    a1.plot(wide["f"], wide["meas_db"], color=STYLE["measured"], lw=LINE_W, label="Measured")
    _narrow_measured(a1, [(e, e["average"]) for e in have], wide)
    for e in have:
        a1.plot(e["average"]["f"], e["average"]["sim_db"], color=e["color"], lw=1.1,
                label=f"{e['label']} ({e['average']['mean_abs_dl_db']:.1f} dB)")
    top = float(np.nanmax(wide["meas_db"]))
    a1.set_ylim(top - RESPONSE_RANGE_DB, top + 6.0)
    _band_spans(a1, have)
    _freq_axis_wide(a1, float(wide["f"][0]), max(e["band"][1] for e in have))
    a1.set_ylabel("|H| (dB)")
    a1.set_title(f"Average response of {n_pairs} pairs (1/{smoothing} oct); legend: mean |dL|", fontsize=10)
    a1.legend(fontsize=7, frameon=False, loc="lower left")
    bands = sorted({b for e in have for b in e["average"]["bands_hz"]})
    vals, errs = [], []
    for e in engines:
        a = e.get("average")
        vals.append(dict(zip(a["bands_hz"], a["dl_mean_db"])) if a else None)
        errs.append((dict(zip(a["bands_hz"], a["dl_min_db"])), dict(zip(a["bands_hz"], a["dl_max_db"]))) if a else None)
    _multi_bars(a2, bands, vals, engines, errs)
    a2.set_title("Mean level difference per band over the pairs (whiskers: min to max)", fontsize=10)
    for ax in (a1, a2):
        _style_axes(ax)
    fig.suptitle(scene_label, fontsize=11, color=STYLE["ink"])
    return _save(fig, path)


def plot_overview_multi(engines: list, keys: list, line_of_sight: dict, path: Path, scene_label: str) -> Path:
    """Pairs x bands heatmaps of the level difference, one per engine, on the same pairs and scale."""
    have = [e for e in engines if e["results"]]
    widths = [len(e["results"][0].bands_hz) for e in have]
    fig, axes = plt.subplots(1, len(have), figsize=(0.42 * sum(widths) + 2.0 * len(have) + 1.5, 0.3 * len(keys) + 2.2),
                             facecolor=STYLE["surface"], squeeze=False, sharey=True, gridspec_kw={"width_ratios": widths})
    im = None
    for ax, e in zip(axes[0], have):
        im = _heatmap(ax, e["results"], keys, e["label"])
    axes[0, 0].set_yticks(range(len(keys)))
    axes[0, 0].set_yticklabels([k + ("" if line_of_sight.get(k, True) else " (blocked)") for k in keys])
    fig.colorbar(im, ax=list(axes[0]), fraction=0.02, pad=0.01).ax.tick_params(labelsize=7)
    fig.suptitle(f"{scene_label}: simulated - measured per pair and band (dB)", fontsize=11, color=STYLE["ink"])
    fig.savefig(path, dpi=DPI, facecolor=STYLE["surface"], bbox_inches="tight")
    plt.close(fig)
    return path


def plot_summary(rows: list, engines: list, path: Path) -> Path:
    """Mean |dL| per scene and engine: all pairs, then the line-of-sight and the shadowed pairs.
    ``rows``: ``{"scene", "engines": {key: {"all", "los", "shadow"}}}``; ``engines``: ``[(key, name, color)]``."""
    fig, axes = plt.subplots(3, 1, figsize=(max(10.0, 1.1 * len(rows) + 3.0), 10.5), facecolor=STYLE["surface"], sharex=True)
    x = np.arange(len(rows))
    n = len(engines)
    w = BAR_W / n
    for ax, what, title in zip(axes, ("all", "los", "shadow"),
                               ("All pairs the engine has sound for", "Pairs with line of sight",
                                "Pairs without line of sight (diffraction only; no bar: no sound without diffraction)")):
        for i, (key, label, color) in enumerate(engines):
            y = np.array([(r["engines"].get(key) or {}).get(what, np.nan) for r in rows], float)
            pos = x - BAR_W / 2 + w * (i + 0.5)
            ax.bar(pos, y, w - 0.02, color=color, label=label)
            for p, v in zip(pos, y):
                if np.isfinite(v):
                    ax.text(p, v + 0.1, f"{v:.1f}", ha="center", va="bottom", fontsize=6, color=STYLE["ink2"])
        ax.set_ylabel("Mean |dL| (dB)")
        ax.set_title(title, fontsize=10)
        _style_axes(ax)
    axes[0].legend(fontsize=8, frameon=False, ncol=n)
    axes[-1].set_xticks(x)
    axes[-1].set_xticklabels([r["scene"] for r in rows], rotation=30, ha="right")
    fig.suptitle("BRAS reference scenes: mean |dL| per scene (each engine in its own band)", fontsize=11, color=STYLE["ink"])
    return _save(fig, path)
