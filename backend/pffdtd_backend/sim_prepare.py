"""Prepare a PFFDTD run directory (setup + voxelisation + GPU data) from a scene dict.

Replaces upstream ``sim_setup.py`` for compas use:
- takes the scene as a dict (PFFDTD model JSON schema) and absolute material paths,
- exposes grid spacing ``h`` and an optional Courant override (``courant``),
- supports a silent source plus initial conditions / field snapshots
  (written to ``compas_extra.h5``, read by the patched CUDA engine),
- prepares single-GPU data (no axis rotation; FCC fold + sort only).
"""

from __future__ import annotations

import contextlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import h5py
import numpy as np

import pffdtd_backend  # noqa: F401  (puts upstream python/ on sys.path)
from common.room_geo import RoomGeo
from fdtd.rotate_sim_data import copy_sim_data, fold_fcc_sim_data, sort_sim_data
from fdtd.sim_comms import SimComms
from fdtd.sim_consts import SimConsts
from fdtd.sim_mats import SimMats
from voxelizer.cart_grid import CartGrid
from voxelizer.vox_grid import VoxGrid
from voxelizer.vox_scene import VoxScene

GRID_OFFSET_CELLS = 3.5  # upstream default; with bmin on a multiple of h, nodes sit at cell centres
SETUP_SUBDIR = "setup"
GPU_SUBDIR = "gpu"
EXTRA_FILE = "compas_extra.h5"
IC_SLAB_POINTS = 2**24  # grid points per x-slab when evaluating initial conditions

# p0(x, y, z, t) -> pressure; evaluated at t = -Ts and t = 0 to start the leapfrog scheme
InitialCondition = Callable[[np.ndarray, np.ndarray, np.ndarray, float], np.ndarray]
# mask(x, y, z) -> bool array, True where the initial condition applies (False -> 0)
RegionMask = Callable[[np.ndarray, np.ndarray, np.ndarray], np.ndarray]


@dataclass
class SimSpec:
    sim_dir: Path
    scene: dict
    duration: float
    h: Optional[float] = None
    fmax: Optional[float] = None
    ppw: Optional[float] = None
    fcc: bool = False
    precision: str = "double"  # "single" | "double"
    mat_files: dict = field(default_factory=dict)  # material name -> absolute DEF .h5 path
    courant: Optional[float] = None  # Courant number override (<= stability limit)
    diff_source: Optional[bool] = None  # default: True for single precision
    Tc: float = 20.0
    rh: float = 50.0
    source_index: int = 0
    silent_source: bool = False
    # optional source waveform (Ts, Nt) -> [Nt] replacing the unit impulse (e.g. a band-limited
    # pulse for field visualisation); same unit-sample scaling as the impulse
    source_signal: Optional[Callable[[float, int], np.ndarray]] = None
    initial_condition: Optional[InitialCondition] = None
    ic_mask: Optional[RegionMask] = None
    snapshot_steps: list = field(default_factory=list)
    bmin: Optional[np.ndarray] = None
    bmax: Optional[np.ndarray] = None


@dataclass
class PreparedSim:
    spec: SimSpec
    setup_dir: Path
    gpu_dir: Path
    h: float
    Ts: float
    c: float
    l: float
    Nt: int
    xv: np.ndarray
    yv: np.ndarray
    zv: np.ndarray
    fcc: bool
    Nb: int

    @property
    def shape(self) -> tuple:
        return (self.xv.size, self.yv.size, self.zv.size)


def _print(msg: str) -> None:
    print(f"--COMPAS_PREPARE: {msg}", flush=True)


