# backend/tests/test_directivity_processing.py
"""Balloon processing: resampling, common onset crop, on-axis normalisation,
octave-band energies, first-order fit, preview and npz round trip."""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from config.constants import (  # noqa: E402
    DIRECTIVITY_BAND_CENTER_FREQS,
    DIRECTIVITY_IR_PREROLL_SAMPLES,
    DIRECTIVITY_IR_TAPS,
    DIRECTIVITY_PROCESSING_VERSION,
)
from services.directivity_formats import Balloon  # noqa: E402
from services.directivity_processing import (  # noqa: E402
    ProcessedBalloon,
    analytical_fit,
    band_energies,
    band_powers,
    crop_irs,
    fit_first_order,
    front_direction_angle_deg,
    load_npz,
    process_balloon,
    resample_irs,
    save_npz,
)


def fibonacci_sphere(n: int) -> np.ndarray:
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    theta = np.pi * (1 + 5 ** 0.5) * i
    return np.column_stack([np.cos(theta) * np.sin(phi), np.sin(theta) * np.sin(phi), np.cos(phi)])


def first_order_balloon(a: float, axis=(1.0, 0.0, 0.0), n: int = 600, fs: float = 44100.0, delay: int = 120,
                        taps: int = 1024) -> Balloon:
    """Frequency-independent pattern a + (1 - a) cos(theta) about ``axis`` as delayed impulses."""
    dirs = fibonacci_sphere(n)
    gain = a + (1 - a) * (dirs @ np.asarray(axis, float))
    irs = np.zeros((n, taps))
    irs[:, delay] = gain
    return Balloon(directions=dirs, irs=irs, fs=fs, fmt="sofa", label="synthetic")


def test_resample_changes_length():
    irs = np.zeros((3, 4410))
    irs[:, 100] = 1.0
    out = resample_irs(irs, 44100.0, 48000.0)
    assert out.shape == (3, 4800)
    assert abs(int(np.argmax(np.abs(out[0]))) - round(100 * 48000 / 44100)) <= 1
    assert resample_irs(irs, 48000.0, 48000.0).shape == irs.shape


def test_crop_keeps_direct_peak_and_relative_delays():
    irs = np.zeros((2, 4000))
    irs[0, 1000] = 1.0
    irs[1, 1040] = 0.3  # a direction whose acoustic centre is further away
    out, start = crop_irs(irs)
    assert out.shape == (2, DIRECTIVITY_IR_TAPS)
    assert start == 1000 - DIRECTIVITY_IR_PREROLL_SAMPLES
    assert out[0, DIRECTIVITY_IR_PREROLL_SAMPLES] == 1.0
    assert out[1, DIRECTIVITY_IR_PREROLL_SAMPLES + 40] == pytest.approx(0.3)
    with pytest.raises(ValueError):
        crop_irs(np.zeros((1, 100)))


def test_band_energies_of_unit_impulse_are_proportional_to_bandwidth():
    ir = np.zeros(8192)
    ir[0] = 1.0
    e = band_energies(ir, 48000.0, [250, 500, 1000, 2000])[0]
    ratios = e[1:] / e[:-1]
    assert np.allclose(ratios, 2.0, rtol=0.05)  # octave bands double in width


def test_band_powers_of_unit_impulse_are_one_in_every_band():
    ir = np.zeros(DIRECTIVITY_IR_TAPS)  # short IR: the zero-padded FFT still resolves 125 Hz
    ir[0] = 1.0
    p = band_powers(ir, 48000.0, DIRECTIVITY_BAND_CENTER_FREQS)[0]
    assert np.allclose(p, 1.0, rtol=1e-9)


def test_flat_source_gets_flat_band_gains():
    """Gains are spectral magnitudes: an impulse-response balloon (flat in frequency) must get the
    same gain in every band (version 1 summed |X|^2 and tilted them +3 dB per octave)."""
    processed = process_balloon(first_order_balloon(0.5))
    gain_db = 20 * np.log10(processed.fit["gain"])
    assert np.ptp(gain_db) < 0.5, gain_db
    assert gain_db.mean() == pytest.approx(0.0, abs=0.5)  # on-axis normalised to a unit impulse
    assert processed.meta["processing_version"] == DIRECTIVITY_PROCESSING_VERSION


