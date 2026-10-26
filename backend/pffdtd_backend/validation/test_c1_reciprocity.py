"""C1: reciprocity, the basis of free positioning (free_runs.py / free_ir.py).

Shoebox with one absorbing floor and one absorbing wall, Cartesian grid, double precision.
Raw sim-rate signals (no post-processing) are compared:

- monopole: IR(S -> L) == IR(L -> S)
- FOA listener: the forward 7-probe channels at L (foa_channels) == the reciprocal W run plus
  one +/- monopole pair run per axis at L (free_ir.reciprocal_channels), recorded at S
- source dipole: a forward +/- monopole pair at S along x, heard at L (free_ir.dipole_channel)
  == the X channel of 7 reciprocal probes at S (monopole at L); and a cardioid aimed at the
  listener (free_ir.directional) carries much more direct sound than one aimed away
  (the pattern maximum points along n)
Accept: relative max difference <= 1e-8; cardioid front/back >= 15 dB (direct sound, < 500 Hz).

Also (no GPU): the compiled air-absorption filter equals upstream's, and the candidate grid
keeps its clearance and fits its caps.
"""

from __future__ import annotations

import contextlib
import io
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy.signal import butter, sosfiltfilt

from pffdtd_backend.engine import run_engine
from pffdtd_backend.free_grid import candidate_grid
from pffdtd_backend.free_ir import dipole_channel, dipole_points, directional, reciprocal_channels
from pffdtd_backend.materials import material_def_file
from pffdtd_backend.outputs import read_receivers
from pffdtd_backend.postprocess import foa_channels, probe_positions
from pffdtd_backend.sim_prepare import SimSpec, prepare
from pffdtd_backend.validation.scenes import box_scene

RECIPROCITY_TOL = 1e-8
CARDIOID_FRONT_BACK_DB = 15.0
H = 0.05
DURATION = 0.03
DIMS = (3.2, 2.5, 2.1)
S = (0.9, 0.7, 1.1)
L = (2.35, 1.8, 1.3)
ALPHA = [0.1, 0.2, 0.4, 0.6, 0.7, 0.7]
BANDS = [125, 250, 500, 1000, 2000, 4000]
LOWPASS_HZ = 500.0  # well inside the grid's accurate band (c / (10 h) ~ 690 Hz)


def _run(work_dir: Path, name: str, mat: Path, source, receivers, source_points=None):
    scene = box_scene(DIMS, [source], receivers, face_materials={"z0": "absorber", "x1": "absorber"})
    spec = SimSpec(sim_dir=work_dir / f"c1_{name}", scene=scene, duration=DURATION, h=H,
                   mat_files={"absorber": mat}, source_points=source_points)
    with contextlib.redirect_stdout(sys.stderr):
        prep = prepare(spec)
    run_engine(prep.gpu_dir, "double")
    r_out, Ts = read_receivers(prep.gpu_dir)
    return r_out, Ts, prep.c


def _rel(a, b) -> float:
    a, b = np.asarray(a), np.asarray(b)
    return float(np.max(np.abs(a - b)) / np.max(np.abs(b)))


