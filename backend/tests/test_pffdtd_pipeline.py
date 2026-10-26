# backend/tests/test_pffdtd_pipeline.py
"""End-to-end run of the PFFDTD worker (direct geometry -> mesh prep -> compas-pffdtd
pipeline -> CUDA engine -> WAV/metrics/results JSON).

Skipped unless the compas-pffdtd env (PFFDTD_PYTHON) and the built engine are present.
An axis-aligned, inward-wound shoebox exercises: material id + coefficient-dict
resolution, grid alignment to the bounding box, the IR scale (re free field at 1 m: 1/r),
arrival time, reverberant decay, and FOA channel directions.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, sosfiltfilt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from config.constants import AUDIO_SAMPLE_RATE  # noqa: E402
import services.pffdtd_animation_job as pffdtd_animation_job  # noqa: E402
import services.pffdtd_job as pffdtd_job  # noqa: E402
from services.pffdtd_job import pffdtd_available, run_pffdtd_simulation_from_geometry  # noqa: E402
from services.pyroomacoustics_service import PyroomacousticsService  # noqa: E402

pytestmark = pytest.mark.skipif(pffdtd_available() is not None, reason=str(pffdtd_available()))

DIMS = (4.0, 3.0, 2.5)
SOURCE = [1.0, 1.5, 1.2]
RECEIVER_X = [3.0, 1.5, 1.2]   # straight down +x from the source
RECEIVER_2 = [2.6, 2.2, 1.6]
C = 343.2
FMAX = 500.0
PPW = 12.0
DURATION = 0.5
WALL_ABSORPTION = {"coeffs": [0.1, 0.15, 0.2, 0.25, 0.3, 0.3], "center_freqs": [125, 250, 500, 1000, 2000, 4000]}


def _shoebox_inward():
    Lx, Ly, Lz = DIMS
    v = [[0, 0, 0], [Lx, 0, 0], [Lx, Ly, 0], [0, Ly, 0], [0, 0, Lz], [Lx, 0, Lz], [Lx, Ly, Lz], [0, Ly, Lz]]
    # outward-wound faces (the mesh service re-orients from the air side)
    quads = {"floor": [0, 3, 2, 1], "ceiling": [4, 5, 6, 7], "walls": None}
    walls = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    faces, ranges = [], {}
    for name in ("floor", "ceiling"):
        a, b, c, d = quads[name]
        ranges[name] = [len(faces), len(faces) + 1]
        faces += [[a, b, c], [a, c, d]]
    start = len(faces)
    for a, b, c, d in walls:
        faces += [[a, b, c], [a, c, d]]
    ranges["walls"] = [start, len(faces) - 1]
    return v, faces, ranges


def _pairs():
    return [
        {"source_id": "s1", "source_position": SOURCE, "receiver_id": "rx", "receiver_position": RECEIVER_X},
        {"source_id": "s1", "source_position": SOURCE, "receiver_id": "r2", "receiver_position": RECEIVER_2},
    ]


def _geometry():
    v, f, ranges = _shoebox_inward()
    db_id = next(iter(next(iter(PyroomacousticsService.get_material_database().values()))))
    materials = {"floor": db_id, "ceiling": WALL_ABSORPTION, "walls": WALL_ABSORPTION}
    face_materials = {i: materials[name] for name, (a, b) in ranges.items() for i in range(a, b + 1)}
    return {"vertices": v, "faces": f, "object_face_ranges": ranges, "face_materials": face_materials}


def _run(tmp_path, mode, pairs=None, tag=None, air_absorption=True, **field):
    tag = tag or mode
    result_file = tmp_path / f"result_{tag}.json"
    run_pffdtd_simulation_from_geometry(
        simulation_id=f"test_{tag}",
        progress_file=str(tmp_path / f"progress_{tag}.json"),
        result_file=str(result_file),
        geometry=_geometry(),
        pairs_data=pairs or _pairs(),
        simulation_mode=mode,
        fmax=FMAX,
        ppw=PPW,
        duration=DURATION,
        air_absorption=air_absorption,
        simulation_name="pffdtd-test",
        rir_output_dir=str(tmp_path),
        temp_dir=str(tmp_path),
        **field,
    )
    result = json.loads(result_file.read_text())
    assert result["type"] == "done", result.get("message", "") + "\n" + result.get("traceback", "")
    results = json.loads((tmp_path / result["result"]["results_file"]).read_text())
    return result, results


def test_pffdtd_mono_end_to_end(tmp_path):
    result, results = _run(tmp_path, "mono")
    # on success only the animation base (voxelisation + prepared run) stays in the work folder
    work_dir = Path(pffdtd_job.PFFDTD_TEMP_DIR) / "test_mono"
    assert [p.name for p in work_dir.iterdir()] == [pffdtd_job.PFFDTD_ANIM_BASE_DIR_NAME]
    assert results["geometry_diagnostics"]["n_errors"] == 0
    assert sum(results["grid"]["misalignment_cells"]) < 1e-6  # walls on cell faces
    assert results["grid"]["ppw_effective"] >= PPW

    entry = next(e for e in results["results"] if e["receiver_id"] == "rx")
    fs, ir = wavfile.read(str(tmp_path / entry["ir_file"]))
    assert fs == AUDIO_SAMPLE_RATE and ir.dtype == np.float32 and ir.ndim == 1
    assert len(ir) == int(round(DURATION * fs))

    r = float(np.linalg.norm(np.subtract(RECEIVER_X, SOURCE)))
    # direct sound arrives at r/c (peak of the band-limited pulse)
    n_direct = int(r / C * fs)
    first = int(np.argmax(np.abs(ir[: n_direct + int(0.004 * fs)])))
    assert abs(first - n_direct) <= int(0.0015 * fs)

    # IRs are re the free field at 1 m: in-band direct-path level ~ 1/r; the first reflection
    # (floor/ceiling image) arrives >= 2.2 ms later, so gate a 2 ms window around the pulse
    # and compare its 100-400 Hz energy with an ideal pulse filtered the same way
    win = slice(max(0, n_direct - int(0.004 * fs)), n_direct + int(0.002 * fs))
    f = np.arange(100.0, 400.0, 5.0)
    n = np.arange(win.start, win.stop)
    H = np.abs(np.exp(-2j * np.pi * np.outer(f, n) / fs) @ ir[win].astype(np.float64))
    level_db = 20 * np.log10(np.mean(H) * r)
    assert abs(level_db) < 1.5, level_db

    params = entry.get("acoustic_parameters") or {}
    assert params.get("rt60") is not None and 0.1 < params["rt60"] < 3.0
    assert entry["band_limited"] and entry["fmax"] == FMAX


def test_pffdtd_foa_direction(tmp_path):
    result, results = _run(tmp_path, "foa")
    entry = next(e for e in results["results"] if e["receiver_id"] == "rx")
    assert entry["num_channels"] == 4 and entry["channel_ordering"] == "ACN"
    fs, ir = wavfile.read(str(tmp_path / entry["ir_file"]))
    assert ir.shape[1] == 4
    r = float(np.linalg.norm(np.subtract(RECEIVER_X, SOURCE)))
    n_direct = int(r / C * fs)
    win = slice(n_direct - int(0.002 * fs), n_direct + int(0.002 * fs))
    W, Y, Z, X = (ir[win, k].astype(np.float64) for k in range(4))
    # source lies along -x from the receiver: X ~ -W, Y ~ Z ~ 0 for the direct sound
    corr = float(np.dot(W, X) / np.sqrt(np.dot(W, W) * np.dot(X, X)))
    assert corr < -0.8, corr
    assert np.sqrt(np.dot(Y, Y)) < 0.3 * np.sqrt(np.dot(W, W))
    assert np.sqrt(np.dot(Z, Z)) < 0.3 * np.sqrt(np.dot(W, W))
    assert 0.7 < np.sqrt(np.dot(X, X) / np.dot(W, W)) < 1.3


SOURCE_2 = [3.1, 0.8, 1.0]
PLANE_Z = RECEIVER_X[2]


def _field_file(tmp_path, name, dtype):
    return np.fromfile(tmp_path / name, dtype=dtype)


def test_pffdtd_field_outputs(tmp_path, monkeypatch):
    """Strength-G volume agrees with the IR energy; an on-demand animation starts at the source."""
    monkeypatch.setattr(pffdtd_job, "PFFDTD_FIELD_DIR", str(tmp_path))
    monkeypatch.setattr(pffdtd_animation_job, "PFFDTD_FIELD_DIR", str(tmp_path))
    pairs = _pairs() + [{"source_id": "s2", "source_position": SOURCE_2, "receiver_id": "rx", "receiver_position": RECEIVER_X}]
    _, results = _run(tmp_path, "mono", pairs=pairs, tag="field", air_absorption=False, field_plane_z=PLANE_Z)
    field = results["field"]
    nx, ny = field["nx"], field["ny"]
    assert abs(field["z"] - PLANE_Z) <= results["grid"]["h"] / 2 + 1e-9
    assert [s["source_id"] for s in field["sources"]] == ["s1", "s2"]
    mask = _field_file(tmp_path, field["mask_file"], np.uint8).reshape(ny, nx)
    assert (mask == 0).any() and (mask == 1).any()

    vol = field["volume"]
    shape = (vol["nz"], vol["ny"], vol["nx"])
    assert vol["stride"] == pffdtd_job.PFFDTD_SPL_VOLUME_STRIDE
    assert vol["dx"] == pytest.approx(vol["stride"] * results["grid"]["h"], rel=1e-6)
    assert [s["source_id"] for s in vol["sources"]] == ["s1", "s2"]
    vmask = _field_file(tmp_path, vol["mask_file"], np.uint8).reshape(shape)
    assert (vmask == 0).any() and (vmask == 1).any() and (vmask == 2).any()
    s1 = field["sources"][0]
    assert s1["spl_file"] is None
    spl = _field_file(tmp_path, vol["sources"][0]["spl_volume_file"], np.float32).reshape(shape)
    assert np.isfinite(spl[vmask == 0]).all() and np.isnan(spl[vmask == 2]).all()
    assert s1["spl_min_db"] <= np.nanmin(spl[vmask == 0]) + 1e-3 and s1["spl_max_db"] >= np.nanmax(spl[vmask == 0]) - 1e-3

    def cell(p):
        return tuple(int(round((c - vol[o]) / vol[d])) for c, o, d in ((p[2], "z0", "dz"), (p[1], "y0", "dy"), (p[0], "x0", "dx")))

    # same G from the IR (48 kHz, unit-sample convention, same band) at the receiver
    entry = next(e for e in results["results"] if e["receiver_id"] == "rx" and e["source_id"] == "s1")
    fs, ir = wavfile.read(str(tmp_path / entry["ir_file"]))
    delta = np.zeros(ir.size)
    delta[ir.size // 2] = 1.0  # centred: filtfilt's odd-extension padding would turn an edge delta into a step
    h48 = sosfiltfilt(butter(4, FMAX, btype="low", fs=fs, output="sos"),
                      sosfilt(butter(4, 10.0, btype="high", fs=fs, output="sos"), delta))
    e_ref = np.sum(h48 ** 2) / 10.0 ** 2  # IRs are re 1 m (1/r): free field at 10 m
    g_ir = 10 * np.log10(np.sum(ir.astype(np.float64) ** 2) / e_ref)
    rz, ry, rx = cell(RECEIVER_X)
    assert vmask[rz, ry, rx] == 0
    assert abs(spl[rz, ry, rx] - g_ir) < 1.5, (spl[rz, ry, rx], g_ir)
    # louder at the source's lattice cell (<= 1 cell away) than far from it; one cell further
    # out (~0.45 m at stride 4) the reverberant field of this small, live room already dominates
    sz, sy, sx = cell(SOURCE)
    assert spl[sz, sy, sx] > spl[rz, ry, rx] + 3.0, (spl[sz, sy, sx], spl[rz, ry, rx])

    # no animation during the run; generated afterwards from the kept voxelisation
    assert field["animation_on_demand"] and all(s["animation"] is None for s in field["sources"])
    result_file = tmp_path / "result_anim.json"
    pffdtd_animation_job.run_pffdtd_animation(
        simulation_id="test_field", progress_file=str(tmp_path / "progress_anim.json"), result_file=str(result_file),
        plane_z=PLANE_Z, animation_ms=20.0, temp_dir=str(tmp_path),
    )
    result = json.loads(result_file.read_text())
    assert result["type"] == "done", result.get("message", "") + "\n" + result.get("traceback", "")
    old_mask = field["mask_file"]
    field = json.loads((tmp_path / "pffdtd_test_field_results.json").read_text())["field"]
    nx, ny = field["nx"], field["ny"]
    assert abs(field["z"] - PLANE_Z) <= results["grid"]["h"] / 2 + 1e-9
    assert field["mask_file"] != old_mask and not (tmp_path / old_mask).exists()
    mask = _field_file(tmp_path, field["mask_file"], np.uint8).reshape(ny, nx)
    assert (mask == 0).any() and (mask == 1).any()
    assert all(s["animation"] for s in field["sources"])

    anim = field["sources"][0]["animation"]
    frames = _field_file(tmp_path, anim["file"], np.int8).reshape(anim["frames"], ny, nx)
    assert anim["frames"] == len(anim["times_ms"]) and np.all(np.diff(anim["times_ms"]) > 0)
    # ~one pulse period in: the wave front is ~0.5 m from the source
    k = int(np.searchsorted(anim["times_ms"], 1.5e3 / FMAX))
    jy, jx = np.unravel_index(np.argmax(np.abs(frames[k].astype(np.int16))), (ny, nx))
    d = np.hypot(field["x0"] + jx * field["dx"] - SOURCE[0], field["y0"] + jy * field["dy"] - SOURCE[1])
    assert d < 1.0, d


def test_pffdtd_derived_source_matches_fresh_prepare(tmp_path, monkeypatch):
    """Source 2 runs on source 1's voxelisation; its IR equals a run that voxelises for it."""
    monkeypatch.setattr(pffdtd_job, "PFFDTD_FIELD_DIR", str(tmp_path))
    two = [{"source_id": "s1", "source_position": SOURCE, "receiver_id": "rx", "receiver_position": RECEIVER_X},
           {"source_id": "s2", "source_position": SOURCE_2, "receiver_id": "rx", "receiver_position": RECEIVER_X}]
    _, both = _run(tmp_path, "mono", pairs=two, tag="derived")
    _, alone = _run(tmp_path, "mono", pairs=two[1:], tag="alone")
    ir_d = wavfile.read(str(tmp_path / next(e for e in both["results"] if e["source_id"] == "s2")["ir_file"]))[1]
    ir_a = wavfile.read(str(tmp_path / alone["results"][0]["ir_file"]))[1]
    assert np.allclose(ir_d, ir_a, rtol=0, atol=1e-6 * np.abs(ir_a).max())
