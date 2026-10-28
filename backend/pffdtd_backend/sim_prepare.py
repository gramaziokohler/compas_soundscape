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
import hashlib
import json
import os
import shutil
from dataclasses import dataclass, field, replace
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
    # conformal (cut-cell) walls; Cartesian only, FCC always staircases (voxelizer/cut_cells.py)
    conformal: bool = True
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
    # optional output plane: engine-layout node indices; snapshots then hold these nodes only,
    # and with acc_sos [S, 6] the engine accumulates the band-passed p^2 there (plane_out.h5)
    plane_ixyz: Optional[np.ndarray] = None
    acc_sos: Optional[np.ndarray] = None
    # optional source made of several points [(xyz, weight)] driven by the same signal (e.g. a
    # +/- monopole pair for a reciprocal dipole); replaces the scene source for this run
    source_points: Optional[list] = None
    # optional receivers on exact grid nodes (engine-layout indices, one output row each, no
    # interpolation), appended after the scene receivers (outputs.stream_node_receivers)
    node_receivers: Optional[np.ndarray] = None
    bmin: Optional[np.ndarray] = None
    bmax: Optional[np.ndarray] = None
    # compas: folder of cached voxelisations (shared by the voxel preview and the runs of the same
    # geometry + grid; see _voxelise). None = always voxelise.
    vox_cache_dir: Optional[Path] = None


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
    # cut cells only: set when the air reaches the grid edge (open model; see cut_cells.apply_cut_cells)
    air_leak: Optional[dict] = None

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


def _write_extra(prep: PreparedSim) -> None:
    spec = prep.spec
    path = prep.gpu_dir / EXTRA_FILE
    if spec.initial_condition is None and not len(spec.snapshot_steps) and spec.plane_ixyz is None:
        path.unlink(missing_ok=True)
        return
    h5f = h5py.File(path, "w")
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
    if len(spec.snapshot_steps):
        steps = np.sort(np.asarray(spec.snapshot_steps, dtype=np.int64))
        assert steps[0] >= 0 and steps[-1] <= prep.Nt
        h5f.create_dataset("snap_steps", data=steps)
    if spec.plane_ixyz is not None:
        assert not prep.fcc, "output planes are Cartesian-only"
        plane = np.asarray(spec.plane_ixyz, dtype=np.int64)
        assert plane.size and plane.min() >= 0 and plane.max() < prep.xv.size * prep.yv.size * prep.zv.size
        h5f.create_dataset("plane_ixyz", data=plane)
        if spec.acc_sos is not None:
            sos = np.asarray(spec.acc_sos, dtype=np.float64)
            assert sos.ndim == 2 and sos.shape[1] == 6
            h5f.create_dataset("acc_sos", data=sos)
    h5f.close()


def _build_comms(spec: SimSpec, setup_dir: Path, Sxyz: np.ndarray, Rxyz: np.ndarray) -> SimComms:
    """Source/receiver points and source signal for one run (saved to setup_dir/comms_out.h5)."""
    diff = spec.diff_source if spec.diff_source is not None else spec.precision == "single"
    sim_comms = SimComms(save_folder=setup_dir)
    if spec.source_points:
        weights = [sim_comms.get_linear_interp_weights(np.asarray(xyz, np.float64)) for xyz, _ in spec.source_points]
        sim_comms.in_alpha = np.concatenate([a * float(w) for (a, _), (_, w) in zip(weights, spec.source_points)])
        sim_comms.in_ixyz = np.concatenate([ix for _, ix in weights])
    else:
        sim_comms.prepare_source_pts(Sxyz)
    sim_comms.prepare_receiver_pts(Rxyz)
    if spec.node_receivers is not None and len(spec.node_receivers):
        assert not spec.fcc, "node receivers are Cartesian-only"
        # out_alpha stays [R, 8] for the scene receivers; the node rows follow them
        sim_comms.out_ixyz = np.concatenate([sim_comms.out_ixyz.ravel(), np.asarray(spec.node_receivers, np.int64).ravel()])
    sim_comms.prepare_source_signals(spec.duration, sig_type="impulse")
    if spec.source_signal is not None:
        Nt_sig = sim_comms.in_sigs.shape[-1]
        sig = np.asarray(spec.source_signal(sim_comms.Ts, Nt_sig), np.float64)
        sim_comms.in_sigs = sim_comms.in_alpha[:, None] * sig[None, :Nt_sig]
        sim_comms._scale_source_signals()
    if spec.silent_source:
        sim_comms.in_sigs[:] = 0.0
    if diff:
        sim_comms.diff_source()
    sim_comms.save()
    return sim_comms


