# backend/tests/test_pffdtd_pipeline.py
"""End-to-end run of the PFFDTD worker (direct geometry -> mesh prep -> compas-pffdtd
pipeline -> CUDA engine -> WAV/metrics/results JSON).

Skipped unless the compas-pffdtd env (PFFDTD_PYTHON) and the built engine are present.
An axis-aligned, inward-wound shoebox exercises: material id + coefficient-dict
resolution, grid alignment to the bounding box, the unit-sample 1/(4 pi r) IR scale,
arrival time, reverberant decay, and FOA channel directions.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from config.constants import AUDIO_SAMPLE_RATE  # noqa: E402
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


def _run(tmp_path, mode):
    v, f, ranges = _shoebox_inward()
    db_id = next(iter(next(iter(PyroomacousticsService.get_material_database().values()))))
    materials = {"floor": db_id, "ceiling": WALL_ABSORPTION, "walls": WALL_ABSORPTION}
    face_materials = {i: materials[name] for name, (a, b) in ranges.items() for i in range(a, b + 1)}
    result_file = tmp_path / f"result_{mode}.json"
    run_pffdtd_simulation_from_geometry(
        simulation_id=f"test_{mode}",
        progress_file=str(tmp_path / f"progress_{mode}.json"),
        result_file=str(result_file),
        geometry={"vertices": v, "faces": f, "object_face_ranges": ranges, "face_materials": face_materials},
        pairs_data=_pairs(),
        simulation_mode=mode,
        fmax=FMAX,
        ppw=PPW,
        duration=DURATION,
        air_absorption=True,
        simulation_name="pffdtd-test",
        rir_output_dir=str(tmp_path),
        temp_dir=str(tmp_path),
    )
    result = json.loads(result_file.read_text())
    assert result["type"] == "done", result.get("message", "") + "\n" + result.get("traceback", "")
    results = json.loads((tmp_path / result["result"]["results_file"]).read_text())
    return result, results


def test_pffdtd_mono_end_to_end(tmp_path):
    result, results = _run(tmp_path, "mono")
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

    # unit-sample convention: in-band direct-path level ~ 1/(4 pi r); the first reflection
    # (floor/ceiling image) arrives >= 2.2 ms later, so gate a 2 ms window around the pulse
    # and compare its 100-400 Hz energy with an ideal pulse filtered the same way
    win = slice(max(0, n_direct - int(0.004 * fs)), n_direct + int(0.002 * fs))
    f = np.arange(100.0, 400.0, 5.0)
    n = np.arange(win.start, win.stop)
    H = np.abs(np.exp(-2j * np.pi * np.outer(f, n) / fs) @ ir[win].astype(np.float64))
    level_db = 20 * np.log10(np.mean(H) * 4 * np.pi * r)
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
