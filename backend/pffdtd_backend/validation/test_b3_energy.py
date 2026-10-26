"""B3: passivity / energy balance, plus long-run stability of the CUDA engine.

1) Upstream numpy engine with its numerical energy computation on a shoebox with two
   frequency-dependent walls (+ grid-edge ABCs): stored + dissipated energy equals the
   injected energy to machine precision -> the boundary model is passive. Also run on the
   room rotated by az 30 / el 20 (Cartesian), which exercises the cut-cell boundaries.
2) CUDA engine, double and single precision (diff source), 1 s of the same lossy room:
   no growth -- the last 100 ms carry less energy than the first 100 ms after the direct
   sound, by at least the margin expected from the room's absorption. Repeated on the
   rotated room (cut cells, incl. small capped cells) in both precisions.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from scipy.signal import butter, sosfilt

from pffdtd_backend.engine import run_engine
from pffdtd_backend.materials import material_def_file
from pffdtd_backend.outputs import read_receivers
from pffdtd_backend.sim_prepare import SimSpec, prepare
from pffdtd_backend.validation.scenes import box_scene, rotation_az_el

BALANCE_TOL = 1e-11
DECAY_MIN_DB = 20.0
HP_UNIFORM_MODE = 20.0  # Hz
ALPHA = [0.1, 0.2, 0.4, 0.6, 0.7, 0.7]
BANDS = [125, 250, 500, 1000, 2000, 4000]
DIMS = (3.2, 2.5, 2.1)
FACES = {"z0": "absorber", "x1": "absorber", "y0": "absorber"}
ROT_AZ_EL = (30.0, 20.0)


def _spec(work_dir: Path, tag: str, duration: float, h: float, fcc: bool, precision: str, rotated: bool = False) -> SimSpec:
    mat = material_def_file(ALPHA, BANDS, work_dir / "materials")
    return SimSpec(
        sim_dir=work_dir / f"b3_{tag}",
        scene=box_scene(DIMS, [(0.9, 0.7, 1.1)], [(2.35, 1.8, 1.3)], face_materials=FACES,
                        rotation=rotation_az_el(*ROT_AZ_EL) if rotated else None),
        duration=duration,
        h=h,
        fcc=fcc,
        precision=precision,
        mat_files={"absorber": mat},
    )


def energy_balance(work_dir: Path, fcc: bool, rotated: bool = False) -> dict:
    from fdtd.sim_fdtd import SimEngine

    grid = ("fcc" if fcc else "cart") + ("_rot" if rotated else "")
    prep = prepare(_spec(work_dir, f"energy_{grid}", 0.05, 0.1, fcc, "double", rotated))
    eng = SimEngine(prep.setup_dir, energy_on=True)
    eng.load_h5_data()
    eng.setup_mask()
    eng.allocate_mem()
    eng.set_coeffs()
    eng.checks()
    eng.run_all(1)
    H, E_lost, E_in = eng.H_tot, eng.E_lost[:-1], eng.E_in[:-1]
    n0 = int(np.argmax(np.abs(E_in) > 0)) + 1
    rel = np.abs(H[n0:] + E_lost[n0:] - E_in[n0:]) / np.abs(E_in[n0:])
    return {"grid": grid, "max_rel_imbalance": float(rel.max()), "pass": float(rel.max()) <= BALANCE_TOL}


def long_run(work_dir: Path, precision: str, rotated: bool = False) -> dict:
    prep = prepare(_spec(work_dir, f"long_{precision}{'_rot' if rotated else ''}", 1.0, 0.05, False, precision, rotated))
    run_engine(prep.gpu_dir, precision)
    r_out, Ts = read_receivers(prep.gpu_dir)
    # admittances vanish at 0 Hz, so the uniform mode (a ramp for a unit-sample source)
    # never decays; a 4th-order high-pass removes it before measuring the decay
    x = sosfilt(butter(4, HP_UNIFORM_MODE, btype="high", fs=1 / Ts, output="sos"), r_out[0])
    n100 = int(0.1 / Ts)
    e_early = float(np.sum(x[int(0.02 / Ts) : int(0.02 / Ts) + n100] ** 2))
    e_late = float(np.sum(x[-n100:] ** 2))
    decay = 10 * np.log10(e_early / e_late)
    finite = bool(np.all(np.isfinite(x)))
    return {"precision": precision, "rotated": rotated, "decay_db": float(decay), "finite": finite, "pass": finite and bool(decay >= DECAY_MIN_DB)}


def run(work_dir: Path, quick: bool = False) -> dict:
    bal = [energy_balance(work_dir, fcc) for fcc in (False, True)] + [energy_balance(work_dir, False, rotated=True)]
    longs = [long_run(work_dir, p, rot) for rot in (False, True) for p in ("double", "single")]
    return {
        "name": "B3 passivity and long-run stability",
        "criteria": f"energy imbalance <= {BALANCE_TOL:g}; 1 s run decays >= {DECAY_MIN_DB} dB, no blow-up",
        "energy": bal,
        "long_run": longs,
        "pass": all(b["pass"] for b in bal) and all(lr["pass"] for lr in longs),
    }


@pytest.mark.gpu
def test_b3_energy(work_dir, quick):
    result = run(work_dir, quick)
    print(result)
    assert result["pass"], result