def run(work_dir: Path, quick: bool = False) -> dict:
    mat = material_def_file(ALPHA, BANDS, work_dir / "materials")
    off = H  # probes / pairs one cell away (PFFDTD_FOA_OFFSET_CELLS = 1)

    # monopole + FOA listener: forward run with 7 probes at L
    fwd, Ts, c = _run(work_dir, "fwd_foa", mat, S, probe_positions(np.array(L), True, off))
    rec_w, _, _ = _run(work_dir, "rec_w", mat, L, [S])
    mono = _rel(rec_w[0], fwd[0])
    axes = {a: _run(work_dir, f"rec_{a}", mat, L, [S], source_points=dipole_points(L, a, off))[0][0] for a in "XYZ"}
    foa = _rel(reciprocal_channels(rec_w[0], axes, Ts, off, c), foa_channels(fwd, Ts, off, c))

    # source dipole along x: forward pair at S heard at L == reciprocal x-gradient at S
    pair, _, _ = _run(work_dir, "fwd_pair_x", mat, S, [L], source_points=dipole_points(S, "X", off))
    rec7, _, _ = _run(work_dir, "rec_probes", mat, L, probe_positions(np.array(S), True, off))
    ch = foa_channels(rec7, Ts, off, c)  # [W, Y, Z, X] at S, u pointing toward L
    dipole = _rel(dipole_channel(pair[0], Ts, off, c), ch[3])

    # cardioid aimed at / away from the listener: direct sound only (before the first reflection)
    sos = butter(4, LOWPASS_HZ, btype="low", fs=1.0 / Ts, output="sos")
    w, xyz = ch[0], ch[[3, 1, 2]]
    n = np.subtract(L, S) / np.linalg.norm(np.subtract(L, S))
    r = float(np.linalg.norm(np.subtract(L, S)))
    win = slice(0, int(round((r / c + 0.002) / Ts)))

    def direct_db(direction):
        y = sosfiltfilt(sos, directional(w, xyz, 0.5, direction))
        return 10 * np.log10(np.sum(y[win] ** 2))

    front_back = direct_db(n) - direct_db(-n)
    cases = [
        {"case": "monopole S<->L", "rel_max_diff": mono, "pass": mono <= RECIPROCITY_TOL},
        {"case": "FOA listener (W + 3 pair runs)", "rel_max_diff": foa, "pass": foa <= RECIPROCITY_TOL},
        {"case": "source dipole x (pair vs probes)", "rel_max_diff": dipole, "pass": dipole <= RECIPROCITY_TOL},
        {"case": "cardioid front/back (direct, dB)", "value": front_back, "pass": front_back >= CARDIOID_FRONT_BACK_DB},
    ]
    return {
        "name": "C1 reciprocity (free positioning)",
        "criteria": f"relative max difference <= {RECIPROCITY_TOL:g}; cardioid front/back >= {CARDIOID_FRONT_BACK_DB:g} dB",
        "cases": cases,
        "pass": all(c["pass"] for c in cases),
    }


@pytest.mark.gpu
def test_c1_reciprocity(work_dir, quick):
    result = run(work_dir, quick)
    print(result)
    assert result["pass"], result


def test_compiled_visco_filter_matches_upstream():
    from air_abs.visco_filter import apply_visco_filter as upstream

    from pffdtd_backend.air_absorption import apply_visco_filter

    x = np.random.default_rng(1).standard_normal((2, 6000)) * np.exp(-np.arange(6000) / 1500)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        ref = upstream(x, 48000.0, Tc=20.0, rh=50.0)
    assert np.allclose(apply_visco_filter(x, 48000.0, 20.0, 50.0), ref, rtol=0, atol=1e-12 * np.abs(ref).max())


def test_candidate_grid_clearance_and_caps():
    h = 0.05
    xv, yv, zv = (np.arange(-4, n + 4) * h for n in (60, 40, 30))  # box 3 x 2 x 1.5 m + halo
    Ny, Nz = yv.size, zv.size
    IX, IY, IZ = np.meshgrid(*(np.arange(v.size) for v in (xv, yv, zv)), indexing="ij")
    wall = (IX == 4) | (IX == 64) | (IY == 4) | (IY == 44) | (IZ == 4) | (IZ == 34)
    inside = (IX >= 4) & (IX <= 64) & (IY >= 4) & (IY <= 44) & (IZ >= 4) & (IZ <= 34)
    bn = (IX * Ny * Nz + IY * Nz + IZ)[wall & inside]
    args = dict(bmin=(0, 0, 0), bmax=(3.0, 2.0, 1.5), seeds=[(1.5, 1.0, 0.7)], clearance_m=3 * h,
                n_probe=7, Nt=1000, n_runs=1, max_disk_bytes=1e12, max_label_nodes=10**8)
    g = candidate_grid(xv, yv, zv, bn, spacing_m=0.25, max_record_bytes=1e12, **args)
    assert g.stride == 5 and g.n_points > 0 and g.connectivity_checked
    bn_pos = np.c_[xv[bn // (Ny * Nz)], yv[(bn // Nz) % Ny], zv[bn % Nz]]
    d = np.min(np.linalg.norm(g.xyz[:, None, :] - bn_pos[None, ::7, :], axis=2), axis=1)
    assert np.all(d >= 3 * h - 1e-9)
    assert np.all(g.probe_ixyz[:, 1] - g.probe_ixyz[:, 0] == Ny * Nz)  # +x probe one node over
    cap = g.n_points * 7 * 1000 * 8 / 3  # a third of the full-spacing recording
    coarse = candidate_grid(xv, yv, zv, bn, spacing_m=0.25, max_record_bytes=cap, **args)
    assert coarse.stride > g.stride and coarse.n_points * 7 * 1000 * 8 <= cap
