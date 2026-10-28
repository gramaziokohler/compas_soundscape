"""Render a BRAS wave-animation bundle (``animation/wave_*.npz``) to a GIF and/or an MP4.

Left: the pressure field on the plane (plate walls, loudspeaker, microphones), with the grid-edge
echoes removed (bundle format 2). Right, one above the other: the highlighted pair's measured and
simulated impulse responses (band-limited to the run's fmax, the simulated one with the
loudspeaker's phase, each normalised to its peak) with a cursor at the frame time.

    python tests/benchmarks/bras/bras_render.py <bundle.npz> [--format gif|mp4|both] [--fps 20]

(from backend/, compas-toy python). MP4 needs ffmpeg on PATH; GIF uses Pillow.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

_TESTS = Path(__file__).resolve().parents[2]   # backend/tests
for _p in (str(_TESTS.parent), str(_TESTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.animation import FFMpegWriter, FuncAnimation, PillowWriter  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, ListedColormap  # noqa: E402

from benchmarks.bras import bras_constants as K  # noqa: E402
from benchmarks.bras.bras_animation import load_bundle  # noqa: E402
from benchmarks.bras.bras_plots import STYLE, _style_axes  # noqa: E402
from benchmarks.bras.bras_signal import bandlimit_like_sim  # noqa: E402

DEFAULT_FPS = K.ANIMATION_FPS
DEFAULT_DPI = K.ANIMATION_DPI  # MP4
DEFAULT_GIF_DPI = 60        # GIFs store every frame as a palette image: keep them light
DEFAULT_CLIP = 0.5          # colour limits, as a fraction of the bundle's vmax
FIELD_WIDTH_IN = 6.0
IR_WIDTH_IN = 4.2
IR_PANELS = (("measured", "Measured", "measured"), ("simulated", "Simulated (PFFDTD)", "simulated"))
OUTSIDE_GRAY = "#d8d7d2"


def _simulated_with_phase(bundle: dict) -> tuple[float, np.ndarray]:
    """The bundle's simulated IR (it carries the loudspeaker phase when ``sim_source_phase``)."""
    return float(bundle["fs_simulated"]), np.asarray(bundle["ir_simulated"], np.float64)


def ir_traces(bundle: dict, t_max_s: float) -> list[tuple[str, str, np.ndarray, np.ndarray]]:
    """(label, colour key, t, IR / peak) for the measured and the simulated IR, up to ``t_max_s``."""
    fmax = float(bundle["fmax"])
    out = []
    for name, label, colour in IR_PANELS:
        if f"ir_{name}" not in bundle:
            continue
        if name == "simulated":
            fs, ir = _simulated_with_phase(bundle)
        else:
            fs, ir = float(bundle[f"fs_{name}"]), bandlimit_like_sim(np.asarray(bundle[f"ir_{name}"], np.float64),
                                                                     float(bundle[f"fs_{name}"]), fmax)
        n = min(len(ir), int(np.ceil(t_max_s * fs)) + 1)
        ir = ir[:n]
        out.append((label, colour, np.arange(n) / fs, ir / (float(np.abs(ir).max()) or 1.0)))
    return out


def _field_axes(ax, bundle: dict, clip: float):
    frames, x, y, mask = bundle["frames"], bundle["x"], bundle["y"], bundle["mask"]
    extent = (x[0], x[-1], y[0], y[-1])
    cmap = LinearSegmentedColormap.from_list("div", [STYLE["div_neg"], STYLE["div_mid"], STYLE["div_pos"]])
    img = ax.imshow(frames[0].astype(np.float32) / 127.0, origin="lower", extent=extent, cmap=cmap,
                    vmin=-clip, vmax=clip, interpolation="bilinear", animated=True)
    ax.imshow(np.ma.masked_where(mask != 2, mask), origin="lower", extent=extent,
              cmap=ListedColormap([OUTSIDE_GRAY]), interpolation="nearest")
    ax.imshow(np.ma.masked_where(mask != 1, mask), origin="lower", extent=extent,
              cmap=ListedColormap([STYLE["ink"]]), interpolation="nearest")
    src, rcv = bundle["source_position"], bundle["receiver_positions"]
    hl = list(bundle["receiver_ids"]).index(str(bundle["highlight_receiver"]))
    ax.plot(src[0], src[1], "^", color=STYLE["ink"], ms=9, label=f"Loudspeaker {bundle['source_id']}")
    others = [i for i in range(len(rcv)) if i != hl]
    if others:
        ax.plot(rcv[others, 0], rcv[others, 1], "o", mfc="none", mec=STYLE["ink2"], ms=7, label="Other microphones")
    ax.plot(rcv[hl, 0], rcv[hl, 1], "o", color=STYLE["ink"], ms=8, label=f"Microphone {bundle['highlight_receiver']}")
    ax.set_xlabel("x (m)")
    ax.set_ylabel("y (m)")
    ax.legend(fontsize=7, frameon=False, loc="upper left")
    _style_axes(ax)
    ax.grid(False)
    return img


