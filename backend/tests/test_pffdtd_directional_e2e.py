# backend/tests/test_pffdtd_directional_e2e.py
"""Directional sources through the whole PFFDTD worker (reciprocal runs + band composition)
on the shoebox of test_pffdtd_pipeline.

- a cardioid facing -Y is >= 12 dB louder at the listener in front than at the one behind
  (direct sound, below the grid's accurate band); yaw = pi flips it
- an "omni" first-order spec (a = 1) through the reciprocal path reproduces the forward run
  (mono and FOA), i.e. the composition and the reciprocity bookkeeping are exact
- results carry `source_directivity`, no field block, `grid.reciprocal`

Skipped unless the compas-pffdtd env (PFFDTD_PYTHON) and the built engine are present.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))  # test_pffdtd_pipeline (shoebox scene)

from services.directivity_processing import analytical_fit  # noqa: E402
from services.pffdtd_job import pffdtd_available  # noqa: E402
from test_pffdtd_pipeline import C, _run  # noqa: E402

pytestmark = pytest.mark.skipif(pffdtd_available() is not None, reason=str(pffdtd_available()))

# Along the room's long axis (4 m): 1.4 m to each listener keeps the near-field term of the
# reciprocal pressure-gradient channel (1 / kr) small and the first wall reflection > 7 ms away.
SOURCE = [2.0, 1.5, 1.2]
FRONT = [3.4, 1.5, 1.2]
BACK = [0.6, 1.5, 1.2]
YAW_PLUS_X = -np.pi / 2  # forward = (-sin yaw, -cos yaw, 0) = +X
LOWPASS_HZ = 450.0
FRONT_BACK_DB = 12.0
RECIPROCITY_REL = 2e-2


def _spec(p: float, yaw: float = YAW_PLUS_X) -> dict:
    return {"kind": "analytical", "id": "cardioid", "label": "Cardioid", "p": p, "fit": analytical_fit(p),
            "yaw": yaw, "pitch": 0.0, "roll": 0.0}


def _pairs(spec):
    return [
        {"source_id": "s1", "source_position": SOURCE, "receiver_id": "front", "receiver_position": FRONT, "source_directivity_spec": spec},
        {"source_id": "s1", "source_position": SOURCE, "receiver_id": "back", "receiver_position": BACK, "source_directivity_spec": spec},
    ]


def _irs(tmp_path, results):
    out = {}
    for e in results["results"]:
        fs, ir = wavfile.read(str(tmp_path / e["ir_file"]))
        out[e["receiver_id"]] = (fs, ir.astype(np.float64))
    return out


def _direct_db(fs, ir, r_m) -> float:
    sos = butter(4, LOWPASS_HZ, btype="low", fs=fs, output="sos")
    y = sosfiltfilt(sos, ir if ir.ndim == 1 else ir[:, 0])
    win = slice(0, int(round((r_m / C + 0.002) * fs)))
    return 10 * np.log10(np.sum(y[win] ** 2) + 1e-30)


def test_cardioid_front_back_and_flip(tmp_path):
    _, results = _run(tmp_path, "mono", pairs=_pairs(_spec(0.5)), tag="dir_cardioid")
    assert results["grid"]["reciprocal"] and results["field"] is None
    entry = results["results"][0]
    assert entry["source_directivity"]["id"] == "cardioid" and entry["source_directivity"]["approximation"] == "first_order_per_band"
    irs = _irs(tmp_path, results)
    r = float(np.linalg.norm(np.subtract(FRONT, SOURCE)))
    ratio = _direct_db(*irs["front"], r) - _direct_db(*irs["back"], r)
    assert ratio >= FRONT_BACK_DB, ratio

    _, flipped = _run(tmp_path, "mono", pairs=_pairs(_spec(0.5, yaw=YAW_PLUS_X + np.pi)), tag="dir_flipped")
    irs2 = _irs(tmp_path, flipped)
    ratio2 = _direct_db(*irs2["front"], r) - _direct_db(*irs2["back"], r)
    assert ratio2 <= -FRONT_BACK_DB, ratio2


@pytest.mark.parametrize("mode", ["mono", "foa"])
def test_omni_spec_reproduces_forward_run(tmp_path, mode):
    _, forward = _run(tmp_path, mode, pairs=_pairs(None), tag=f"fwd_{mode}")
    _, reciprocal = _run(tmp_path, mode, pairs=_pairs(_spec(1.0)), tag=f"rec_{mode}")
    assert not forward["grid"]["reciprocal"] and reciprocal["grid"]["reciprocal"]
    fwd, rec = _irs(tmp_path, forward), _irs(tmp_path, reciprocal)
    for rid in ("front", "back"):
        a, b = fwd[rid][1], rec[rid][1]
        assert a.shape == b.shape
        assert np.max(np.abs(a - b)) <= RECIPROCITY_REL * np.max(np.abs(a)), rid
