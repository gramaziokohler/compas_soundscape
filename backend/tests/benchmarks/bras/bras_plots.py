"""Matplotlib (Agg) figures of a benchmark: measured vs simulated only."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from matplotlib.ticker import NullFormatter  # noqa: E402

from benchmarks.bras.bras_analysis import PairResult  # noqa: E402

# reference data-viz palette (fixed slot order) + chart chrome
STYLE = {
    "measured": "#2a78d6", "simulated": "#eb6834", "range": "#86b6ef",
    "ink": "#0b0b0b", "ink2": "#52514e", "muted": "#898781", "grid": "#e1e0d9", "axis": "#c3c2b7",
    "surface": "#fcfcfb", "band": "#f0efec", "div_neg": "#2a78d6", "div_mid": "#f0efec", "div_pos": "#e34948",
}
LINE_W = 1.5
DPI = 150
DL_LIMIT_DB = 6.0


def _style_axes(ax) -> None:
    ax.set_facecolor(STYLE["surface"])
    ax.grid(True, color=STYLE["grid"], linewidth=0.6)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(STYLE["axis"])
    ax.tick_params(colors=STYLE["ink2"], labelsize=8)
    ax.xaxis.label.set_color(STYLE["ink2"])
    ax.yaxis.label.set_color(STYLE["ink2"])
    ax.title.set_color(STYLE["ink"])


def _freq_axis(ax, fmin: float, fmax: float) -> None:
    ax.set_xscale("log")
    ax.set_xlim(fmin, fmax)
    ticks = [t for t in (63, 125, 250, 500, 1000, 2000, 4000, 8000) if fmin <= t <= fmax]
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{t / 1000:g}k" if t >= 1000 else str(t) for t in ticks])
    ax.xaxis.set_minor_formatter(NullFormatter())
    ax.set_xlabel("Frequency (Hz)")


def _band_labels(bands) -> list[str]:
    return [f"{b / 1000:g}k" if b >= 1000 else f"{b:g}" for b in bands]


def _save(fig, path: Path) -> Path:
    fig.tight_layout()
    fig.savefig(path, dpi=DPI, facecolor=STYLE["surface"])
    plt.close(fig)
    return path


def _response(ax, f, meas_db, sim_db, band, fmax: float, title: str) -> None:
    ax.axvspan(*band, color=STYLE["band"], zorder=0)
    ax.plot(f, meas_db, color=STYLE["measured"], lw=LINE_W, label="Measured")
    ax.plot(f, sim_db, color=STYLE["simulated"], lw=LINE_W, label="Simulated (PFFDTD)")
    top = float(np.nanmax(np.r_[meas_db, sim_db]))
    ax.set_ylim(top - 30.0, top + 5.0)
    _freq_axis(ax, float(f[0]), fmax)
    ax.set_ylabel("|H| (dB)")
    ax.set_title(title, fontsize=10)
    ax.legend(fontsize=7, frameon=False, loc="lower left")


def plot_pair(res: PairResult, band: tuple, fmax: float, smoothing: int, path: Path, scene_label: str) -> Path:
    """Gated IRs, frequency response and level difference per band of one pair."""
    c = res.curves
    fig, (a1, a2, a3) = plt.subplots(1, 3, figsize=(15.0, 3.8), facecolor=STYLE["surface"])
    t_ms = c["t"] * 1e3
    a1.plot(t_ms, c["meas_ir"], color=STYLE["measured"], lw=LINE_W, label="Measured")
    a1.plot(t_ms, c["sim_ir"], color=STYLE["simulated"], lw=LINE_W, label="Simulated (PFFDTD)")
    a1.set_xlabel("Time since emission (ms)")
    a1.set_ylabel("Pressure (Pa, band-limited)")
    los = "line of sight" if res.line_of_sight else "direct path blocked"
    a1.set_title(f"{res.key}, {res.distance_m:.2f} m, {los}", fontsize=10)
    a1.legend(fontsize=7, frameon=False, loc="upper right")
    _response(a2, c["f"], c["meas_db"], c["sim_db"], band, fmax,
              f"Frequency response (1/{smoothing} oct), mean |dL| {res.mean_abs_dl_db:.1f} dB")
    x = np.arange(len(res.bands_hz))
    a3.bar(x, res.dl_db, 0.7, color=STYLE["simulated"])
    a3.axhline(0.0, color=STYLE["axis"], lw=0.8)
    a3.set_xticks(x)
    a3.set_xticklabels(_band_labels(res.bands_hz), rotation=45)
    a3.set_xlabel("Band centre (Hz)")
    a3.set_ylabel("Simulated - measured (dB)")
    a3.set_title("Level difference per band", fontsize=10)
    for ax in (a1, a2, a3):
        _style_axes(ax)
    fig.suptitle(scene_label, fontsize=10, color=STYLE["ink2"])
    return _save(fig, path)


def plot_average(avg: dict, band: tuple, fmax: float, smoothing: int, n_pairs: int, path: Path, scene_label: str) -> Path:
    """Power average of the pairs' responses, and the per-band difference (mean, min-max range)."""
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12.0, 4.0), facecolor=STYLE["surface"])
    _response(a1, avg["f"], avg["meas_db"], avg["sim_db"], band, fmax,
              f"Average response of {n_pairs} pairs (1/{smoothing} oct)")
    x = np.arange(len(avg["bands_hz"]))
    mean, lo, hi = (np.asarray(avg[k]) for k in ("dl_mean_db", "dl_min_db", "dl_max_db"))
    a2.bar(x, mean, 0.7, color=STYLE["simulated"], label="Mean over pairs")
    a2.errorbar(x, mean, yerr=[mean - lo, hi - mean], fmt="none", ecolor=STYLE["ink2"], elinewidth=1.0,
                capsize=3, label="Min to max over pairs")
    a2.axhline(0.0, color=STYLE["axis"], lw=0.8)
    a2.set_xticks(x)
    a2.set_xticklabels(_band_labels(avg["bands_hz"]), rotation=45)
    a2.set_xlabel("Band centre (Hz)")
    a2.set_ylabel("Simulated - measured (dB)")
    a2.set_title(f"Level difference per band, mean |dL| {avg['mean_abs_dl_db']:.1f} dB", fontsize=10)
    a2.legend(fontsize=7, frameon=False)
    for ax in (a1, a2):
        _style_axes(ax)
    fig.suptitle(scene_label, fontsize=10, color=STYLE["ink2"])
    return _save(fig, path)