def build_animation(bundle: dict, fps: int = DEFAULT_FPS, clip: float = DEFAULT_CLIP, with_irs: bool = True):
    frames, times_ms = bundle["frames"], bundle["times_ms"]
    x, y = bundle["x"], bundle["y"]
    height = FIELD_WIDTH_IN * float(np.ptp(y) / np.ptp(x)) + 0.8
    if with_irs:
        fig = plt.figure(figsize=(FIELD_WIDTH_IN + IR_WIDTH_IN, height), facecolor=STYLE["surface"])
        grid = fig.add_gridspec(2, 2, width_ratios=[FIELD_WIDTH_IN, IR_WIDTH_IN])
        ax = fig.add_subplot(grid[:, 0])
        ir_axes = [fig.add_subplot(grid[0, 1])]
        ir_axes.append(fig.add_subplot(grid[1, 1], sharex=ir_axes[0]))
    else:
        fig, ax = plt.subplots(figsize=(FIELD_WIDTH_IN, height), facecolor=STYLE["surface"])
        ir_axes = []
    img = _field_axes(ax, bundle, clip)
    title = ax.set_title("", fontsize=10, color=STYLE["ink"])

    cursors = []
    t_end = float(times_ms[-1]) * 1e-3
    for a, (label, colour, t, ir) in zip(ir_axes, ir_traces(bundle, t_end) if with_irs else []):
        a.plot(t * 1e3, ir, color=STYLE[colour], lw=1.2)
        a.axhline(0.0, color=STYLE["axis"], lw=0.6)
        a.set_title(f"{label}: {bundle['source_id']} to {bundle['highlight_receiver']}", fontsize=9)
        a.set_ylabel("IR re peak")
        a.set_ylim(-1.1, 1.1)
        a.set_xlim(0.0, t_end * 1e3)
        _style_axes(a)
        cursors.append(a.axvline(float(times_ms[0]), color=STYLE["ink"], lw=1.0, animated=True))
    if ir_axes:
        ir_axes[0].tick_params(labelbottom=False)
        ir_axes[-1].set_xlabel("Time since emission (ms)")
    label = str(bundle.get("scene_label", "BRAS"))
    fig.suptitle(f"{label}: omni pulse, fmax {float(bundle['fmax']):g} Hz, plane z = {float(bundle['z']):.2f} m",
                 fontsize=11, color=STYLE["ink"])
    fig.tight_layout()

    def update(k: int):
        img.set_data(frames[k].astype(np.float32) / 127.0)
        title.set_text(f"t = {times_ms[k]:5.1f} ms")
        for cur in cursors:
            cur.set_xdata([times_ms[k], times_ms[k]])
        return (img, title, *cursors)

    anim = FuncAnimation(fig, update, frames=frames.shape[0], interval=1000.0 / fps, blit=True)
    return fig, anim


def render(bundle_path: Path, fmt: str = "both", fps: int = DEFAULT_FPS, dpi: int = DEFAULT_DPI,
           clip: float = DEFAULT_CLIP, with_irs: bool = True, out_stem: Path | None = None,
           gif_dpi: int = DEFAULT_GIF_DPI) -> list[Path]:
    bundle = load_bundle(bundle_path)
    if not bool(bundle.get("edge_echoes_removed", False)):
        print("this bundle predates edge-echo removal: re-run the benchmark (or delete the bundle) to regenerate it",
              file=sys.stderr)
    # not with_suffix: the bundle name carries the plane height ("wave_LS1_z1.02.npz")
    stem = Path(out_stem) if out_stem else Path(bundle_path).parent / Path(bundle_path).name.removesuffix(".npz")
    formats = ["gif", "mp4"] if fmt == "both" else [fmt]
    written = []
    for f in formats:
        if f == "mp4" and shutil.which("ffmpeg") is None:
            print("ffmpeg not on PATH: skipping the MP4", file=sys.stderr)
            continue
        fig, anim = build_animation(bundle, fps, clip, with_irs)
        # yuv420p (plays everywhere) needs even frame sizes: pad by at most one pixel
        pad = f"pad=ceil(iw/2)*2:ceil(ih/2)*2:color=0x{STYLE['surface'].lstrip('#')}"
        writer = PillowWriter(fps=fps) if f == "gif" else FFMpegWriter(
            fps=fps, codec="libx264", extra_args=["-vf", pad, "-pix_fmt", "yuv420p"])
        path = stem.parent / f"{stem.name}.{f}"
        anim.save(str(path), writer=writer, dpi=gif_dpi if f == "gif" else dpi,
                  savefig_kwargs={"facecolor": STYLE["surface"]})
        plt.close(fig)
        written.append(path)
        print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB, {bundle['frames'].shape[0]} frames at {fps} fps)")
    return written


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bundle", type=Path, help="animation/wave_<LS>_z<z>.npz of a benchmark run")
    ap.add_argument("--format", default="both", choices=("gif", "mp4", "both"))
    ap.add_argument("--fps", type=int, default=DEFAULT_FPS)
    ap.add_argument("--dpi", type=int, default=DEFAULT_DPI, help="MP4 resolution")
    ap.add_argument("--gif-dpi", type=int, default=DEFAULT_GIF_DPI, help="GIF resolution")
    ap.add_argument("--clip", type=float, default=DEFAULT_CLIP, help="colour limits as a fraction of vmax")
    ap.add_argument("--no-irs", action="store_true", help="field only, without the IR panels")
    ap.add_argument("--out", type=Path, default=None, help="output path without extension (default: next to the bundle)")
    args = ap.parse_args(argv)
    render(args.bundle, args.format, args.fps, args.dpi, args.clip, not args.no_irs, args.out, args.gif_dpi)
    return 0


if __name__ == "__main__":
    sys.exit(main())
