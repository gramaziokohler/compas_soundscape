"""B1: CUDA engine (double) vs upstream numpy engine, bit-level agreement.

Same prepared scene (shoebox with two fitted frequency-dependent walls, so the rigid,
lossy and grid-edge ABC paths are all exercised), Cartesian and FCC, plus the same room
rotated (az 30, el 20) on Cartesian so the cut-cell (conformal) boundary path is compared
too. The GPU runs on sorted (and, for FCC, folded) data; the numpy engine on the unfolded
setup data.
Accept: max |u_gpu - u_np| / max |u_np| <= 1e-10.
"""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
import pytest

from pffdtd_backend.engine import run_engine
from pffdtd_backend.materials import material_def_file
from pffdtd_backend.sim_prepare import SimSpec, prepare
from pffdtd_backend.validation.scenes import box_scene, rotation_az_el

PARITY_TOL = 1e-10
H = 0.05
DURATION = 0.01
ALPHA = [0.1, 0.2, 0.4, 0.6, 0.7, 0.7]
BANDS = [125, 250, 500, 1000, 2000, 4000]
ROT_AZ_EL = (30.0, 20.0)  # rotated case: oblique walls -> cut cells


def _numpy_engine(setup_dir: Path) -> np.ndarray:
    from fdtd.sim_fdtd import SimEngine

    eng = SimEngine(setup_dir, energy_on=False)
    eng.load_h5_data()
    eng.setup_mask()
    eng.allocate_mem()
    eng.set_coeffs()
    eng.checks()
    eng.run_all(1)
    return eng.u_out[eng.out_reorder, :]


def run_case(work_dir: Path, fcc: bool, rotated: bool = False) -> dict:
    mat = material_def_file(ALPHA, BANDS, work_dir / "materials")
    scene = box_scene(
        (3.2, 2.5, 2.1),
        [(0.9, 0.7, 1.1)],
        [(2.35, 1.8, 1.3), (1.6, 1.25, 0.6)],
        face_materials={"z0": "absorber", "x1": "absorber"},
        rotation=rotation_az_el(*ROT_AZ_EL) if rotated else None,
    )
    grid = ("fcc" if fcc else "cart") + ("_rot" if rotated else "")
    spec = SimSpec(
        sim_dir=work_dir / f"b1_{grid}",
        scene=scene,
        duration=DURATION,
        h=H,
        fcc=fcc,
        mat_files={"absorber": mat},
    )
    prep = prepare(spec)
    run_engine(prep.gpu_dir, "double")
    with h5py.File(prep.gpu_dir / "sim_outs.h5", "r") as f:
        u_gpu = f["u_out"][...]
    u_np = _numpy_engine(prep.setup_dir)
    rel = float(np.max(np.abs(u_gpu - u_np)) / np.max(np.abs(u_np)))
    return {"grid": grid, "steps": prep.Nt, "rel_max_diff": rel, "pass": rel <= PARITY_TOL}


def run(work_dir: Path, quick: bool = False) -> dict:
    cases = [run_case(work_dir, fcc) for fcc in (False, True)] + [run_case(work_dir, False, rotated=True)]
    return {
        "name": "B1 CUDA vs numpy engine parity",
        "criteria": f"relative max difference <= {PARITY_TOL:g}",
        "cases": cases,
        "pass": all(c["pass"] for c in cases),
    }


@pytest.mark.gpu
def test_b1_parity(work_dir, quick):
    result = run(work_dir, quick)
    print(result)
    assert result["pass"], result
