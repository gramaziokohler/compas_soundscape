# Vendored PFFDTD

- Upstream: https://github.com/bsxfun/pffdtd (MIT, Copyright 2021 Brian Hamilton), see `LICENSE`.
- Commit: `aa319f6c86517cb95aabfae8656277da62c3ead5` (2021-07-25).
- Copied: `python/` and `c_cuda/`. Not copied: `data/` (models under other licences, sample
  materials), `ruby_SU/`, `benchmarks/`, and the `python/test_script_*.py` examples.

Every local change is marked with a `compas:` comment.

## Engine (`c_cuda/`)

| File | Change |
| --- | --- |
| `build_engine.ps1` (new) | Windows build: `vcvars64` + `nvcc -arch=sm_89`, HDF5 from the `compas-pffdtd` env, `/openmp`. Replaces the Linux `Makefile` (kept for reference). Output in `c_cuda/bin/` (gitignored). |
| `helper_funcs.h` and all users | Type enum values renamed `PF_FLOAT64/PF_INT64/...` (`INT8`, `INT64`, `BOOL` clash with Windows typedefs). |
| `fdtd_common.h` | Removed `<sys/ioctl.h>`; the ANSI progress bar is replaced by parseable lines `PFFDTD_PROGRESS <pct> <elapsed_s> <eta_s> <Mvox/s>` (~every 1%). |
| `fdtd_data.h`, `gpu_engine.h` | `%ld` to `%lld` for `int64_t` (Windows `long` is 32-bit). |
| `fdtd_data.h` | Optional `compas_extra.h5`: initial conditions `u_ic_prev` (u^-1) and `u_ic_curr` (u^0), plus snapshot steps `snap_steps`. The ICs share the input scaling. New `write_snapshot()` writes `snap_out.h5`. |
| `fdtd_data.h`, `gpu_engine.h` | Cut cells: optional `beta_bn`/`vol_bn` in `vox_out.h5` become link weights `wgt_bn = beta/vol` (+ their sum `W_bn`), and `ssaf_bnl` is divided by `vol`. New `KernelBoundaryCutCart` replaces `KernelBoundaryRigidCart` when they are present. `cpu_engine.h` refuses them. |
| `gpu_engine.h` | `print_gpu_details` reads the memory clock with `cudaDeviceGetAttribute(cudaDevAttrMemoryClockRate)` (`cudaDeviceProp::memoryClockRate` was removed in CUDA 13). |
| `gpu_engine.h` | VLA `Nxcc[ngpus]` changed to malloc. IC upload to `u0`/`u1`. Full-field snapshots of u^n at the requested steps (single GPU only; n = Nt is supported). |
| `fdtd_data.h` | Optional output plane in `compas_extra.h5`: `plane_ixyz` (engine-layout node indices) and `acc_sos` (`[S, 6]` band-pass cascade). New `write_plane_accum()` writes `plane_out.h5:p2_acc`. |
| `gpu_engine.h` | With `plane_ixyz`, snapshots gather only the plane nodes. New `KernelAccumPlane` runs each step next to the readouts. It band-passes u^n per plane node (DF2T biquads, double state on the device) and accumulates y², rescaled by infac² at the end. Single GPU, Cartesian only. |

## Python (`python/`)

