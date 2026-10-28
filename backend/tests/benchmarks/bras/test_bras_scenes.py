"""BRAS reference scenes vs the PFFDTD worker pipeline (scene inputs linked in scenes.py).

Needs the scene's files and, for the simulations, the compas-pffdtd env + CUDA engine. From backend/
with the compas-toy python:

    python -m pytest tests/benchmarks/bras -m bras_benchmark -s                    # smoke pairs, first stage
    BRAS_FULL=1 python -m pytest tests/benchmarks/bras -m bras_benchmark -s        # every pair
    BRAS_SCENE=RS2_1m_absorbing BRAS_FMAX=2000 BRAS_FULL=1 python -m pytest ...    # another scene / stage

Outputs: backend/temp/benchmarks/bras/<scene>/f<fmax>/ (report.md, plots/, animation/*.mp4).
The assertions are sanity checks; the comparison itself is the report.
"""
import os
from dataclasses import replace

import numpy as np
import pytest

from benchmarks.bras import bras_constants as K
from benchmarks.bras.bras_analysis import edge_echo_delay_s, floor_delay_s, prepare_sim
from benchmarks.bras.bras_benchmark import options_from_env, run_benchmark
from benchmarks.bras.bras_domain import domain_plan
from benchmarks.bras.bras_geometry import SceneMesh, box, control_scene_geometry, scene_geometry
from benchmarks.bras.bras_runner import RunConfig, simulate
from benchmarks.bras.bras_signal import band_energy_db, gate, spectrum
from benchmarks.bras.scenes import GroundPlane
from config.constants import PFFDTD_SPEED_OF_SOUND
from services.pffdtd_job import pffdtd_available

pytestmark = pytest.mark.bras_benchmark
needs_gpu = pytest.mark.skipif(pffdtd_available() is not None, reason=str(pffdtd_available()))


def test_scene_inputs(scene_data):
    """Every pair loads, the gain pair exists, measured onsets match the geometry (line-of-sight pairs)."""
    from benchmarks.bras.bras_scene import pair_geometry, speed_of_sound

    scene, mesh = scene_data.scene, scene_data.mesh
    keys = [p.key for p in scene_data.measured]
    assert keys and scene.gain_pair in keys and set(scene.smoke_pairs) <= set(keys)
    assert all(m in scene.materials for m in mesh.materials)
    c = speed_of_sound(scene.temperature_c)
    for p in scene_data.measured:
        g = pair_geometry(p, mesh.vertices, mesh.faces, scene.source, c)
        if g.line_of_sight:
            onset = np.argmax(np.abs(p.ir) > 0.1 * np.abs(p.ir).max()) / p.fs
            assert abs(onset - g.t_direct) < K.ONSET_TOL_S, (p.key, onset, g.t_direct)


def _check(out: dict) -> None:
    for r in out["results"]:
        print(f"{r.key:10s} los={r.line_of_sight!s:5s} mean|dL| {r.mean_abs_dl_db:5.2f} dB  max {r.max_abs_dl_db:5.2f}  "
              f"direct {r.direct_level_db}")
        if r.line_of_sight and (r.offaxis_deg is None or r.offaxis_deg <= K.DIRECT_LEVEL_MAX_OFFAXIS_DEG):
            assert abs(r.direct_level_db) <= K.DIRECT_LEVEL_TOL_DB, (r.key, r.direct_level_db)
    out_dir = out["out_dir"]
    assert (out_dir / "report.md").exists() and (out_dir / "plots" / "average.png").exists()
    assert len(list((out_dir / "plots").glob("pair_*.png"))) == len(out["results"])
    if out["animation_files"]:
        assert any(p.suffix == ".mp4" for p in out["animation_files"])
    print(f"mean |dL| {out['average']['mean_abs_dl_db']:.2f} dB, global gain {out['gain_db']:+.2f} dB -> {out_dir}")


@needs_gpu
def test_scene_smoke(scene_data):
    _check(run_benchmark(scene_data, options_from_env(scene_data)))


@needs_gpu
@pytest.mark.skipif(not os.environ.get(K.ENV_FULL), reason=f"set {K.ENV_FULL}=1 for every pair")
def test_scene_full(scene_data):
    _check(run_benchmark(scene_data, options_from_env(scene_data)))


@needs_gpu
def test_ground_plane_reflection(tmp_path):
    """Hemi-anechoic path (no measurement): a rigid floor spanning the padded domain reflects like an
    image source: arrival at the image path, level d / r re the direct sound."""
    fmax, ppw, duration = 500.0, 12.0, 0.035
    src, rcv = np.array([0.0, -1.0, 1.5]), np.array([0.0, 1.0, 1.5])  # floor echo 4.7 ms, domain edge >= 12 ms
    mv, mf = box((3.0, 3.0, 0.0), (3.05, 3.05, 0.05))   # something on the floor, far from both
    mesh = SceneMesh(mv, mf, [""] * len(mf), ["obj"] * len(mf), mv.min(axis=0), mv.max(axis=0))
    rigid = {"coeffs": [1e-3] * 6, "center_freqs": [125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0]}
    coeffs = {"obj": rigid, "floor": rigid}
    ground = GroundPlane(z=0.0, material="floor")
    plan = domain_plan(mesh.bmin, mesh.bmax, np.vstack([src, rcv]), fmax, ppw, duration, 3.0, ground_z=0.0)
    bounds = (plan.bmin, plan.bmax)
    pairs_data = [{"source_id": "S", "source_position": src.tolist(), "receiver_id": "R", "receiver_position": rcv.tolist()}]
    cfg = RunConfig(scene="ground_test", fmax=fmax, ppw=ppw, grid_spacing=plan.h, duration=duration,
                    pair_keys=["S-R"], directional=False)
    run = simulate(cfg, scene_geometry(mesh, coeffs, ground, bounds, plan.h), pairs_data, bounds, True, out_root=tmp_path)
    ctl = simulate(replace(cfg, control=True), control_scene_geometry(mesh, coeffs, ground, bounds, plan.h), pairs_data,
                   bounds, True, out_root=tmp_path)
    d = float(np.linalg.norm(rcv - src))
    floor = floor_delay_s(src, rcv, 0.0)
    echo = edge_echo_delay_s(src, rcv, *bounds, ground_z=0.0)
    assert echo > floor + 0.004, (echo, floor)
    fs = K.ANALYSIS_FS
    ir = prepare_sim(run.irs["S-R"], ctl.irs["S-R"], d, echo, int(duration * fs), None, floor)
    t_d, t_r = d / PFFDTD_SPEED_OF_SOUND, d / PFFDTD_SPEED_OF_SOUND + floor
    half = 0.45 * floor
    direct = gate(ir, fs, t_d - half, t_d + half, 0.0005, 0.0005)
    refl = gate(ir, fs, t_r - half, t_r + half, 0.0005, 0.0005)
    f, Hd = spectrum(direct, fs)
    _, Hr = spectrum(refl, fs)
    ratio = band_energy_db(f, Hr, 100.0, 400.0) - band_energy_db(f, Hd, 100.0, 400.0)
    r = d + floor * PFFDTD_SPEED_OF_SOUND
    expected = 20.0 * np.log10(d / r)
    print(f"floor reflection {ratio:+.2f} dB re direct (image source {expected:+.2f} dB), h {plan.h * 1e3:.1f} mm")
    assert abs(ratio - expected) < 1.5
    env = np.abs(refl)
    assert abs(np.argmax(env) / fs - t_r) < 0.5e-3
