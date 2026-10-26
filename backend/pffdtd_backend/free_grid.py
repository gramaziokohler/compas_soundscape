"""Candidate grid of a free-positioning run: the grid nodes a moved listener / source can snap to.

Points sit on exact grid nodes (no trilinear interpolation, one output row per probe) every
``stride`` nodes, inside the model's bounding box, at least ``clearance`` from any boundary node
and in the air volume connected to the fixed side's seeds. ``stride`` is raised until the
recording fits the caps (engine host RAM per run in float64, raw store on disk in float32).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# probe order of postprocess.FOA_PROBE_OFFSETS: centre, +x, -x, +y, -y, +z, -z
_PROBE_STEPS = np.array([[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], np.int64)


@dataclass
class FreeGrid:
    stride: int
    spacing_m: float           # effective spacing (stride * h)
    xyz: np.ndarray            # [Np, 3] node positions
    probe_ixyz: np.ndarray     # [Np, n_probe] engine-layout node indices (point-major)
    requested_spacing_m: float
    connectivity_checked: bool

    @property
    def n_points(self) -> int:
        return self.xyz.shape[0]

    @property
    def n_probe(self) -> int:
        return self.probe_ixyz.shape[1]


def _air_labels(shape, bn_ixyz: np.ndarray) -> np.ndarray:
    from scipy import ndimage

    air = np.ones(int(np.prod(shape)), bool)
    air[bn_ixyz] = False
    lab, _ = ndimage.label(air.reshape(shape), structure=ndimage.generate_binary_structure(3, 1))
    return lab


def _axis(v: np.ndarray, lo: float, hi: float, stride: int) -> np.ndarray:
    """Every stride-th node index inside [lo, hi], centred in the range."""
    idx = np.flatnonzero((v >= lo) & (v <= hi))
    if idx.size == 0:
        return idx
    n = (idx[-1] - idx[0]) // stride
    first = idx[0] + ((idx[-1] - idx[0]) - n * stride) // 2
    return np.arange(first, idx[-1] + 1, stride)


def candidate_grid(
    xv: np.ndarray, yv: np.ndarray, zv: np.ndarray, bn_ixyz: np.ndarray,
    bmin, bmax, seeds, spacing_m: float, clearance_m: float, n_probe: int, Nt: int, n_runs: int,
    max_record_bytes: float, max_disk_bytes: float, max_label_nodes: int,
) -> FreeGrid:
    """Nodes at ~spacing_m in the air volume of the fixed seeds (sources or listeners).

    n_probe is 1 (pressure) or 7 (pressure + gradient probes one cell away on each axis).
    """
    from scipy.spatial import cKDTree

    Nx, Ny, Nz = xv.size, yv.size, zv.size
    h = float(xv[1] - xv[0])
    bn = np.asarray(bn_ixyz, np.int64)
    bn_pos = np.c_[xv[bn // (Ny * Nz)], yv[(bn // Nz) % Ny], zv[bn % Nz]]
    tree = cKDTree(bn_pos) if bn.size else None
    margin = clearance_m + (h if n_probe > 1 else 0.0)

    labels = None
    keep_labels: set[int] = set()
    if Nx * Ny * Nz <= max_label_nodes:
        labels = _air_labels((Nx, Ny, Nz), bn).ravel()
        for s in seeds:
            i = [int(np.clip(round((c - v[0]) / h), 0, v.size - 1)) for v, c in zip((xv, yv, zv), s)]
            lab = int(labels[i[0] * Ny * Nz + i[1] * Nz + i[2]])
            if lab:
                keep_labels.add(lab)

    stride = max(1, int(round(spacing_m / h)))
    steps = _PROBE_STEPS[:n_probe] @ np.array([Ny * Nz, Nz, 1], np.int64)
    lo, hi = np.asarray(bmin, float) + margin, np.asarray(bmax, float) - margin
    while True:
        ix, iy, iz = (_axis(v, a, b, stride) for v, a, b in zip((xv, yv, zv), lo, hi))
        IX, IY, IZ = np.meshgrid(ix, iy, iz, indexing="ij")
        ixyz = (IX * (Ny * Nz) + IY * Nz + IZ).ravel()
        xyz = np.c_[xv[IX.ravel()], yv[IY.ravel()], zv[IZ.ravel()]]
        if tree is not None and ixyz.size:
            d, _ = tree.query(xyz, distance_upper_bound=margin)
            ok = d >= margin
            ixyz, xyz = ixyz[ok], xyz[ok]
        if labels is not None and keep_labels and ixyz.size:
            ok = np.isin(labels[ixyz], list(keep_labels))
            ixyz, xyz = ixyz[ok], xyz[ok]
        rows = ixyz.size * n_probe
        fits = rows * Nt * 8 <= max_record_bytes and rows * Nt * 4 * n_runs <= max_disk_bytes
        if fits or stride >= max(Nx, Ny, Nz):
            break
        stride += 1

    return FreeGrid(
        stride=stride, spacing_m=stride * h, xyz=xyz, probe_ixyz=ixyz[:, None] + steps[None, :],
        requested_spacing_m=float(spacing_m), connectivity_checked=labels is not None,
    )
