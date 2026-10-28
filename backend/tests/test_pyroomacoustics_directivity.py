# backend/tests/test_pyroomacoustics_directivity.py
"""Source directivity in the pyroomacoustics engine.

A box room with a source facing -Y (yaw 0) and two receivers 2 m in front and behind:
the direct sound of a cardioid is >= 15 dB louder in front, an omni source is symmetric,
a measured (synthetic cardioid) balloon behaves like the analytical one and yaw = pi
flips the pattern.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

pra = pytest.importorskip("pyroomacoustics")

from services.directivity_formats import Balloon  # noqa: E402
from services.directivity_processing import process_balloon, save_npz  # noqa: E402
from services.pyroomacoustics_directivity import add_source_with_directivity, build_pra_directivity  # noqa: E402
from services.pyroomacoustics_worker import run_pyroomacoustics_simulation_from_geometry  # noqa: E402

FS = 48000
# A large hall keeps the first reflection (> 30 m path) far behind the 2 m direct sound.
SRC = [20.0, 20.0, 10.0]
FRONT = [20.0, 18.0, 10.0]   # -Y of the source = yaw 0 forward
BACK = [20.0, 22.0, 10.0]


def _box():
    outline = [(0, 0), (40, 0), (40, 40), (0, 40)]
    n, h = len(outline), 20.0
    v = [[x, y, 0] for x, y in outline] + [[x, y, h] for x, y in outline]
    f = []
    for i in range(n):
        j = (i + 1) % n
        f += [[i, j + n, j], [i, i + n, j + n]]
    f += [[0, 1, 2], [0, 2, 3], [n, n + 2, n + 1], [n, n + 3, n + 2]]
    return v, f


def _run(tmp_path, spec, tag):
    v, f = _box()
    payload = {
        "vertices": v, "faces": f, "face_groups": {"room": list(range(len(f)))},
        "materials": {"room": {"absorption": 0.3}},
        "sources": [{"id": "s", "position": SRC, "directivity_spec": spec}],
        "receivers": [{"id": "front", "position": FRONT}, {"id": "back", "position": BACK}],
    }
    out = tmp_path / tag
    out.mkdir()
    (out / "geometry.json").write_text(json.dumps(payload))
    run_pyroomacoustics_simulation_from_geometry(
        simulation_id=tag, progress_file=str(out / "p.json"), result_file=str(out / "r.json"),
        geometry_file=str(out / "geometry.json"), simulation_mode="mono", max_order=1, ray_tracing=False,
        air_absorption=False, n_rays=1000, sound_speed=343.0, simulation_name=tag,
        rir_output_dir=str(out), temp_dir=str(out),
    )
    result = json.loads((out / "r.json").read_text())
    assert result["type"] == "done", result.get("traceback")
    results = json.loads((out / result["result"]["results_file"]).read_text())["results"]
    irs = {}
    for entry in results:
        _, ir = wavfile.read(str(out / entry["ir_file"]))
        irs[entry["receiver_id"]] = ir.astype(np.float64)
    return irs, results


def _direct_energy(ir: np.ndarray) -> float:
    """Energy around the first arrival (the direct path; first reflection is > 200 samples later)."""
    peak = int(np.argmax(np.abs(ir)))
    threshold = 0.05 * np.abs(ir).max()
    first = int(np.flatnonzero(np.abs(ir) > threshold)[0]) if np.abs(ir).max() > 0 else peak
    lo, hi = max(first - 20, 0), first + 80
    return float(np.sum(ir[lo:hi] ** 2))


def _front_back_db(irs) -> float:
    e_front, e_back = _direct_energy(irs["front"]), _direct_energy(irs["back"])
    return 10 * np.log10(max(e_front, 1e-12) / max(e_back, 1e-12))


def _cardioid_spec(yaw=0.0):
    return {"kind": "analytical", "id": "cardioid", "label": "Cardioid", "p": 0.5, "yaw": yaw, "pitch": 0.0, "roll": 0.0}


def test_omni_source_is_symmetric(tmp_path):
    irs, results = _run(tmp_path, None, "omni")
    assert abs(_front_back_db(irs)) < 1.0
    assert "source_directivity" not in results[0]


def test_cardioid_faces_minus_y(tmp_path):
    irs, results = _run(tmp_path, _cardioid_spec(), "cardioid")
    assert _front_back_db(irs) >= 15.0
    assert results[0]["source_directivity"]["id"] == "cardioid" and results[0]["source_directivity"]["yaw"] == 0.0


def test_cardioid_yaw_pi_flips(tmp_path):
    irs, _ = _run(tmp_path, _cardioid_spec(yaw=np.pi), "flipped")
    assert _front_back_db(irs) <= -15.0


def _synthetic_cardioid_npz(path: Path) -> Path:
    n = 500
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    theta = np.pi * (1 + 5 ** 0.5) * i
    dirs = np.column_stack([np.cos(theta) * np.sin(phi), np.sin(theta) * np.sin(phi), np.cos(phi)])
    irs = np.zeros((n, 600))
    irs[:, 40] = 0.5 + 0.5 * dirs[:, 0]
    return save_npz(path, process_balloon(Balloon(directions=dirs, irs=irs, fs=float(FS), fmt="sofa")))


def test_measured_balloon(tmp_path):
    npz = _synthetic_cardioid_npz(tmp_path / "cardioid.npz")
    spec = {"kind": "measured", "id": "dir_test", "label": "Synthetic", "path": str(npz),
            "yaw": 0.0, "pitch": 0.0, "roll": 0.0}
    irs, results = _run(tmp_path, spec, "measured")
    assert _front_back_db(irs) >= 12.0
    assert results[0]["source_directivity"]["kind"] == "measured"
    flipped = dict(spec, yaw=np.pi)
    irs2, _ = _run(tmp_path, flipped, "measured_flipped")
    assert _front_back_db(irs2) <= -12.0


def test_build_and_guard(tmp_path, monkeypatch):
    from pyroomacoustics.directivities import CardioidFamily, MeasuredDirectivity

    assert build_pra_directivity(None) is None
    assert build_pra_directivity({"kind": "analytical", "p": 1.0}) is None
    assert isinstance(build_pra_directivity(_cardioid_spec()), CardioidFamily)
    npz = _synthetic_cardioid_npz(tmp_path / "c.npz")
    measured = build_pra_directivity({"kind": "measured", "path": str(npz), "yaw": 0.3, "pitch": 0.1, "roll": 0.0})
    assert isinstance(measured, MeasuredDirectivity)
    with pytest.raises(ValueError):
        build_pra_directivity({"kind": "weird"})

    room = pra.ShoeBox([4, 4, 3], fs=FS, max_order=1)
    add_source_with_directivity(room, [1, 1, 1], _cardioid_spec())
    assert len(room.sources) == 1

    import services.pyroomacoustics_directivity as module

    monkeypatch.setattr(module, "build_pra_directivity", lambda spec: object())
    with pytest.raises(RuntimeError, match="ignored"):
        add_source_with_directivity(room, [2, 2, 1], _cardioid_spec())