def fold_fcc_field(u: np.ndarray, ix0: int = 0) -> np.ndarray:
    """Fold a full Cartesian-grid field onto the FCC half grid (matches fold_fcc_sim_data).

    ``u`` may be an x-slab starting at global index ``ix0`` (parity depends on it).
    """
    Nx, Ny, Nz = u.shape
    assert Ny % 2 == 0
    Nyh = Ny // 2 + 1
    uf = np.zeros((Nx, Nyh, Nz), dtype=u.dtype)
    ix, iy, iz = np.ogrid[ix0 : ix0 + Nx, 0 : Ny // 2, 0:Nz]
    even = (ix + iy + iz) % 2 == 0
    lower = u[:, : Ny // 2, :]
    upper = u[:, ::-1, :][:, : Ny // 2, :]  # original row Ny-1-iy
    uf[:, : Ny // 2, :] = np.where(even, lower, upper)
    return uf


def unfold_fcc_field(uf: np.ndarray, Ny: int) -> np.ndarray:
    """Inverse of fold_fcc_field; non-FCC nodes of the full grid are NaN."""
    Nx, _, Nz = uf.shape
    u = np.full((Nx, Ny, Nz), np.nan, dtype=np.float64)
    ix, iy, iz = np.ogrid[0:Nx, 0 : Ny // 2, 0:Nz]
    even = np.broadcast_to((ix + iy + iz) % 2 == 0, (Nx, Ny // 2, Nz))
    half = uf[:, : Ny // 2, :]
    lower = u[:, : Ny // 2, :]
    lower[even] = half[even]
    upper = np.full((Nx, Ny // 2, Nz), np.nan)
    upper[~even] = half[~even]
    u[:, Ny // 2 :, :] = upper[:, ::-1, :]
    return u


def _consts(spec: SimSpec) -> SimConsts:
    kw = dict(Tc=spec.Tc, rh=spec.rh, fcc=spec.fcc, l=spec.courant)
    if spec.h is not None:
        return SimConsts(h=spec.h, **kw)
    assert spec.fmax is not None and spec.ppw is not None, "need h or (fmax, ppw)"
    return SimConsts(fmax=spec.fmax, PPW=spec.ppw, **kw)


def _write_extra(prep: PreparedSim, sim_comms: SimComms) -> None:
    spec = prep.spec
    if spec.initial_condition is None and not spec.snapshot_steps:
        return
    h5f = h5py.File(prep.gpu_dir / EXTRA_FILE, "w")
    if spec.initial_condition is not None:
        Nx, Ny, Nz = prep.shape
        Nyl = Ny // 2 + 1 if prep.fcc else Ny  # engine-layout y size
        slab = max(1, int(IC_SLAB_POINTS // (Ny * Nz)))
        for name, t in (("u_ic_prev", -prep.Ts), ("u_ic_curr", 0.0)):
            dset = h5f.create_dataset(name, shape=(Nx * Nyl * Nz,), dtype=np.float64)
            for ix0 in range(0, Nx, slab):
                ix1 = min(Nx, ix0 + slab)
                X, Y, Z = np.meshgrid(prep.xv[ix0:ix1], prep.yv, prep.zv, indexing="ij")
                mask = spec.ic_mask(X, Y, Z) if spec.ic_mask is not None else True
                u = np.where(mask, spec.initial_condition(X, Y, Z, t), 0.0)
                if prep.fcc:
                    ix, iy, iz = np.ogrid[ix0:ix1, 0:Ny, 0:Nz]
                    u = fold_fcc_field(np.where((ix + iy + iz) % 2 == 0, u, 0.0), ix0)
                dset[ix0 * Nyl * Nz : ix1 * Nyl * Nz] = u.ravel()
    if spec.snapshot_steps:
        steps = np.sort(np.asarray(spec.snapshot_steps, dtype=np.int64))
        assert steps[0] >= 0 and steps[-1] <= prep.Nt
        h5f.create_dataset("snap_steps", data=steps)
    h5f.close()


def prepare(spec: SimSpec) -> PreparedSim:
    sim_dir = Path(spec.sim_dir).resolve()
    setup_dir = sim_dir / SETUP_SUBDIR
    gpu_dir = sim_dir / GPU_SUBDIR
    setup_dir.mkdir(parents=True, exist_ok=True)
    model_json = setup_dir / "model.json"
    model_json.write_text(json.dumps(spec.scene))

    # voxeliser writes scratch files relative to cwd
    with contextlib.chdir(setup_dir):
        bmin = None if spec.bmin is None else np.asarray(spec.bmin, np.float64)
        bmax = None if spec.bmax is None else np.asarray(spec.bmax, np.float64)
        room_geo = RoomGeo(str(model_json), az_el=np.array([0.0, 0.0]), bmin=bmin, bmax=bmax)
        Sxyz = room_geo.Sxyz[spec.source_index]
        Rxyz = room_geo.Rxyz

        sim_consts = _consts(spec)
        sim_consts.save(setup_dir)

        mats = [m for m in room_geo.mat_str if m != "_RIGID"]
        missing = [m for m in mats if m not in spec.mat_files]
        assert not missing, f"no DEF file for materials {missing}"
        SimMats(save_folder=setup_dir).package(
            mat_files_dict={m: str(Path(spec.mat_files[m]).resolve()) for m in mats},
            mat_list=room_geo.mat_str,
            read_folder=".",
        )

        cart_grid = CartGrid(
            h=sim_consts.h, offset=GRID_OFFSET_CELLS, bmin=room_geo.bmin, bmax=room_geo.bmax, fcc=spec.fcc
        )
        cart_grid.save(setup_dir)

        diff = spec.diff_source if spec.diff_source is not None else spec.precision == "single"
        sim_comms = SimComms(save_folder=setup_dir)
        sim_comms.prepare_source_pts(Sxyz)
        sim_comms.prepare_receiver_pts(Rxyz)
        sim_comms.prepare_source_signals(spec.duration, sig_type="impulse")
        if spec.source_signal is not None:
            Nt_sig = sim_comms.in_sigs.shape[-1]
            sig = np.asarray(spec.source_signal(sim_consts.Ts, Nt_sig), np.float64)
            sim_comms.in_sigs = sim_comms.in_alpha[:, None] * sig[None, :Nt_sig]
            sim_comms._scale_source_signals()
        if spec.silent_source:
            sim_comms.in_sigs[:] = 0.0
        if diff:
            sim_comms.diff_source()
        sim_comms.save()

        vox_grid = VoxGrid(room_geo, cart_grid)
        vox_grid.fill(Nprocs=1)
        vox_scene = VoxScene(room_geo, cart_grid, vox_grid, fcc=spec.fcc)
        vox_scene.calc_adj(Nprocs=1)
        vox_scene.check_adj_full()
        vox_scene.save(setup_dir)
        sim_comms.check_for_clashes(vox_scene.bn_ixyz)

    copy_sim_data(setup_dir, gpu_dir)
    if spec.fcc:
        fold_fcc_sim_data(gpu_dir)
    sort_sim_data(gpu_dir)

    with h5py.File(gpu_dir / "comms_out.h5", "r") as f:
        Nt = int(f["Nt"][()])
    prep = PreparedSim(
        spec=spec,
        setup_dir=setup_dir,
        gpu_dir=gpu_dir,
        h=float(sim_consts.h),
        Ts=float(sim_consts.Ts),
        c=float(sim_consts.c),
        l=float(sim_consts.l),
        Nt=Nt,
        xv=cart_grid.xv,
        yv=cart_grid.yv,
        zv=cart_grid.zv,
        fcc=spec.fcc,
        Nb=int(vox_scene.bn_ixyz.size),
    )
    _write_extra(prep, sim_comms)
    _print(f"prepared {gpu_dir} grid={prep.shape} Nt={Nt} Nb={prep.Nb} h={prep.h:.5g} Ts={prep.Ts:.5g}")
    return prep


def snap_courant(h: float, c: float, t_target: float, fcc: bool, factor: float = 1.0) -> tuple[float, int]:
    """Largest Courant number <= factor * l_max (upstream 0.999 back-off) putting t_target on a step.

    Returns (l, n) with n * Ts == t_target.
    """
    l_max = (1.0 if fcc else np.sqrt(1 / 3)) * 0.999 * factor
    Ts_max = h * l_max / c
    n = int(np.ceil(t_target / Ts_max - 1e-9))
    Ts = t_target / n
    return c * Ts / h, n