| File | Change |
| --- | --- |
| `common/myfuncs.py` | `np.float` changed to `np.float64` (removed in numpy >= 1.24). |
| `voxelizer/vox_scene.py` | `np.bool8` changed to `np.bool_` (numpy 2). Dropped the `memory_profiler` import. |
| `voxelizer/vox_scene.py`, `voxelizer/vox_grid_base.py` | Multiprocess workers are closures that need `fork`, so they fall back to one process under `spawn` (Windows). Numpy views of `SharedMemory` are released before `close()` (Windows refuses otherwise). |
| `voxelizer/vox_scene.py` | **Bug fix:** links are symmetrised after voxelisation. "Near boundary" nodes had all their links cut while neighbours kept links to them, creating pressure-release points. New `symmetrise_adjacency` and `count_asymmetric_links`. The upstream `nb_check_adj_full*` asserts (`~(a ^ b)`, always truthy; FCC pairs the wrong neighbours) are replaced by a real check that runs on every prepare. |
| `voxelizer/cart_grid.py` | Bounds assert tolerates float rounding (`ceil` of an exact integer ratio). |
| `fdtd/sim_consts.py` | Optional Courant override `l=` (used to snap `Ts` and for the Courant sweep). |
| `voxelizer/cut_cells.py`, `voxelizer/cut_cell_geom.py` (new) | **Conformal (cut-cell) boundaries**, Cartesian only. Air = the binary-link component of the source (flood fill). Each cell a wall passes through gets its air volume fraction `vol_bn` and the open fraction of each face `beta_bn` (exact for planar walls, by convex clipping). The lossy wall area `saf_bn` is the true area in the cell. Cells whose node lies outside the air but that hold air join it as small cut cells. Stability (`vol >= (l²/2)·Σbeta`): small cells borrow volume from cells with spare volume up to 6 open faces away. The total volume is unchanged; capping or merging was measured to be 1st order (see `validation/REPORT.md`). Cells with no lender get their faces scaled down. Two-sided surfaces and mixed convex/reflex cells fall back to the staircase. |
| `voxelizer/vox_scene.py` | `apply_cut_cells()`, keeps `tidx_bn`, saves `beta_bn`/`vol_bn` when present. |
| `fdtd/sim_fdtd.py` | Cut cells: boundary stencil weighted by `beta/vol` (`nb_stencil_bn_cart_cut`), lossy update by `saf/vol`, energy weighted by `vol` (B3 balance holds to 1e-13). |
| `fdtd/rotate_sim_data.py` | `beta_bn`/`vol_bn` are sorted (and permuted on rotation) with the other boundary data; FCC folding refuses them. |

## compas driver (new, outside upstream files)

- `sim_prepare.py`: scene dict + DEF files to a run folder. It does setup and voxelisation,
  copies the GPU data, folds FCC and sorts, and writes `compas_extra.h5`. It replaces
  `sim_setup.py` for single-GPU use, so there is no axis rotation. `SimSpec.conformal` (default
  on, ignored for FCC) applies the cut cells after voxelisation.
- `engine.py`: runs the exe with HDF5 DLLs on PATH, parses progress, and can be cancelled.
- `sim_prepare.py` `derive()`: re-uses a prepared voxelisation for another source position,
  duration, source signal or extras. Only the comms are rebuilt; setup files are hard-linked.
  The pipeline voxelises once per job. `voxelise_only()` backs the voxel preview.
- `outputs.py`: trilinear recombination, the exact inverse of `diff_source`, and snapshot
  unfolding. Also the output plane: `plane_nodes()` (decimated z-plane + wall mask),
  `read_plane_accum()`, and plane snapshots.
- `fields.py`: strength G (dB re free field at 10 m) from the accumulated band-passed p²,
  the one-cycle band-limited pulse for the wave animation, and int8 frame quantisation.
- `materials.py`: band absorption is interpolated to the 11 PFFDTD octaves and fitted
  with `fit_to_Sabs_oct_11` into a hash-cached DEF file.
- `postprocess.py`: low-cut (uniform mode), resample to 48 kHz with unit-sample scaling,
  zero-phase low-pass at fmax, Stokes air absorption, and FOA from pressure-gradient probes.
- `pipeline.py`: the job CLI that the backend workers (`services/pffdtd_job.py`,
  `services/pffdtd_preview_job.py`) run with the `compas-pffdtd` interpreter. It has a simulation
  mode (IRs, SPL map, animation) and a `voxel_preview` mode (voxelise and check the grid). It reports progress on stdout and stops the engine if its
  parent dies.
- `validation/`: tests A1–A4 and B1–B3 plus `run_validation.py`.
