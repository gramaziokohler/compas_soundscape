"""Per-run PFFDTD precision: GPU memory of the grid plan and the single-precision high-pass."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.constants import PFFDTD_SINGLE_HIGHPASS_HZ  # noqa: E402
from utils.pffdtd_grid import plan_grid  # noqa: E402


def test_single_precision_halves_the_grid_memory():
    double = plan_grid([6.0, 5.0, 3.5], 500.0, 20.0, 1.0, precision="double")
    single = plan_grid([6.0, 5.0, 3.5], 500.0, 20.0, 1.0, precision="single")
    assert single.nodes == double.nodes
    assert single.gpu_bytes * 2 == double.gpu_bytes


def test_extra_highpass_removes_slow_drift():
    pytest.importorskip("resampy")
    from pffdtd_backend.postprocess import to_ir

    fs = 20000.0
    t = np.arange(int(2.0 * fs)) / fs
    tone = np.sin(2 * np.pi * 125.0 * t) * np.exp(-t / 0.05)   # gone (-170 dB) by 1 s
    drift = 0.05 * np.sin(2 * np.pi * 3.0 * t)          # sub-10 Hz, like single precision's
    kw = dict(fmax=500.0, out_fs=48000.0, duration=2.0, lowcut_hz=10.0, lowcut_order=4, lowpass_order=4,
              air_absorption=False, Tc=20.0, rh=50.0)
    clean = to_ir(tone[None], 1 / fs, **kw)[0]
    plain = to_ir((tone + drift)[None], 1 / fs, **kw)[0]
    fixed = to_ir((tone + drift)[None], 1 / fs, **kw, extra_highpass_hz=PFFDTD_SINGLE_HIGHPASS_HZ)[0]
    late = slice(int(1.0 * 48000), None)                 # the tone has decayed; what is left is drift
    assert np.sqrt(np.mean(fixed[late] ** 2)) < 0.1 * np.sqrt(np.mean(plain[late] ** 2))
    # the 125 Hz content is untouched (within 0.2 dB)
    early = slice(0, int(0.2 * 48000))
    ratio = np.sum(fixed[early] ** 2) / np.sum(clean[early] ** 2)
    assert abs(10 * np.log10(ratio)) < 0.2


def test_runtime_estimate_per_precision_matches_the_2080ti_measurements():
    from utils.pffdtd_grid import estimate_runtime_s

    # measured 2026-11-22 (tests/benchmarks/precision_rt): (nodes, steps, double s, single s)
    for nodes, steps, t_double, t_single in [(3.36e6, 89256, 66, 44), (7.4e6, 178500, 197, 123), (31.7e6, 142800, 512, 284)]:
        assert abs(estimate_runtime_s(int(nodes), steps, "double") / t_double - 1) < 0.2
        assert abs(estimate_runtime_s(int(nodes), steps, "single") / t_single - 1) < 0.2