def _finish_gpu_dir(setup_dir: Path, gpu_dir: Path, fcc: bool) -> int:
    """Copy the setup data to gpu_dir, fold FCC and sort; returns Nt."""
    copy_sim_data(setup_dir, gpu_dir)
    if fcc:
        fold_fcc_sim_data(gpu_dir)
    sort_sim_data(gpu_dir)
    with h5py.File(gpu_dir / "comms_out.h5", "r") as f:
        return int(f["Nt"][()])


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

        sim_comms = _build_comms(spec, setup_dir, Sxyz, Rxyz)
        vox_cache_file = _vox_cache_path(spec, cart_grid)
        vox_scene = _voxelise(room_geo, cart_grid, spec.fcc, vox_cache_file)
        if spec.conformal and not spec.fcc:
            _apply_cut_cells(vox_scene, sim_comms.in_ixyz, float(sim_consts.l2), vox_cache_file)
        vox_scene.check_adj_full()
        vox_scene.save(setup_dir)
        sim_comms.check_for_clashes(vox_scene.bn_ixyz)

    Nt = _finish_gpu_dir(setup_dir, gpu_dir, spec.fcc)
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
        air_leak=getattr(vox_scene, "air_leak", None),
    )
    _write_extra(prep)
    _print(f"prepared {gpu_dir} grid={prep.shape} Nt={Nt} Nb={prep.Nb} h={prep.h:.5g} Ts={prep.Ts:.5g}")
    return prep


VOX_CACHE_VERSION = 2  # bump when the voxeliser / cut-cell output changes
VOX_CACHE_MAX_ENTRIES = 16  # voxelisations and cut-cell results together
_VOX_CACHE_FIELDS = ("bn_ixyz", "adj_bn", "mat_bn", "saf_bn", "tidx_bn")
_CUT_CACHE_FIELDS = ("bn_ixyz", "beta_bn", "vol_bn", "mat_bn", "saf_bn")


def job_domain_bounds(job: dict) -> dict:
    """``{"bmin", "bmax"}`` SimSpec kwargs of a job's padded domain (open scenes), else Nones."""
    return {key: None if job.get(key) is None else np.asarray(job[key], np.float64) for key in ("bmin", "bmax")}


def _vox_cache_path(spec: SimSpec, cart_grid: CartGrid) -> Optional[Path]:
    """Cache file of this geometry + grid (None when caching is off).

    The voxelisation depends only on the triangles (mats_hash), the grid and the lattice type --
    not on sources, receivers, materials' absorption, Courant number or duration. Padded domains
    (SimSpec.bmin/bmax) change Nxyz / xyzmin, so they key apart from unpadded ones.
    """
    if spec.vox_cache_dir is None:
        return None
    digest = hashlib.sha1()
    digest.update(json.dumps(spec.scene["mats_hash"], sort_keys=True).encode())
    digest.update(repr((VOX_CACHE_VERSION, float(cart_grid.h), bool(spec.fcc), [int(n) for n in cart_grid.Nxyz],
                        np.asarray(cart_grid.xyzmin, np.float64).tolist())).encode())
    return Path(spec.vox_cache_dir) / f"vox_{digest.hexdigest()}.npz"


