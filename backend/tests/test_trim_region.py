"""Silence-trim region (utils.audio_processing.compute_noise_trim_region).

Covers the trailing silence after the last sound (an over-long one-shot) and
the confirmation of onset gaps on the RMS envelope (a spurious onset in the
silence must not make the sound itself look like a gap).
"""
import numpy as np
import pytest

pytest.importorskip("librosa")

from utils.audio_processing import compute_noise_trim_region  # noqa: E402

SR = 48000


def _floor(rng, seconds, level=1e-4):
    return rng.normal(0, level, int(seconds * SR))


def _add_knock(x, at, decay=18.0, length=0.3, freq=180.0):
    t = np.arange(int(length * SR)) / SR
    i = int(at * SR)
    x[i:i + t.size] += 0.8 * np.sin(2 * np.pi * freq * t) * np.exp(-t * decay)
    return x


def _seconds(x, region):
    duration = len(x) / SR
    return region[0] * duration, region[1] * duration


def test_trailing_silence_is_trimmed():
    rng = np.random.default_rng(0)
    x = _add_knock(_floor(rng, 4.0), 1.5)
    start, end = _seconds(x, compute_noise_trim_region(x, SR))
    assert 1.4 <= start <= 1.5
    assert 1.6 <= end <= 2.1  # knock + decay + release, not the 2 s of silence after it


def test_sound_at_start_is_kept():
    rng = np.random.default_rng(0)
    x = _add_knock(_floor(rng, 3.0), 0.0)
    start, end = _seconds(x, compute_noise_trim_region(x, SR))
    assert start == 0.0
    assert end < 0.6


def test_slow_decay_is_kept():
    rng = np.random.default_rng(0)
    x = _add_knock(_floor(rng, 5.0), 0.5, decay=3.0, length=3.0)
    start, end = _seconds(x, compute_noise_trim_region(x, SR))
    assert start <= 0.5
    assert end >= 2.3  # e^-3t reaches -50 dB after ~1.9 s


def test_sustained_texture_is_not_trimmed():
    rng = np.random.default_rng(0)
    assert compute_noise_trim_region(rng.normal(0, 0.2, 4 * SR), SR) is None


def test_hissy_clip_tail_is_trimmed():
    rng = np.random.default_rng(0)
    x = _add_knock(_floor(rng, 4.0), 1.0) + rng.normal(0, 0.008, 4 * SR)
    start, end = _seconds(x, compute_noise_trim_region(x, SR))
    assert 0.9 <= start <= 1.0
    assert end < 1.8
