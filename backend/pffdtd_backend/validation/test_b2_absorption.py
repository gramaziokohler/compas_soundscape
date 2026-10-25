"""B2: frequency-dependent absorbing wall (material workflow), normal incidence.

A wall at x = 0 gets a material fitted from band absorption coefficients (the same
materials.material_def_file path the backend uses). Source and receiver sit on the wall
normal; the wall reflection is time-gated before any other reflection. Running the same
scene once more with that wall rigid gives the reference reflection, so the ratio of the
two gated reflections is the scheme's reflection factor Q(f) with dispersion/geometry
cancelled. Reference: plane-wave normal-incidence R(f) of the fitted admittance.
Accept: octave-band absorption 1 - |Q|^2 within +/- 0.03 of 1 - |R|^2 (250, 500 Hz).
The fit itself (Sabine target vs fitted random-incidence curve) is reported, not gated.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from pffdtd_backend.engine import run_engine
from pffdtd_backend.materials import material_def_file, normal_incidence_reflection
from pffdtd_backend.outputs import read_receivers
from pffdtd_backend.sim_prepare import SimSpec, prepare
from pffdtd_backend.validation.metrics import dtft
from pffdtd_backend.validation.scenes import box_scene

DIMS = (8.0, 10.0, 10.0)
SOURCE = (3.0, 5.0, 5.0)
RECEIVER = (1.5, 5.0, 5.0)
C_SOUND = 343.2
H = 0.025
ALPHA = [0.05, 0.15, 0.35, 0.6, 0.75, 0.8]
BANDS = [125, 250, 500, 1000, 2000, 4000]
TEST_OCTAVES = [250.0, 500.0]
ALPHA_TOL = 0.03
DF = 1.0


def _gates():
    d_refl = RECEIVER[0] + SOURCE[0]  # image across x = 0
    d_next = np.hypot(SOURCE[0] - RECEIVER[0], 2 * min(SOURCE[1], DIMS[1] - SOURCE[1]))
    d_direct = SOURCE[0] - RECEIVER[0]
    t0 = 0.5 * (d_direct + d_refl) / C_SOUND
    t1 = d_next / C_SOUND - 1e-3
    return t0, t1


def _reflection(work_dir: Path, tag: str, mat_files: dict, face_materials: dict) -> tuple:
    t0, t1 = _gates()
    spec = SimSpec(
        sim_dir=work_dir / f"b2_{tag}",
        scene=box_scene(DIMS, [SOURCE], [RECEIVER], face_materials=face_materials),
        duration=t1 + 1e-3,
        h=H,
        mat_files=mat_files,
    )
    prep = prepare(spec)
    run_engine(prep.gpu_dir, "double")
    r_out, Ts = read_receivers(prep.gpu_dir)
    t = np.arange(r_out.shape[1]) * Ts
    w = ((t >= t0) & (t <= t1)).astype(np.float64)
    return r_out[0] * w, Ts


def run(work_dir: Path, quick: bool = False) -> dict:
    mat = material_def_file(ALPHA, BANDS, work_dir / "materials")
    x_abs, Ts = _reflection(work_dir, "absorbing", {"absorber": mat}, {"x0": "absorber"})
    x_rig, _ = _reflection(work_dir, "rigid", {}, {})
    octaves = []
    for fc in TEST_OCTAVES:
        f = np.arange(fc / np.sqrt(2), fc * np.sqrt(2), DF)
        Q = dtft(x_abs, 1 / Ts, f)[0] / dtft(x_rig, 1 / Ts, f)[0]
        R = normal_incidence_reflection(mat, f)
        a_sim = float(1 - np.mean(np.abs(Q) ** 2))
        a_ref = float(1 - np.mean(np.abs(R) ** 2))
        octaves.append({"octave_hz": fc, "alpha_sim": a_sim, "alpha_theory": a_ref, "pass": abs(a_sim - a_ref) <= ALPHA_TOL})
    return {
        "name": "B2 absorbing wall (normal incidence)",
        "criteria": f"|alpha_sim - alpha_theory| <= {ALPHA_TOL} per octave",
        "target_sabine_alpha": dict(zip(BANDS, ALPHA)),
        "octaves": octaves,
        "pass": all(o["pass"] for o in octaves),
    }


@pytest.mark.gpu
def test_b2_absorption(work_dir, quick):
    result = run(work_dir, quick)
    print(result)
    assert result["pass"], result
