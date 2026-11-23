"""Loudness calibration (utils/loudness.py): BS.1770 measurement, gating, limiter."""

import numpy as np
import pytest

from config.constants import DEFAULT_DBFS, TARGET_LOUDNESS_LUFS, TRUE_PEAK_CEILING_DBTP
from utils.loudness import (
    _biquad_high_pass,
    _biquad_high_shelf,
    calibrate_loudness,
    measure_loudness_lufs,
    true_peak_envelope,
)

SR = 48000


def _sine(freq: float, seconds: float, amplitude: float = 1.0) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return amplitude * np.sin(2 * np.pi * freq * t)


def _db(x: float) -> float:
    return 20 * np.log10(x)


def test_k_weighting_matches_bs1770_coefficients_at_48k():
    b1, a1 = _biquad_high_shelf(SR)
    b2, a2 = _biquad_high_pass(SR)
    np.testing.assert_allclose(b1, [1.53512485958697, -2.69169618940638, 1.19839281085285], atol=1e-8)
    np.testing.assert_allclose(a1, [1.0, -1.69065929318241, 0.73248077421585], atol=1e-8)
    np.testing.assert_allclose(b2, [1.0, -2.0, 1.0], atol=1e-12)
    np.testing.assert_allclose(a2, [1.0, -1.99004745483398, 0.99007225036621], atol=1e-8)


def test_bs1770_reference_tone():
    # BS.1770: a 997 Hz sine at 0 dBFS peak reads -3.01 LUFS.
    assert measure_loudness_lufs(_sine(997, 5.0), SR) == pytest.approx(-3.01, abs=0.05)


def test_k_weighting_follows_hearing():
    # Same RMS: 4 kHz is weighted up (high shelf), 40 Hz weighted down (high-pass).
    mid = measure_loudness_lufs(_sine(1000, 3.0, 0.1), SR)
    assert measure_loudness_lufs(_sine(4000, 3.0, 0.1), SR) > mid + 2.0
    assert measure_loudness_lufs(_sine(40, 3.0, 0.1), SR) < mid - 1.0


def test_gating_ignores_silence():
    # A sparse event measures close to its active part (edge blocks that straddle a
    # burst count, per BS.1770), not diluted by the gaps like whole-file RMS (-10 dB).
    burst = _sine(1000, 2.0, 0.3)
    sparse = np.concatenate([burst, np.zeros(18 * SR), burst, np.zeros(18 * SR)])
    assert measure_loudness_lufs(sparse, SR) == pytest.approx(measure_loudness_lufs(burst, SR), abs=0.6)


def test_silence_is_left_untouched():
    out, report = calibrate_loudness(np.zeros(SR), SR)
    assert report.measured_lufs is None
    assert not out.any()


def test_short_clip_is_measured():
    assert measure_loudness_lufs(_sine(1000, 0.1, 0.5), SR) is not None


def test_calibrates_steady_sound_to_target():
    rng = np.random.default_rng(0)
    noise = 0.01 * rng.standard_normal(10 * SR)
    out, report = calibrate_loudness(noise, SR)
    assert report.limiter_reduction_db == 0.0
    assert measure_loudness_lufs(out, SR) == pytest.approx(TARGET_LOUDNESS_LUFS, abs=0.1)


def test_target_dbfs_is_a_pure_offset():
    rng = np.random.default_rng(1)
    noise = 0.05 * rng.standard_normal(5 * SR)
    quiet, _ = calibrate_loudness(noise, SR, target_dbfs=DEFAULT_DBFS - 12)
    assert measure_loudness_lufs(quiet, SR) == pytest.approx(TARGET_LOUDNESS_LUFS - 12, abs=0.1)


def test_punchy_sound_respects_ceiling_and_beats_whole_file_scaling():
    # Decaying noise hits every 0.5 s (footsteps / knocks): high crest factor. The old
    # path scaled the WHOLE file down until its peak fit, so punchy sounds ended far
    # below steady beds; the limiter only reduces the peaks.
    signal = np.zeros(6 * SR)
    rng = np.random.default_rng(2)
    hit = int(0.15 * SR)
    for start in range(0, signal.size - hit, SR // 2):
        signal[start:start + hit] = rng.standard_normal(hit) * np.exp(-np.arange(hit) / (0.03 * SR))
    out, report = calibrate_loudness(signal, SR)

    assert report.limiter_reduction_db > 0
    assert _db(true_peak_envelope(out).max()) <= TRUE_PEAK_CEILING_DBTP + 0.3
    assert out.dtype == np.float32 and out.shape == signal.shape

    # Old behaviour: gain to target, then scale the whole file to a 0.99 peak.
    gained = signal * 10 ** ((TARGET_LOUDNESS_LUFS - measure_loudness_lufs(signal, SR)) / 20)
    old = gained * min(1.0, 0.99 / np.abs(gained).max())
    assert measure_loudness_lufs(out, SR) > measure_loudness_lufs(old, SR) + 1.5
    assert measure_loudness_lufs(out, SR) == pytest.approx(TARGET_LOUDNESS_LUFS, abs=1.0)


def test_shape_is_preserved_for_channel_first_input():
    out, _ = calibrate_loudness(_sine(500, 1.0, 0.2)[None, :], SR)
    assert out.shape == (1, SR)
