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
| `gpu_engine.h` | VLA `Nxcc[ngpus]` changed to malloc. IC upload to `u0`/`u1`. Full-field snapshots of u^n at the requested steps (single GPU only; n = Nt is supported). |

## Python (`python/`)

| File | Change |
| --- | --- |
| `common/myfuncs.py` | `np.float` changed to `np.float64` (removed in numpy >= 1.24). |
| `voxelizer/vox_scene.py` | `np.bool8` changed to `np.bool_` (numpy 2). Dropped the `memory_profiler` import. |
| `voxelizer/vox_scene.py`, `voxelizer/vox_grid_base.py` | Multiprocess workers are closures that need `fork`, so they fall back to one process under `spawn` (Windows). Numpy views of `SharedMemory` are released before `close()` (Windows refuses otherwise). |
| `voxelizer/vox_scene.py` | **Bug fix:** links are symmetrised after voxelisation. "Near boundary" nodes had all their links cut while neighbours kept links to them, creating pressure-release points. New `symmetrise_adjacency` and `count_asymmetric_links`. The upstream `nb_check_adj_full*` asserts (`~(a ^ b)`, always truthy; FCC pairs the wrong neighbours) are replaced by a real check that runs on every prepare. |
| `voxelizer/cart_grid.py` | Bounds assert tolerates float rounding (`ceil` of an exact integer ratio). |
| `fdtd/sim_consts.py` | Optional Courant override `l=` (used to snap `Ts` and for the Courant sweep). |

## compas driver (new, outside upstream files)

- `sim_prepare.py`: scene dict + DEF files to a run folder. It does setup and voxelisation,
  copies the GPU data, folds FCC and sorts, and writes `compas_extra.h5`. It replaces
  `sim_setup.py` for single-GPU use, so there is no axis rotation.
- `engine.py`: runs the exe with HDF5 DLLs on PATH, parses progress, and can be cancelled.
- `outputs.py`: trilinear recombination, the exact inverse of `diff_source`, and snapshot
  unfolding.
- `materials.py`: band absorption is interpolated to the 11 PFFDTD octaves and fitted
  with `fit_to_Sabs_oct_11` into a hash-cached DEF file.
- `postprocess.py`: low-cut (uniform mode), resample to 48 kHz with unit-sample scaling,
  zero-phase low-pass at fmax, Stokes air absorption, and FOA from pressure-gradient probes.
- `pipeline.py`: the job CLI that the backend worker (`services/pffdtd_job.py`) runs with the
  `compas-pffdtd` interpreter. It reports progress on stdout and stops the engine if its
  parent dies.
- `validation/`: tests A1–A4 and B1–B3 plus `run_validation.py`.
