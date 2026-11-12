# backend/tests/test_hybrid_pipeline.py
"""End-to-end hybrid wave + geometric run (services/hybrid_job.run_hybrid_from_geometry).

Skipped unless both engines are present (the compas-pffdtd env + built CUDA engine, and
compas_acoustics). A 4 x 3 x 2.5 m shoebox checks what makes the join acoustically right:

* the crossover is the room's Schroeder frequency (from the measured decay and the air volume),
  and the wave solver only runs to the margin above it;
* the two engines agree where they overlap (level in the crossover octave within a few dB),
  i.e. same level reference and same time origin — the precondition of a crossover;
* the joined response is full-band, keeps the direct sound at its geometric delay and 1/r level;
* first-order ambisonics: both bands point at the source in the listener frame.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

pytest.importorskip("compas_acoustics")

from config.constants import AUDIO_SAMPLE_RATE, HYBRID_WAVE_FMAX_MARGIN  # noqa: E402
from services.hybrid_job import METHOD_NAME, run_hybrid_from_geometry  # noqa: E402
from services.pffdtd_job import pffdtd_available  # noqa: E402
from utils.hybrid_crossover import band_energy, schroeder_frequency  # noqa: E402

pytestmark = pytest.mark.skipif(pffdtd_available() is not None, reason=str(pffdtd_available()))

DIMS = (4.0, 3.0, 2.5)
VOLUME = DIMS[0] * DIMS[1] * DIMS[2]
SOURCE = [1.0, 1.5, 1.2]
RECEIVER = [3.0, 1.5, 1.2]        # +x of the source: the source is on the listener's right (-X is its right)
C = 343.2
ABSORPTION = {"coeffs": [0.15, 0.15, 0.2, 0.2, 0.25, 0.25], "center_freqs": [125, 250, 500, 1000, 2000, 4000]}


def _geometry():
    lx, ly, lz = DIMS
    v = [[0, 0, 0], [lx, 0, 0], [lx, ly, 0], [0, ly, 0], [0, 0, lz], [lx, 0, lz], [lx, ly, lz], [0, ly, lz]]
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    f = []
    for a, b, c, d in quads:
        f += [[a, b, c], [a, c, d]]
    return {
        "vertices": v, "faces": f, "object_face_ranges": {"room": [0, len(f) - 1]},
        "face_materials": {i: ABSORPTION for i in range(len(f))}, "face_scattering": None,
    }


def _run(tmp_path, mode, **kwargs):
    result_file = tmp_path / f"result_{mode}.json"
    run_hybrid_from_geometry(
        simulation_id=f"hybrid_{mode}",
        progress_file=str(tmp_path / f"progress_{mode}.json"),
        result_file=str(result_file),
        geometry=_geometry(),
        pairs_data=[{"source_id": "s1", "source_position": SOURCE, "receiver_id": "r1", "receiver_position": RECEIVER}],
        simulation_mode=mode,
        simulation_name="hybrid-test",
        rir_output_dir=str(tmp_path),
        temp_dir=str(tmp_path),
        ppw=10.0,
        max_order=3,
        n_rays=4000,
        parallel=False,
        **kwargs,
    )
    result = json.loads(result_file.read_text())
    assert result["type"] == "done", result.get("message", "") + "\n" + result.get("traceback", "")
    results = json.loads((tmp_path / result["result"]["results_file"]).read_text())
    entry = results["results"][0]
    fs, ir = wavfile.read(str(tmp_path / entry["ir_file"]))
    assert fs == AUDIO_SAMPLE_RATE and ir.dtype == np.float32
    return result, results, entry, ir.astype(np.float64)


@pytest.fixture(scope="module")
def mono(tmp_path_factory):
    return _run(tmp_path_factory.mktemp("hybrid_mono"), "mono")


def test_crossover_is_the_schroeder_frequency(mono):
    result, results, entry, _ = mono
    hybrid = results["hybrid"]
    assert results["method"] == METHOD_NAME and results["engine"] == "hybrid"
    assert hybrid["mode"] == "schroeder" and hybrid["limited_by"] is None
    assert hybrid["volume_m3"] == pytest.approx(VOLUME, rel=0.02)
    assert 0.15 < hybrid["rt60"] < 1.5
    expected = schroeder_frequency(hybrid["rt60"], hybrid["volume_m3"])
    assert hybrid["schroeder_hz"] == pytest.approx(expected, rel=0.01)
    assert hybrid["crossover_hz"] == pytest.approx(expected, rel=0.01)
    assert hybrid["wave_fmax"] == pytest.approx(expected * HYBRID_WAVE_FMAX_MARGIN, rel=0.01)
    assert results["grid"]["fmax"] == pytest.approx(hybrid["wave_fmax"], rel=0.01) if "fmax" in results["grid"] else True
    assert entry["engine"] == "hybrid" and entry["band_limited"] is False
    assert entry["hybrid"]["crossover_hz"] == hybrid["crossover_hz"]
    assert result["result"]["hybrid"]["crossover_hz"] == hybrid["crossover_hz"]


def test_engines_agree_where_they_overlap(mono):
    _, results, entry, _ = mono
    mismatch = entry["hybrid"]["overlap_mismatch_db"]
    assert mismatch is not None
    # same level reference (free field at 1 m) and time origin in both engines: a few dB at most
    assert abs(mismatch) < 5.0, f"wave and geometric parts differ by {mismatch} dB in the crossover octave"
    assert results["hybrid"]["median_overlap_mismatch_db"] == pytest.approx(mismatch, abs=0.01)
    assert entry["hybrid"]["wave_gain_db"] == 0.0           # level matching is off by default


def test_joined_response_is_full_band_and_keeps_the_direct_sound(mono):
    _, results, entry, ir = mono
    fc = results["hybrid"]["crossover_hz"]
    assert ir.ndim == 1
    distance = float(np.linalg.norm(np.subtract(SOURCE, RECEIVER)))
    # the direct sound is the first strong arrival (two side-wall reflections coincide later and are louder)
    expected = distance / C * AUDIO_SAMPLE_RATE
    arrival = int(np.argmax(np.abs(ir) > 0.5 / distance))
    assert abs(arrival - expected) <= 8                                   # within ~0.15 ms
    direct = float(np.max(np.abs(ir[arrival:arrival + 12])))
    assert direct == pytest.approx(1.0 / distance, rel=0.35)
    assert float(np.max(np.abs(ir[: int(expected) - 48]))) < 0.05 / distance   # nothing before it
    low = band_energy(ir, AUDIO_SAMPLE_RATE, 40.0, fc / 1.5)
    high = band_energy(ir, AUDIO_SAMPLE_RATE, 2000.0, 8000.0)
    assert low > 0 and high > 0
    # a wave-only response would have nothing up there; here the rays fill it
    assert high > 1e-3 * band_energy(ir, AUDIO_SAMPLE_RATE, 40.0, 20000.0)
    assert "rt60" in entry["acoustic_parameters"]


def test_manual_crossover_and_level_match(tmp_path):
    _, results, entry, _ = _run(tmp_path, "mono", crossover_mode="manual", crossover_hz=150.0, level_match=True, duration=0.4)
    assert results["hybrid"]["crossover_hz"] == pytest.approx(150.0)
    assert results["hybrid"]["wave_fmax"] == pytest.approx(150.0 * HYBRID_WAVE_FMAX_MARGIN)
    assert results["hybrid"]["wave_duration_s"] == pytest.approx(0.4)
    assert results["hybrid"]["level_match"] is True
    assert entry["hybrid"]["wave_gain_db"] == pytest.approx(-entry["hybrid"]["overlap_mismatch_db"], abs=0.01)


def test_foa_bands_point_at_the_source(tmp_path):
    _, results, entry, ir = _run(tmp_path, "foa")
    fc = results["hybrid"]["crossover_hz"]
    assert ir.shape[1] == 4 and entry["num_channels"] == 4 and entry["format"] == "AmbiX"
    distance = float(np.linalg.norm(np.subtract(SOURCE, RECEIVER)))
    arrival = int(distance / C * AUDIO_SAMPLE_RATE)
    window = slice(max(arrival - 48, 0), arrival + 96)         # the direct sound, before the first reflection
    # The source is on the listener's right: left (+Y channel) is negative, front and up near zero.
    def direction(band):
        w, y, z, x = (band[window, k] for k in range(4))
        return np.array([np.sum(w * x), np.sum(w * y), np.sum(w * z)]) / np.sum(w * w)

    high = sosfiltfilt(butter(4, fc * 2, btype="high", fs=AUDIO_SAMPLE_RATE, output="sos"), ir, axis=0)
    front, left, up = direction(high)
    assert left < -0.7 and abs(front) < 0.3 and abs(up) < 0.3
    # Below the crossover (the wave part, turned from world axes into the listener frame): same side.
    low = sosfiltfilt(butter(4, fc / 1.5, btype="low", fs=AUDIO_SAMPLE_RATE, output="sos"), ir, axis=0)
    window = slice(max(arrival - 240, 0), arrival + 240)       # low frequencies smear: a wider look around the arrival
    front, left, up = direction(low)
    assert left < 0 and abs(left) > abs(front)