def _prune_vox_cache(cache_dir: Path) -> None:
    files = sorted(cache_dir.glob("vox_*.npz"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in files[VOX_CACHE_MAX_ENTRIES:]:
        try:
            stale.unlink()
        except OSError:  # in use by another job; the next prune gets it
            pass


def _voxelise(room_geo: RoomGeo, cart_grid: CartGrid, fcc: bool, cache_file: Optional[Path] = None) -> VoxScene:
    if cache_file is not None and cache_file.exists():
        try:
            with np.load(cache_file) as data:
                fields = {name: data[name] for name in _VOX_CACHE_FIELDS}
        except Exception as exc:  # unreadable / half-written entry: voxelise again
            _print(f"voxelisation cache unreadable ({exc}); voxelising")
            cache_file.unlink(missing_ok=True)
        else:
            os.utime(cache_file)
            vox_scene = VoxScene(room_geo, cart_grid, None, fcc=fcc)
            for name, value in fields.items():
                setattr(vox_scene, name, value)
            vox_scene.beta_bn = None
            vox_scene.vol_bn = None
            _print(f"voxelisation reused from {cache_file.name}")
            return vox_scene

    vox_grid = VoxGrid(room_geo, cart_grid)
    vox_grid.fill(Nprocs=1)
    vox_scene = VoxScene(room_geo, cart_grid, vox_grid, fcc=fcc)
    vox_scene.calc_adj(Nprocs=1)
    if cache_file is not None:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache_file.with_name(f"{cache_file.stem}.{os.getpid()}.tmp.npz")
        np.savez(tmp, **{name: getattr(vox_scene, name) for name in _VOX_CACHE_FIELDS})
        os.replace(tmp, cache_file)
        _prune_vox_cache(cache_file.parent)
    return vox_scene


def _apply_cut_cells(vox_scene: VoxScene, seed_ixyz: np.ndarray, l2: float, vox_cache_file: Optional[Path]) -> None:
    """vox_scene.apply_cut_cells, reusing the result of an earlier run on the same air region.

    The cut cells depend on the voxelisation, l2 and which grid nodes the seed's air component
    covers (not the seed itself), so the key is the flood-fill labelling: a voxel preview and the
    run that follows it (or a second source in the same room) share one entry.
    """
    from voxelizer.cut_cells import flood_air

    if vox_cache_file is None:
        vox_scene.apply_cut_cells(seed_ixyz, l2)
        return
    Nx, Ny, Nz = (int(n) for n in vox_scene.cart_grid.Nxyz)
    order = np.argsort(vox_scene.bn_ixyz)
    flood = flood_air(Nx, Ny, Nz, vox_scene.bn_ixyz[order], vox_scene.adj_bn[order], seed_ixyz)
    digest = hashlib.sha1(np.ascontiguousarray(flood[0]).tobytes())
    digest.update(repr((VOX_CACHE_VERSION, float(l2), int(flood[1]))).encode())
    cut_file = vox_cache_file.with_name(f"{vox_cache_file.stem}_cut_{digest.hexdigest()[:20]}.npz")

    if cut_file.exists():
        try:
            with np.load(cut_file) as data:
                fields = {name: data[name] for name in _CUT_CACHE_FIELDS}
                air_leak = json.loads(str(data["air_leak"]))
        except Exception as exc:  # unreadable / half-written entry: recompute
            _print(f"cut-cell cache unreadable ({exc}); recomputing")
            cut_file.unlink(missing_ok=True)
        else:
            os.utime(cut_file)
            for name, value in fields.items():
                setattr(vox_scene, name, value)
            vox_scene.adj_bn = vox_scene.beta_bn > 0.0
            vox_scene.tidx_bn = None
            vox_scene.air_leak = air_leak
            _print(f"cut cells reused from {cut_file.name}")
            return

    vox_scene.apply_cut_cells(seed_ixyz, l2, flood)
    tmp = cut_file.with_name(f"{cut_file.stem}.{os.getpid()}.tmp.npz")
    np.savez(tmp, air_leak=np.array(json.dumps(getattr(vox_scene, "air_leak", None))),
             **{name: getattr(vox_scene, name) for name in _CUT_CACHE_FIELDS})
    os.replace(tmp, cut_file)
    _prune_vox_cache(cut_file.parent)


@dataclass
class VoxelisedScene:
    """Voxelisation only (no materials, comms or GPU data) -- for the pre-run voxel preview."""
    h: float
    xv: np.ndarray
    yv: np.ndarray
    zv: np.ndarray
    bn_ixyz: np.ndarray
    mat_bn: np.ndarray       # index into mat_names, -1 = rigid (hit from a non-lossy side)
    mat_names: list          # PFFDTD order (alphabetical, _RIGID excluded)
    asymmetric_links: int    # > 0 means the voxeliser produced an unstable boundary

    @property
    def shape(self) -> tuple:
        return (self.xv.size, self.yv.size, self.zv.size)


def voxelise_only(spec: SimSpec, warm_seed_xyz=None) -> VoxelisedScene:
    """Voxelise (cached) for the voxel preview.

    ``warm_seed_xyz`` (the first source of the run to come) also computes the cut cells of that
    source's air region into the cache, so the run starts straight at the GPU data. It does
    not change the returned scene (the staircase voxelisation the preview shows).
    """
    from voxelizer.vox_scene import count_asymmetric_links

    setup_dir = Path(spec.sim_dir).resolve() / SETUP_SUBDIR
    setup_dir.mkdir(parents=True, exist_ok=True)
    model_json = setup_dir / "model.json"
    model_json.write_text(json.dumps(spec.scene))
    with contextlib.chdir(setup_dir):
        bmin = None if spec.bmin is None else np.asarray(spec.bmin, np.float64)
        bmax = None if spec.bmax is None else np.asarray(spec.bmax, np.float64)
        room_geo = RoomGeo(str(model_json), az_el=np.array([0.0, 0.0]), bmin=bmin, bmax=bmax)
        sim_consts = _consts(spec)
        cart_grid = CartGrid(
            h=sim_consts.h, offset=GRID_OFFSET_CELLS, bmin=room_geo.bmin, bmax=room_geo.bmax, fcc=spec.fcc
        )
        vox_cache_file = _vox_cache_path(spec, cart_grid)
        vox_scene = _voxelise(room_geo, cart_grid, spec.fcc, vox_cache_file)
        Nx, Ny, Nz = cart_grid.Nxyz
        n_bad = int(count_asymmetric_links(vox_scene.bn_ixyz, vox_scene.adj_bn, np.int_(vox_scene.VV), Nx, Ny, Nz))
        scene = VoxelisedScene(
            h=float(sim_consts.h), xv=cart_grid.xv, yv=cart_grid.yv, zv=cart_grid.zv,
            bn_ixyz=np.asarray(vox_scene.bn_ixyz, np.int64), mat_bn=np.asarray(vox_scene.mat_bn, np.int64),
            mat_names=[m for m in room_geo.mat_str if m != "_RIGID"], asymmetric_links=n_bad,
        )
        if warm_seed_xyz is not None and vox_cache_file is not None and spec.conformal and not spec.fcc:
            try:
                sim_consts.save(setup_dir)
                cart_grid.save(setup_dir)
                _, seed_ixyz = SimComms(save_folder=setup_dir).get_linear_interp_weights(np.asarray(warm_seed_xyz, np.float64))
                _apply_cut_cells(vox_scene, seed_ixyz, float(sim_consts.l2), vox_cache_file)
            except Exception as exc:  # only a head start for the run: never fail the preview
                _print(f"cut-cell warm-up skipped: {exc}")
    return scene


_FIXED_FIELDS = ("scene", "h", "fmax", "ppw", "fcc", "precision", "mat_files", "courant", "conformal", "Tc", "rh", "bmin", "bmax", "vox_cache_dir")


def _link_or_copy(src: Path, dst: Path) -> None:
    dst.unlink(missing_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def derive(prep: PreparedSim, sim_dir: Path, source_xyz=None, **updates) -> PreparedSim:
    """Re-use prep's voxelisation for another run of the same scene and grid.

    Only the comms (source position, duration, source signal) and the extras (snapshots,
    output plane) change; geometry, materials and grid are linked from prep's setup folder,
    so no voxelisation runs. ``updates`` are SimSpec fields (not the geometry/grid ones).
    """
    fixed = sorted(set(updates) & set(_FIXED_FIELDS))
    assert not fixed, f"derive() cannot change {fixed}; use prepare()"
    spec = replace(prep.spec, sim_dir=Path(sim_dir), **updates)
    if source_xyz is not None:
        scene = dict(spec.scene)
        scene["sources"] = [{"xyz": [float(c) for c in source_xyz]}]
        spec = replace(spec, scene=scene, source_index=0)
    sim_dir = Path(spec.sim_dir).resolve()
    setup_dir = sim_dir / SETUP_SUBDIR
    gpu_dir = sim_dir / GPU_SUBDIR
    setup_dir.mkdir(parents=True, exist_ok=True)
    for f in prep.setup_dir.glob("*.h5"):
        if f.name != "comms_out.h5":
            _link_or_copy(f, setup_dir / f.name)
    (setup_dir / "model.json").write_text(json.dumps(spec.scene))

    Sxyz = np.asarray(spec.scene["sources"][spec.source_index]["xyz"], np.float64)
    Rxyz = np.asarray([r["xyz"] for r in spec.scene["receivers"]], np.float64)
    with contextlib.chdir(setup_dir):
        sim_comms = _build_comms(spec, setup_dir, Sxyz, Rxyz)
        with h5py.File(setup_dir / "vox_out.h5", "r") as f:
            bn_ixyz = f["bn_ixyz"][...]
        sim_comms.check_for_clashes(bn_ixyz)
    if gpu_dir.exists():
        shutil.rmtree(gpu_dir)
    Nt = _finish_gpu_dir(setup_dir, gpu_dir, spec.fcc)
    out = replace(prep, spec=spec, setup_dir=setup_dir, gpu_dir=gpu_dir, Nt=Nt)
    _write_extra(out)
    _print(f"derived {gpu_dir} from {prep.setup_dir} Nt={Nt}")
    return out


def with_extras(prep: PreparedSim, **updates) -> PreparedSim:
    """Change only the extras (snapshots / plane / accumulation) of a prepared run."""
    allowed = {"snapshot_steps", "plane_ixyz", "acc_sos"}
    assert set(updates) <= allowed, f"with_extras() only changes {sorted(allowed)}"
    out = replace(prep, spec=replace(prep.spec, **updates))
    _write_extra(out)
    return out


def snap_courant(h: float, c: float, t_target: float, fcc: bool, factor: float = 1.0) -> tuple[float, int]:
    """Largest Courant number <= factor * l_max (upstream 0.999 back-off) putting t_target on a step.

    Returns (l, n) with n * Ts == t_target.
    """
    l_max = (1.0 if fcc else np.sqrt(1 / 3)) * 0.999 * factor
    Ts_max = h * l_max / c
    n = int(np.ceil(t_target / Ts_max - 1e-9))
    Ts = t_target / n
    return c * Ts / h, n