def test_load_npz_upgrades_version_1_balloons(tmp_path):
    processed = process_balloon(first_order_balloon(0.5))
    tilted = dict(processed.fit, gain=[g * 2 ** (k / 2) for k, g in enumerate(processed.fit["gain"])])
    old_meta = {k: v for k, v in processed.meta.items() if k != "processing_version"}
    path = save_npz(tmp_path / "v1.npz", ProcessedBalloon(
        directions=processed.directions, irs=processed.irs, fs=processed.fs, band_hz=processed.band_hz,
        band_energy=processed.band_energy * 3.0, fit=tilted, preview=processed.preview, meta=old_meta))
    data = load_npz(path)
    assert data["meta"]["processing_version"] == DIRECTIVITY_PROCESSING_VERSION
    assert data["meta"]["upgraded_from_version"] == 1
    assert np.allclose(data["fit"]["gain"], processed.fit["gain"], rtol=1e-4)
    assert np.allclose(data["fit"]["a"], processed.fit["a"], atol=1e-4)
    assert np.allclose(data["band_energy"], processed.band_energy, rtol=1e-4)


@pytest.mark.parametrize("a", [1.0, 0.75, 0.5, 0.25, 0.0])
def test_fit_first_order_recovers_pattern(a):
    dirs = fibonacci_sphere(800)
    axis = np.array([0.6, 0.0, 0.8])
    amp = 2.0 * (a + (1 - a) * (dirs @ axis))
    fit = fit_first_order(dirs, amp, np.full(dirs.shape[0], 1.0 / dirs.shape[0]))
    assert fit["a"] == pytest.approx(a, abs=1e-6)
    assert fit["gain"] == pytest.approx(2.0, abs=1e-6)
    assert fit["residual"] < 1e-6
    if a < 1.0:
        assert np.allclose(fit["axis"], axis, atol=1e-6)


def test_process_balloon_cardioid_end_to_end(tmp_path):
    processed = process_balloon(first_order_balloon(0.5))
    assert processed.fs == 48000 and processed.irs.shape == (600, DIRECTIVITY_IR_TAPS)
    assert processed.directions.dtype == np.float32
    assert np.allclose(processed.fit["a"], 0.5, atol=0.03)
    assert all(abs(1 - np.dot(ax, [1, 0, 0])) < 0.01 for ax in processed.fit["axis"])
    assert max(processed.fit["residual"]) < 0.05
    # on-axis response normalised to a unit impulse in the reference band
    on = int(np.argmax(processed.directions[:, 0]))
    delta = np.zeros(DIRECTIVITY_IR_TAPS)
    delta[0] = 1.0
    ref = band_energies(delta, 48000.0, [1000.0])[0, 0]
    assert band_energies(processed.irs[on].astype(float), 48000.0, [1000.0])[0, 0] == pytest.approx(ref, rel=0.1)
    assert processed.meta["gain_applied"] > 0 and processed.meta["front_angle_deg"] < 5.0
    assert processed.meta["crop_offset_samples"] > 0
    # preview: front/back ratio of a cardioid is large, horizontal cut starts at 0 dB
    assert all(fb > 20 for fb in processed.preview["front_back_db"])
    assert processed.preview["horizontal_db"][0][0] == pytest.approx(0.0, abs=0.5)
    assert len(processed.preview["horizontal_db"][0]) == 72

    path = save_npz(tmp_path / "x.npz", processed)
    data = load_npz(path)
    assert data["fs"] == 48000 and data["irs"].shape == processed.irs.shape
    assert data["fit"]["a"] == processed.fit["a"] and data["meta"]["label"] == "synthetic"
    assert np.allclose(data["directions"], processed.directions)


def test_process_balloon_subcardioid_pointing_up():
    processed = process_balloon(first_order_balloon(0.75, axis=(0.0, 0.0, 1.0)))
    assert np.allclose(processed.fit["a"], 0.75, atol=0.03)
    assert all(ax[2] > 0.99 for ax in processed.fit["axis"])
    assert processed.meta["front_angle_deg"] == pytest.approx(90.0, abs=2.0)
    # vertical cut: 90 deg (up) is the loudest direction
    up = processed.preview["vertical_db"][1][18]  # 1 kHz band, 90 deg at 5 deg steps
    assert up > processed.preview["vertical_db"][1][0]


def test_omni_balloon_fits_a_one():
    processed = process_balloon(first_order_balloon(1.0))
    assert np.allclose(processed.fit["a"], 1.0, atol=1e-3)
    assert np.allclose(processed.preview["front_back_db"], 0.0, atol=0.1)


def test_analytical_fit_and_front_angle():
    fit = analytical_fit(0.5)
    assert fit["a"] == [0.5] and fit["axis"] == [[1.0, 0.0, 0.0]]
    assert front_direction_angle_deg({"bands_hz": [1000, 2000], "axis": [[0, 1, 0], [0, 1, 0]]}) == pytest.approx(90.0)
    assert front_direction_angle_deg({"bands_hz": [125], "axis": [[0, 1, 0]]}) == 0.0