def plot_overview(results: list[PairResult], path: Path, scene_label: str) -> Path:
    """Pairs x bands heatmap of the level difference."""
    bands = results[0].bands_hz
    dl = np.array([r.dl_db for r in results])
    fig, ax = plt.subplots(figsize=(0.55 * len(bands) + 3.0, 0.32 * len(results) + 1.8), facecolor=STYLE["surface"])
    cmap = LinearSegmentedColormap.from_list("div", [STYLE["div_neg"], STYLE["div_mid"], STYLE["div_pos"]])
    im = ax.imshow(dl, cmap=cmap, vmin=-DL_LIMIT_DB, vmax=DL_LIMIT_DB, aspect="auto")
    for i in range(dl.shape[0]):
        for j in range(dl.shape[1]):
            ax.text(j, i, f"{dl[i, j]:.1f}", ha="center", va="center", fontsize=6, color=STYLE["ink"])
    ax.set_xticks(range(len(bands)))
    ax.set_xticklabels(_band_labels(bands), rotation=45)
    ax.set_yticks(range(len(results)))
    ax.set_yticklabels([r.key + ("" if r.line_of_sight else " (blocked)") for r in results])
    ax.set_xlabel("Band centre (Hz)")
    ax.set_title(f"{scene_label}: simulated - measured (dB)", fontsize=10)
    fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02).ax.tick_params(labelsize=7)
    _style_axes(ax)
    ax.grid(False)
    return _save(fig, path)


def plot_animation_preview(bundle: dict, path: Path, n_frames: int = 6) -> Path:
    """A few frames of the wave animation bundle (pressure, walls, loudspeaker, microphones)."""
    frames, vmax = bundle["frames"], float(bundle["vmax"])
    x, y, mask = bundle["x"], bundle["y"], bundle["mask"]
    picks = np.linspace(frames.shape[0] * 0.15, frames.shape[0] - 1, n_frames).astype(int)
    cols = 3
    rows = int(np.ceil(n_frames / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(4.2 * cols, 4.2 * rows * (np.ptp(y) / np.ptp(x))), facecolor=STYLE["surface"])
    cmap = LinearSegmentedColormap.from_list("div", [STYLE["div_neg"], STYLE["div_mid"], STYLE["div_pos"]])
    extent = (x[0], x[-1], y[0], y[-1])
    walls = np.ma.masked_where(mask != 1, mask)
    src, rcv = bundle["source_position"], bundle["receiver_positions"]
    hl = list(bundle["receiver_ids"]).index(str(bundle["highlight_receiver"]))
    for ax, k in zip(np.ravel(axes), picks):
        ax.imshow(frames[k].astype(np.float32) / 127.0, origin="lower", extent=extent, cmap=cmap,
                  vmin=-0.5, vmax=0.5, interpolation="bilinear")
        ax.imshow(walls, origin="lower", extent=extent, cmap=LinearSegmentedColormap.from_list("w", [STYLE["ink"]] * 2),
                  interpolation="nearest")
        ax.plot(src[0], src[1], "^", color=STYLE["ink"], ms=8, label=str(bundle["source_id"]))
        ax.plot(rcv[:, 0], rcv[:, 1], "o", mfc="none", mec=STYLE["ink2"], ms=6)
        ax.plot(rcv[hl, 0], rcv[hl, 1], "o", color=STYLE["ink"], ms=7, label=str(bundle["highlight_receiver"]))
        ax.set_title(f"t = {bundle['times_ms'][k]:.1f} ms", fontsize=9, color=STYLE["ink"])
        ax.set_xticks([])
        ax.set_yticks([])
    for ax in np.ravel(axes)[len(picks):]:
        ax.axis("off")
    np.ravel(axes)[0].legend(fontsize=7, frameon=False, loc="upper left")
    fig.suptitle(f"Omni pulse from {bundle['source_id']} at z = {float(bundle['z']):.2f} m, "
                 f"fmax {float(bundle['fmax']):g} Hz (pressure re vmax {vmax:.2g})", fontsize=10, color=STYLE["ink"])
    return _save(fig, path)
