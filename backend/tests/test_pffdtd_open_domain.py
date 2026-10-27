# backend/tests/test_pffdtd_open_domain.py
"""End-to-end PFFDTD run of an open scene: a small cube in free field, source and receiver
outside its bounding box, inside a padded domain (``domain_bounds``).

Skipped unless the compas-pffdtd env and the built engine are present. Checks that RoomGeo
accepts the outside seeds, the grid keeps h aligned to the cube, and the direct sound is 1/r.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))  # backend/tests (shared cube scene)

from config.constants import AUDIO_SAMPLE_RATE, PFFDTD_SPEED_OF_SOUND  # noqa: E402
from services.pffdtd_job import pffdtd_available, run_pffdtd_simulation_from_geometry  # noqa: E402
from test_pffdtd_job_bounds import CUBE, RECEIVER, SOURCE, _cube_geometry, _pairs  # noqa: E402
from utils.pffdtd_grid import plan_grid  # noqa: E402

pytestmark = pytest.mark.skipif(pffdtd_available() is not None, reason=str(pffdtd_available()))

FMAX = 500.0
PPW = 12.0
DURATION = 0.03
PADDING_M = 2.5  # source 1 m from the domain edge: the edge echo arrives >= 2.5 ms after the direct sound


def _padded_bounds(h: float):
    n = math.ceil(PADDING_M / h)  # whole cells from the cube bbox keep its faces on cell faces
    return [-n * h] * 3, [CUBE + n * h] * 3


def test_open_domain_direct_sound(tmp_path):
    h = plan_grid([CUBE] * 3, FMAX, PPW, DURATION).h  # the spacing the job will pick
    bounds = _padded_bounds(h)
    result_file = tmp_path / "result.json"
    run_pffdtd_simulation_from_geometry(
        simulation_id="test_open_domain", progress_file=str(tmp_path / "progress.json"),
        result_file=str(result_file), geometry=_cube_geometry(), pairs_data=_pairs(), simulation_mode="mono",
        fmax=FMAX, ppw=PPW, duration=DURATION, air_absorption=False, simulation_name="open-domain-test",
        rir_output_dir=str(tmp_path), temp_dir=str(tmp_path), domain_bounds=bounds,
    )
    result = json.loads(result_file.read_text())
    assert result["type"] == "done", result.get("message", "") + "\n" + result.get("traceback", "")
    results = json.loads((tmp_path / result["result"]["results_file"]).read_text())
    grid = results["grid"]
    assert sum(grid["misalignment_cells"]) < 1e-6
    assert grid["domain_bounds"] is not None
    assert grid["h"] == pytest.approx(h, rel=1e-9)

    fs, ir = wavfile.read(str(tmp_path / results["results"][0]["ir_file"]))
    assert fs == AUDIO_SAMPLE_RATE
    r = float(np.linalg.norm(np.subtract(RECEIVER, SOURCE)))
    n_direct = int(r / PFFDTD_SPEED_OF_SOUND * fs)
    win = slice(max(0, n_direct - int(0.004 * fs)), n_direct + int(0.002 * fs))
    f = np.arange(100.0, 400.0, 5.0)
    n = np.arange(win.start, win.stop)
    H = np.abs(np.exp(-2j * np.pi * np.outer(f, n) / fs) @ ir[win].astype(np.float64))
    level_db = 20 * np.log10(np.mean(H) * r)  # re free field at 1 m: direct path 1/r
    assert abs(level_db) < 1.0, level_db
