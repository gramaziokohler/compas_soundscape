"""Run PFFDTD on an .obj room: voxel plot, pressure-field animation and a receiver IR.

Runs in the compas-pffdtd env (engine built with c_cuda/build_engine.ps1):

    mamba activate compas-pffdtd
    cd backend
    python -m pffdtd_backend.examples.run_obj "G:/.../simple_room.obj" \
        --source 0 1.2 0.5 --receiver 2 1.6 -1 --materials materials.json --out D:/pffdtd_obj

Coordinates (--source/--receiver) are in the OBJ's own frame and units (Rhino OBJ = Y-up;
use --up z for Z-up files, --scale 0.001 for millimetres). They must lie inside the room's
bounding box (printed at start-up); points on or just past a wall are moved EDGE_CELLS
grid cells inwards, points further out are rejected.

materials.json maps names to absorption: keys are OBJ group/object/usemtl names, or the
automatic classes "floor", "ceiling", "walls", plus "default". Values are a single
coefficient, a list for the octaves 125..4000 Hz, or {"coeffs": [...], "center_freqs": [...]}.
Example: {"floor": [0.02, 0.03, 0.03, 0.04, 0.05, 0.05], "ceiling": 0.6, "default": 0.1}

Outputs in --out: voxels.png, field.gif (or .mp4 with ffmpeg), ir.wav (float32, 48 kHz,
band-limited to --fmax, unit-sample convention: direct path 1/(4 pi r)), ir.png.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import h5py  # noqa: E402
import matplotlib  # noqa: E402
import numpy as np  # noqa: E402
from scipy.io import wavfile  # noqa: E402

from pffdtd_backend.engine import run_engine  # noqa: E402
from pffdtd_backend.materials import material_def_file  # noqa: E402
from pffdtd_backend.outputs import read_receivers, read_snapshots  # noqa: E402
from pffdtd_backend.postprocess import to_ir  # noqa: E402
from pffdtd_backend.sim_prepare import SimSpec, prepare  # noqa: E402

C_SOUND = 343.2
OCTAVES = [125, 250, 500, 1000, 2000, 4000]
OUT_FS = 48000
ALIGN_SEARCH = 0.15            # h may shrink by this fraction to align the bounding box
VERTICAL_NORMAL = 0.7          # |n_up| above this -> floor/ceiling
MAX_SCATTER_POINTS = 60000
EDGE_CELLS = 2                 # source/receiver kept this many cells inside the bounding box
TC, RH = 20.0, 50.0


# ─── OBJ ─────────────────────────────────────────────────────────────────────

def load_obj(path: Path, up: str, scale: float):
    """Return (vertices [V,3] z-up metres, triangles [F,3], group name per triangle)."""
    verts, tris, groups = [], [], []
    group = "default"
    for line in path.read_text(errors="replace").splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "v":
            verts.append([float(x) for x in parts[1:4]])
        elif parts[0] in ("g", "o", "usemtl") and len(parts) > 1:
            group = " ".join(parts[1:])
        elif parts[0] == "f":
            idx = [int(p.split("/")[0]) for p in parts[1:]]
            idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
            for k in range(1, len(idx) - 1):  # fan triangulation
                tris.append([idx[0], idx[k], idx[k + 1]])
                groups.append(group)
    v = np.asarray(verts, np.float64) * scale
    if up == "y":  # (x, y, z) Y-up -> (x, -z, y) Z-up
        v = np.c_[v[:, 0], -v[:, 2], v[:, 1]]
    return v, np.asarray(tris, np.int64), groups


def to_model_frame(p, up: str, scale: float) -> list:
    p = np.asarray(p, np.float64) * scale
    return [p[0], -p[2], p[1]] if up == "y" else p.tolist()


def from_model_frame(p, up: str, scale: float) -> list:
    p = np.asarray(p, np.float64) / scale
    return [p[0], p[2], -p[1]] if up == "y" else p.tolist()


def fit_inside(name: str, p, lo, hi, margin: float, up: str, scale: float) -> list:
    """Move a point on/near the bounding box `margin` inwards; reject it if it is clearly outside.

    PFFDTD asserts sources/receivers lie strictly inside the bounds, so a point on a wall
    (e.g. x = 0 for a room starting at the origin) fails before the simulation starts.
    """
    p = np.asarray(p, np.float64)
    fmt = lambda q: "(" + ", ".join(f"{c:.3f}" for c in from_model_frame(q, up, scale)) + ")"  # noqa: E731
    corners = np.array([from_model_frame(lo, up, scale), from_model_frame(hi, up, scale)])
    box = ", ".join(f"{a} {c0:.3f}..{c1:.3f}" for a, c0, c1 in zip("xyz", corners.min(axis=0), corners.max(axis=0)))
    if np.any(hi - lo <= 2 * margin):
        sys.exit(f"Room bounding box ({box}) is too thin for h; lower --ppw or check --scale.")
    if np.any(p < lo - margin) or np.any(p > hi + margin):
        sys.exit(f"--{name} {fmt(p)} is outside the room bounding box ({box}; OBJ frame and units). "
                 f"Pick a point inside it.")
    q = np.clip(p, lo + margin, hi - margin)
    if not np.allclose(p, q):
        print(f"warning: --{name} {fmt(p)} is on/near a wall; moved to {fmt(q)}")
    return q.tolist()


def surface_class(v, tris) -> list:
    n = np.cross(v[tris[:, 1]] - v[tris[:, 0]], v[tris[:, 2]] - v[tris[:, 0]])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    zc = v[tris].mean(axis=1)[:, 2]
    zmid = 0.5 * (v[:, 2].min() + v[:, 2].max())
    return ["walls" if abs(nz) < VERTICAL_NORMAL else ("floor" if z < zmid else "ceiling") for nz, z in zip(n[:, 2], zc)]


def parse_absorption(value) -> dict:
    if isinstance(value, dict):
        return {"coeffs": list(value["coeffs"]), "center_freqs": list(value.get("center_freqs", OCTAVES))}
    if isinstance(value, (int, float)):
        return {"coeffs": [float(value)] * len(OCTAVES), "center_freqs": OCTAVES}
    return {"coeffs": [float(x) for x in value], "center_freqs": OCTAVES[: len(value)]}


def build_scene(v, tris, groups, classes, materials: dict, src, rcv) -> tuple[dict, dict]:
    """PFFDTD mats_hash (sides 3: lossy on both sides, OBJ winding is not trusted)."""
    mats_hash, absorption = {}, {}
    for t, g, c in zip(tris, groups, classes):
        name = g if g in materials else (c if c in materials else "default")
        if name not in absorption:
            absorption[name] = parse_absorption(materials.get(name, 0.1))
            mats_hash[name] = {"pts": [], "tris": [], "sides": [], "color": [128, 128, 128]}
        e = mats_hash[name]
        b = len(e["pts"])
        e["pts"].extend(v[t].tolist())
        e["tris"].append([b, b + 1, b + 2])
        e["sides"].append(3)
    scene = {"mats_hash": mats_hash, "sources": [{"xyz": list(src)}], "receivers": [{"xyz": list(rcv)}]}
    return scene, absorption


def aligned_h(extents, h_target: float) -> float:
    """Largest h <= h_target (within ALIGN_SEARCH) putting the bbox extents on whole cells."""
    cands = [h_target] + [L / n for L in extents for n in range(math.ceil(L / h_target), math.floor(L / (h_target * (1 - ALIGN_SEARCH))) + 1)]
    return min(cands, key=lambda h: (round(sum(abs(L / h - round(L / h)) for L in extents), 9), -h))


# ─── plots ───────────────────────────────────────────────────────────────────

def plot_voxels(prep, src, rcv, out: Path, show: bool, mat_names: list) -> None:
    """3D scatter of boundary nodes per material (mat_names in PFFDTD's alphabetical index order)."""
    import matplotlib.pyplot as plt

    with h5py.File(prep.setup_dir / "vox_out.h5", "r") as f:
        bn = f["bn_ixyz"][...]
        mat = f["mat_bn"][...]
    Nx, Ny, Nz = prep.shape
    ix, iy, iz = bn // (Ny * Nz), (bn // Nz) % Ny, bn % Nz
    sel = np.arange(bn.size)
    if bn.size > MAX_SCATTER_POINTS:
        sel = np.random.default_rng(0).choice(bn.size, MAX_SCATTER_POINTS, replace=False)
    fig = plt.figure(figsize=(9, 7))
    ax = fig.add_subplot(projection="3d")
    ax.computed_zorder = False  # otherwise the markers end up behind the dense wall points
    cmap = matplotlib.colormaps["tab10"]
    for k in np.unique(mat[sel]):
        m = sel[mat[sel] == k]
        name = mat_names[k] if 0 <= k < len(mat_names) else "rigid"
        ax.scatter(prep.xv[ix[m]], prep.yv[iy[m]], prep.zv[iz[m]], s=0.5, alpha=0.25, color=cmap(int(k) % 10),
                   depthshade=False, label=f"{name} ({m.size})", zorder=1)
    ax.scatter(*src, c="red", s=150, marker="*", edgecolors="k", label="source", zorder=3)
    ax.scatter(*rcv, c="blue", s=90, edgecolors="k", label="receiver", zorder=3)
    ax.set_title(f"Voxelised boundary nodes ({bn.size} nodes, h = {prep.h * 100:.2f} cm)")
    ax.set_xlabel("x (m)")
    ax.set_ylabel("y (m)")
    ax.set_zlabel("z (m)")
    ax.set_box_aspect(np.ptp(np.c_[prep.xv[[0, -1]], prep.yv[[0, -1]], prep.zv[[0, -1]]], axis=0))
    leg = ax.legend(loc="upper left")
    for handle in leg.legend_handles[:-2]:  # material swatches only (not source/receiver)
        handle.set_sizes([30])
        handle.set_alpha(1.0)
    fig.savefig(out / "voxels.png", dpi=140)
    if show:
        plt.show()
    plt.close(fig)


def animate_field(prep, z_plane: float, src, rcv, out: Path, fps: int, show: bool) -> Path:
    import matplotlib.pyplot as plt
    from matplotlib import animation

    k = int(np.argmin(np.abs(prep.zv - z_plane)))
    frames = [(n, u[:, :, k]) for n, u in read_snapshots(prep)]
    with h5py.File(prep.setup_dir / "vox_out.h5", "r") as f:
        bn = f["bn_ixyz"][...]
    _, Ny, Nz = prep.shape
    wall = np.zeros(prep.shape[:2], bool)
    on = bn % Nz == k
    wall[bn[on] // (Ny * Nz), (bn[on] // Nz) % Ny] = True
    vmax = np.percentile(np.abs(np.stack([fr for _, fr in frames[len(frames) // 10 :]])), 99.5) or 1.0
    extent = [prep.xv[0], prep.xv[-1], prep.yv[0], prep.yv[-1]]
    fig, ax = plt.subplots(figsize=(7, 6))
    im = ax.imshow(frames[0][1].T, origin="lower", extent=extent, cmap="RdBu_r", vmin=-vmax, vmax=vmax)
    ax.imshow(np.ma.masked_where(~wall.T, wall.T), origin="lower", extent=extent, cmap="Greys", vmin=0, vmax=1, alpha=0.9)
    ax.plot(src[0], src[1], "r*", ms=12)
    ax.plot(rcv[0], rcv[1], "bo", ms=7)
    ax.set_xlabel("x (m)")
    ax.set_ylabel("y (m)")
    fig.colorbar(im, ax=ax, label="pressure (a.u.)")
    title = ax.set_title("")

    def update(i):
        n, fr = frames[i]
        im.set_data(fr.T)
        title.set_text(f"z = {prep.zv[k]:.2f} m, t = {n * prep.Ts * 1e3:.2f} ms")
        return im, title

    anim = animation.FuncAnimation(fig, update, frames=len(frames), interval=1000 / fps, blit=False)
    path = out / ("field.mp4" if shutil.which("ffmpeg") else "field.gif")
    anim.save(path, writer="ffmpeg" if path.suffix == ".mp4" else animation.PillowWriter(fps=fps), fps=fps)
    if show:
        plt.show()
    plt.close(fig)
    return path


def plot_ir(ir: np.ndarray, r: float, out: Path) -> None:
    import matplotlib.pyplot as plt

    t = np.arange(ir.size) / OUT_FS
    f = np.fft.rfftfreq(ir.size, 1 / OUT_FS)
    H = 20 * np.log10(np.abs(np.fft.rfft(ir)) * 4 * np.pi * r + 1e-12)
    fig, (a, b) = plt.subplots(2, 1, figsize=(9, 6))
    a.plot(t * 1e3, ir)
    a.set_xlabel("time (ms)")
    a.set_title("Impulse response at the receiver")
    b.semilogx(f[1:], H[1:])
    b.set_xlim(20, OUT_FS / 2)
    b.set_ylim(H[1:].max() - 60, H[1:].max() + 5)
    b.set_xlabel("frequency (Hz)")
    b.set_ylabel("dB re 1/(4 pi r)")
    b.grid(True, which="both", alpha=0.3)
    fig.tight_layout()
    fig.savefig(out / "ir.png", dpi=140)
    plt.close(fig)


# ─── main ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("obj", type=Path)
    ap.add_argument("--source", type=float, nargs=3, required=True)
    ap.add_argument("--receiver", type=float, nargs=3, required=True)
    ap.add_argument("--materials", default="{}", help="JSON file or inline JSON (see module doc)")
    ap.add_argument("--up", choices=["y", "z"], default="y")
    ap.add_argument("--scale", type=float, default=1.0, help="OBJ units -> metres")
    ap.add_argument("--fmax", type=float, default=500.0)
    ap.add_argument("--ppw", type=float, default=12.0)
    ap.add_argument("--duration", type=float, default=1.0, help="IR length (s)")
    ap.add_argument("--anim-duration", type=float, default=0.03, help="animated time span (s)")
    ap.add_argument("--frames", type=int, default=120)
    ap.add_argument("--fps", type=int, default=20)
    ap.add_argument("--slice-z", type=float, default=None, help="plane height (model z-up, m); default receiver")
    ap.add_argument("--out", type=Path, default=Path("pffdtd_obj_out"))
    ap.add_argument("--show", action="store_true", help="also open interactive windows")
    args = ap.parse_args()

    if not args.show:
        matplotlib.use("Agg")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    # utf-8-sig: editors / PowerShell often write a BOM
    mats = json.loads(Path(args.materials).read_text(encoding="utf-8-sig")) if Path(args.materials).is_file() else json.loads(args.materials)

    v, tris, groups = load_obj(args.obj, args.up, args.scale)
    h = aligned_h(np.ptp(v, axis=0), C_SOUND / (args.fmax * args.ppw))
    lo, hi = v.min(axis=0), v.max(axis=0)
    src = fit_inside("source", to_model_frame(args.source, args.up, args.scale), lo, hi, EDGE_CELLS * h, args.up, args.scale)
    rcv = fit_inside("receiver", to_model_frame(args.receiver, args.up, args.scale), lo, hi, EDGE_CELLS * h, args.up, args.scale)
    scene, absorption = build_scene(v, tris, groups, surface_class(v, tris), mats, src, rcv)
    mat_files = {k: material_def_file(a["coeffs"], a["center_freqs"], out / "materials") for k, a in absorption.items()}
    print(f"{len(tris)} triangles, materials {list(absorption)}, h = {h:.4f} m (PPW {C_SOUND / (args.fmax * h):.1f})")

    # 1) impulse run -> IR
    prep = prepare(SimSpec(sim_dir=out / "ir_run", scene=scene, duration=args.duration, h=h, mat_files=mat_files, Tc=TC, rh=RH))
    plot_voxels(prep, src, rcv, out, args.show, sorted(k for k in scene["mats_hash"] if k != "_RIGID"))
    run_engine(prep.gpu_dir, "double", on_progress=lambda p, e, r: print(f"\rIR run {p:5.1f}%", end=""))
    r_out, Ts = read_receivers(prep.gpu_dir)
    ir = to_ir(r_out[:1], Ts, args.fmax, OUT_FS, args.duration, 10.0, 4, 4, True, TC, RH)[0]
    wavfile.write(out / "ir.wav", OUT_FS, ir.astype(np.float32))
    plot_ir(ir, float(np.linalg.norm(np.subtract(rcv, src))), out)
    print(f"\nIR -> {out / 'ir.wav'}")

    # 2) band-limited pulse run with snapshots -> animation (one sine cycle: zero net volume)
    period = 1.5 / args.fmax

    def pulse(Ts_, Nt_):
        n = np.arange(Nt_)
        return np.where(n * Ts_ < period, np.sin(2 * np.pi * n * Ts_ / period), 0.0)

    anim_prep = prepare(SimSpec(sim_dir=out / "anim_run", scene=scene, duration=args.anim_duration, h=h,
                                mat_files=mat_files, Tc=TC, rh=RH, source_signal=pulse))
    stride = max(1, anim_prep.Nt // args.frames)
    with h5py.File(anim_prep.gpu_dir / "compas_extra.h5", "w") as f:
        f.create_dataset("snap_steps", data=np.arange(0, anim_prep.Nt, stride, dtype=np.int64))
    run_engine(anim_prep.gpu_dir, "double")
    path = animate_field(anim_prep, rcv[2] if args.slice_z is None else args.slice_z, src, rcv, out, args.fps, args.show)
    print(f"animation -> {path}\nvoxels -> {out / 'voxels.png'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
