"""Read PFFDTD engine outputs: receiver signals (trilinear-recombined), field snapshots,
the output plane (wave-animation snapshots) and the output lattice (band-passed p^2
accumulation for the strength-G volume). The engine reads either as one node list
(``plane_ixyz``)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import h5py
import numpy as np
from scipy.signal import lfilter

from pffdtd_backend.sim_prepare import PreparedSim, unfold_fcc_field

PLANE_AIR, PLANE_WALL, PLANE_OUTSIDE = 0, 1, 2


def read_receivers(gpu_dir: Path) -> tuple[np.ndarray, float]:
    """Return (r_out [Nr, Nt], Ts): pressure at each receiver at the native sim rate.

    Receivers are recombined from their 8 trilinear-interpolation nodes. If the source
    was differentiated (``diff``), the exact inverse (trapezoidal integrator) is applied,
    with no low-cut, so the result is the raw scheme response.
    """
    gpu_dir = Path(gpu_dir)
    with h5py.File(gpu_dir / "comms_out.h5", "r") as f:
        out_alpha = f["out_alpha"][...]
        diff = bool(f["diff"][()])
    with h5py.File(gpu_dir / "sim_consts.h5", "r") as f:
        Ts = float(f["Ts"][()])
    with h5py.File(gpu_dir / "sim_outs.h5", "r") as f:
        u_out = f["u_out"][: out_alpha.size]  # node receivers (if any) follow these rows
    r_out = np.sum((u_out * out_alpha.ravel()[:, None]).reshape((*out_alpha.shape, -1)), axis=1)
    if diff:
        r_out = _undiff(r_out, Ts)
    return r_out, Ts


def _undiff(x: np.ndarray, Ts: float) -> np.ndarray:
    """Exact inverse of a differentiated source (trapezoidal integrator)."""
    return lfilter(Ts / 2 * np.array([1.0, 1.0]), np.array([1.0, -1.0]), x, axis=-1)


NODE_STREAM_ROWS = 4096  # rows of sim_outs.h5 converted per chunk


def stream_node_receivers(gpu_dir: Path, n_probe: int, out_path: Path) -> tuple[np.ndarray, float]:
    """Copy the node-receiver rows (``SimSpec.node_receivers``, after the scene receivers) of a
    finished run to a float32 file [Np, n_probe, Nt] at the native sim rate, chunk by chunk.

    Returns (energy [Np]: sum of the centre probe's u^2, Ts).
    """
    gpu_dir = Path(gpu_dir)
    with h5py.File(gpu_dir / "comms_out.h5", "r") as f:
        start = int(f["out_alpha"].size)
        diff = bool(f["diff"][()])
    with h5py.File(gpu_dir / "sim_consts.h5", "r") as f:
        Ts = float(f["Ts"][()])
    with h5py.File(gpu_dir / "sim_outs.h5", "r") as f:
        u = f["u_out"]
        n_rows, Nt = u.shape[0] - start, u.shape[1]
        assert n_rows % n_probe == 0, (n_rows, n_probe)
        out = np.lib.format.open_memmap(out_path, mode="w+", dtype=np.float32, shape=(n_rows // n_probe, n_probe, Nt))
        flat = out.reshape(n_rows, Nt)
        energy = np.zeros(n_rows // n_probe)
        step = max(n_probe, NODE_STREAM_ROWS // n_probe * n_probe)
        for r0 in range(0, n_rows, step):
            r1 = min(n_rows, r0 + step)
            rows = u[start + r0 : start + r1]
            if diff:
                rows = _undiff(rows, Ts)
            flat[r0:r1] = rows
            centre = rows[::n_probe]
            energy[r0 // n_probe : r1 // n_probe] = np.einsum("pt,pt->p", centre, centre)
        out.flush()
        del out, flat
    return energy, Ts


def read_snapshots(prep: PreparedSim) -> list[tuple[int, np.ndarray]]:
    """Return [(n, u^n)]: the full Cartesian grid (NaN at non-FCC nodes for FCC runs), or the
    plane nodes [Np] in ``spec.plane_ixyz`` order when the run has an output plane."""
    Nx, Ny, Nz = prep.shape
    plane = prep.spec.plane_ixyz is not None
    out = []
    with h5py.File(prep.gpu_dir / "snap_out.h5", "r") as f:
        k = 0
        while f"u_snap_{k:03d}" in f:
            n = int(f[f"n_snap_{k:03d}"][()])
            u = f[f"u_snap_{k:03d}"][...]
            if plane:
                u = u.ravel()
            elif prep.fcc:
                u = unfold_fcc_field(u.reshape((Nx, Ny // 2 + 1, Nz)), Ny)
            else:
                u = u.reshape((Nx, Ny, Nz))
            out.append((n, u))
            k += 1
    return out


def read_plane_accum(prep: PreparedSim) -> np.ndarray:
    """Band-passed sum of p^2 over all steps at the accumulation nodes [Np] in ``spec.plane_ixyz``
    order (unit-sample scale)."""
    with h5py.File(prep.gpu_dir / "plane_out.h5", "r") as f:
        return f["p2_acc"][...]


@dataclass
class OutputPlane:
    """A horizontal plane of grid nodes, decimated by ``stride`` in x and y.

    Arrays are [ny, nx] row-major (y outer, x inner); ``ixyz`` follows the same order.
    """
    iz: int
    z: float
    stride: int
    x: np.ndarray        # [nx] node x coordinates
    y: np.ndarray        # [ny]
    ixyz: np.ndarray     # [ny*nx] engine-layout indices
    walls: np.ndarray    # [ny, nx] bool: a boundary node within the decimation block

    @property
    def nx(self) -> int:
        return self.x.size

    @property
    def ny(self) -> int:
        return self.y.size

    def as_dict(self) -> dict:
        d = lambda v: float(v[1] - v[0]) if v.size > 1 else 0.0  # noqa: E731
        return {"iz": self.iz, "z": self.z, "stride": self.stride, "nx": self.nx, "ny": self.ny,
                "x0": float(self.x[0]), "y0": float(self.y[0]), "dx": d(self.x), "dy": d(self.y)}


def plane_nodes(xv: np.ndarray, yv: np.ndarray, zv: np.ndarray, bn_ixyz: np.ndarray, z: float, max_px: int) -> OutputPlane:
    """Nodes of the grid plane nearest to height z, at most max_px along the longer side."""
    Nx, Ny, Nz = xv.size, yv.size, zv.size
    iz = int(np.argmin(np.abs(zv - z)))
    stride = max(1, math.ceil(max(Nx, Ny) / max_px))
    sx, sy = np.arange(0, Nx, stride), np.arange(0, Ny, stride)
    IY, IX = np.meshgrid(sy, sx, indexing="ij")
    ixyz = (IX * (Ny * Nz) + IY * Nz + iz).ravel().astype(np.int64)

    bn = np.asarray(bn_ixyz, np.int64)
    on = bn[bn % Nz == iz]
    wall_full = np.zeros((Ny, Nx), bool)
    wall_full[(on // Nz) % Ny, on // (Ny * Nz)] = True
    pad_y, pad_x = sy.size * stride - Ny, sx.size * stride - Nx
    padded = np.pad(wall_full, ((0, pad_y), (0, pad_x)))
    walls = padded.reshape(sy.size, stride, sx.size, stride).any(axis=(1, 3))
    return OutputPlane(iz=iz, z=float(zv[iz]), stride=stride, x=xv[sx], y=yv[sy], ixyz=ixyz, walls=walls)


@dataclass
class OutputLattice:
    """Every ``stride``-th grid node in x, y and z: one node at the centre of each stride^3 block.

    Arrays are [nz, ny, nx] row-major (z outer, x inner); ``ixyz`` follows the same order.
    Block (kz, ky, kx) covers grid nodes [k * stride, (k + 1) * stride) on each axis.
    """
    stride: int
    x: np.ndarray        # [nx] node x coordinates (uniform, spacing stride * h)
    y: np.ndarray        # [ny]
    z: np.ndarray        # [nz]
    ixyz: np.ndarray     # [nz*ny*nx] engine-layout indices
    walls: np.ndarray    # [nz, ny, nx] bool: a boundary node within the block

    @property
    def shape(self) -> tuple[int, int, int]:
        return self.z.size, self.y.size, self.x.size

    def nearest(self, x, y, z) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(kz, ky, kx) of the lattice node nearest to each point (clipped to the lattice)."""
        def k(v, c):
            step = v[1] - v[0] if v.size > 1 else 1.0
            return np.clip(np.rint((np.asarray(c, np.float64) - v[0]) / step), 0, v.size - 1).astype(np.int64)
        return k(self.z, z), k(self.y, y), k(self.x, x)

    def as_dict(self) -> dict:
        d = lambda v: float(v[1] - v[0]) if v.size > 1 else 0.0  # noqa: E731
        nz, ny, nx = self.shape
        return {"stride": self.stride, "nx": nx, "ny": ny, "nz": nz,
                "x0": float(self.x[0]), "y0": float(self.y[0]), "z0": float(self.z[0]),
                "dx": d(self.x), "dy": d(self.y), "dz": d(self.z)}


def _lattice_axis(n: int, stride: int) -> np.ndarray:
    """Grid indices of the block-centre nodes along one axis (blocks whose centre is in range)."""
    return np.arange(stride // 2, n, stride)


def lattice_size(shape: tuple[int, int, int], stride: int) -> int:
    return math.prod(_lattice_axis(n, stride).size for n in shape)


def lattice_nodes(xv: np.ndarray, yv: np.ndarray, zv: np.ndarray, bn_ixyz: np.ndarray, stride: int, max_nodes: int) -> OutputLattice:
    """3D lattice at ``stride`` (raised until it has at most max_nodes nodes)."""
    Nx, Ny, Nz = xv.size, yv.size, zv.size
    stride = max(1, int(stride))
    while stride < max(Nx, Ny, Nz) and lattice_size((Nx, Ny, Nz), stride) > max_nodes:
        stride += 1
    sx, sy, sz = (_lattice_axis(n, stride) for n in (Nx, Ny, Nz))
    IZ, IY, IX = np.meshgrid(sz, sy, sx, indexing="ij")
    ixyz = (IX * (Ny * Nz) + IY * Nz + IZ).ravel().astype(np.int64)

    bn = np.asarray(bn_ixyz, np.int64)
    kx, ky, kz = bn // (Ny * Nz) // stride, (bn // Nz) % Ny // stride, bn % Nz // stride
    keep = (kx < sx.size) & (ky < sy.size) & (kz < sz.size)  # a partial last block has no node
    walls = np.zeros((sz.size, sy.size, sx.size), bool)
    walls[kz[keep], ky[keep], kx[keep]] = True
    return OutputLattice(stride=stride, x=xv[sx], y=yv[sy], z=zv[sz], ixyz=ixyz, walls=walls)
