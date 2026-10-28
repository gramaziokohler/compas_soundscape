# backend/tests/test_pffdtd_directional.py
"""Band composition of directional sources in reciprocal PFFDTD runs (pure numpy) and the
job entries that carry a source's first-order fit into the pipeline."""

import sys
from collections import OrderedDict
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from pffdtd_backend.directional import band_weights, compose, probe_row_ranges  # noqa: E402
from services.pffdtd_directivity import directional_job_entry, job_source_directivities  # noqa: E402

FS = 48000.0
BANDS = [125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0]


def _signals(n_t=4096, seed=0):
    rng = np.random.default_rng(seed)
    w = rng.standard_normal(n_t)
    xyz = rng.standard_normal((3, n_t))
    return w, xyz


def test_band_weights_partition_of_unity():
    freqs = np.fft.rfftfreq(8192, 1.0 / FS)
    weights = band_weights(freqs, BANDS)
    assert weights.shape == (7, freqs.size)
    assert np.allclose(weights.sum(axis=0), 1.0)
    assert np.all(weights >= 0)
    # at a band centre that band alone is active; below the lowest centre the first band is
    k_1k = int(np.argmin(np.abs(freqs - 1000.0)))
    assert weights[3, k_1k] == pytest.approx(1.0, abs=1e-2)  # nearest FFT bin, not exactly 1 kHz
    assert weights[0, 1] == pytest.approx(1.0)
    assert weights[-1, -1] == pytest.approx(1.0)
    assert band_weights(freqs, [1000.0]).shape == (1, freqs.size)


def test_single_band_equals_time_domain_pattern():
    w, xyz = _signals()
    n = np.array([0.0, -1.0, 0.0])
    spec = {"a": [0.5], "gain": [1.0], "axis_world": [n.tolist()], "bands_hz": []}
    expected = 0.5 * w + 0.5 * (n @ xyz)
    assert np.allclose(compose(w, xyz, spec, FS), expected)


def test_omni_fit_reproduces_w_and_gain_scales():
    w, xyz = _signals(seed=1)
    spec = {"a": [1.0] * 7, "gain": [2.0] * 7, "axis_world": [[1, 0, 0]] * 7, "bands_hz": BANDS}
    assert np.allclose(compose(w, xyz, spec, FS), 2.0 * w, atol=1e-9)


def test_multiband_composition_is_bandwise_consistent():
    """A constant pattern across bands equals the single-band formula; a band-limited
    signal sees only its own band's pattern."""
    w, xyz = _signals(seed=2)
    n = np.array([0.0, 0.0, 1.0])
    same = {"a": [0.25] * 7, "gain": [1.0] * 7, "axis_world": [n.tolist()] * 7, "bands_hz": BANDS}
    assert np.allclose(compose(w, xyz, same, FS), 0.25 * w + 0.75 * (n @ xyz), atol=1e-9)

    # a tone at 1 kHz: only band index 3 (a = 0, pure dipole along z) shapes it
    t = np.arange(4096) / FS
    tone = np.sin(2 * np.pi * 1000.0 * t)
    xyz_tone = np.vstack([0 * tone, 0 * tone, tone])
    mixed = {"a": [1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0], "gain": [1.0] * 7, "axis_world": [n.tolist()] * 7, "bands_hz": BANDS}
    out = compose(tone, xyz_tone, mixed, FS)
    assert np.allclose(out[200:-200], tone[200:-200], atol=0.05)  # dipole along z heard on-axis = tone


def test_probe_row_ranges():
    assert probe_row_ranges([False, True, False]) == [(0, 1), (1, 7), (8, 1)]


def test_job_entries_rotate_axes_to_world():
    spec = {
        "kind": "measured", "id": "dir_x", "label": "X", "yaw": 0.0, "pitch": 0.0, "roll": 0.0,
        "fit": {"bands_hz": BANDS, "a": [0.5] * 7, "gain": [1.0] * 7, "axis": [[1, 0, 0]] * 7, "residual": [0.1] * 7},
    }
    entry = directional_job_entry(spec)
    assert entry["a"] == [0.5] * 7 and len(entry["axis_world"]) == 7
    assert np.allclose(entry["axis_world"][0], [0, -1, 0])  # source front at yaw 0 faces -Y
    turned = directional_job_entry({**spec, "yaw": np.pi / 2})
    assert np.allclose(turned["axis_world"][0], [-1, 0, 0], atol=1e-12)
    assert directional_job_entry(None) is None

    sources = OrderedDict([("pos_a", [0, 0, 1]), ("pos_b~d12345678", [0, 0, 1])])
    pairs = [
        {"source_id": "pos_a", "receiver_id": "r", "source_directivity_spec": None},
        {"source_id": "pos_b~d12345678", "receiver_id": "r", "source_directivity_spec": spec},
    ]
    entries = job_source_directivities(sources, pairs)
    assert entries[0] is None and entries[1]["id"] == "dir_x"
