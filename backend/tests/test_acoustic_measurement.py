# backend/tests/test_acoustic_measurement.py
"""Unit tests for the robust acoustic-metrics estimation.

Covers the artifacts that previously inflated RT60 and corrupted the
time-windowed metrics:
  - RT60 recovery from a known exponential decay (with propagation delay +
    noise floor),
  - EDT ≈ RT60 for single-slope decays,
  - DRR / C50 / D50 anchored at the direct arrival (not sample 0),
  - rejection of truncated / noise-tail-dominated IRs instead of reporting a
    fabricated value,
  - regression against a real pyroomacoustics ISM shoebox RIR.
"""

import numpy as np
import pytest

from utils.acoustic_measurement import AcousticMeasurement

FS = 44100


def _exponential_decay_rir(t60: float, duration_s: float, delay_s: float, noise_std: float, seed: int = 0) -> np.ndarray:
    """Synthetic IR: propagation delay + direct spike + exponential decay + noise."""
    rng = np.random.default_rng(seed)
    n = int(duration_s * FS)
    t = np.arange(n) / FS
    alpha = 6.907755278982137 / t60  # 6*ln(10)/t60 → amplitude decays 60 dB in t60
    rir = np.exp(-alpha * t) * rng.standard_normal(n)
    i_delay = int(delay_s * FS)
    rir[:i_delay] = 0.0
    rir[i_delay] += 1.0  # direct spike
    if noise_std > 0:
        rir += noise_std * rng.standard_normal(n)
    return rir


def test_rt60_recovers_known_exponential_decay():
    t60 = 1.5
    rir = _exponential_decay_rir(t60=t60, duration_s=2.5, delay_s=0.05, noise_std=1e-4)

    rt60, range_db = AcousticMeasurement._estimate_rt60_robust(rir, FS, decay_db=30.0)

    assert rt60 is not None, f"RT60 could not be estimated (range={range_db:.1f} dB)"
    assert range_db >= 15.0
    assert 1.5 * 0.85 <= rt60 <= 1.5 * 1.15, f"RT60={rt60:.3f}s expected ~{t60}s"


def test_edt_approximates_rt60_for_single_slope_decay():
    rir = _exponential_decay_rir(t60=1.5, duration_s=2.5, delay_s=0.05, noise_std=1e-4)

    rt60, _ = AcousticMeasurement._estimate_rt60_robust(rir, FS, decay_db=30.0)
    edt, _ = AcousticMeasurement._estimate_rt60_robust(
        rir, FS, decay_db=10.0, min_range_db=6.0  # mirrors calculate_acoustic_parameters_from_rir
    )

    assert edt is not None
    # For a single-slope exponential decay EDT == RT60
    assert 0.75 <= edt / rt60 <= 1.25, f"EDT/RT60 = {edt / rt60:.3f}"


def test_drr_anchored_at_direct_arrival_not_sample_zero():
    rng = np.random.default_rng(1)
    n = int(2.0 * FS)
    win = int(0.002 * FS)  # direct window after arrival

    # Rebuild the same reverb tail for two different propagation delays and
    # verify DRR is delay-invariant (the old code anchored at sample 0 and
    # collapsed to ≈ -100 dB for delays > 5 ms).
    def build(delay_s):
        i_dir = int(delay_s * FS)
        rir = np.zeros(n)
        rir[i_dir] = 1.0
        rir[i_dir + win:] = 0.05 * rng.standard_normal(n - i_dir - win)
        return rir

    drr_short = AcousticMeasurement._calculate_drr(build(0.005), FS)
    drr_far = AcousticMeasurement._calculate_drr(build(0.100), FS)

    assert drr_short is not None and drr_far is not None
    # direct = 1.0 spike; reverb = 0.05^2 * (n - i_dir - win) → ≈ -23 dB.
    # The old sample-0 window returned ≈ -100 dB for far sources.
    assert -26 <= drr_short <= -20, f"short-delay DRR off: {drr_short:.1f} dB"
    assert -26 <= drr_far <= -20, f"far-delay DRR collapsed: {drr_far:.1f} dB"
    assert abs(drr_short - drr_far) < 0.5, f"DRR not delay-invariant: {drr_short:.2f} vs {drr_far:.2f}"


def test_c50_d50_anchored_at_direct_arrival():
    rng = np.random.default_rng(2)
    n = int(2.0 * FS)
    i_dir = int(0.05 * FS)
    early_span = int(0.05 * FS)

    rir = np.zeros(n)
    rir[i_dir] = 1.0  # direct sound (counts as early)
    early = 0.1 * rng.standard_normal(early_span)
    late = 0.05 * rng.standard_normal(n - i_dir - early_span)
    rir[i_dir:i_dir + early_span] += early
    rir[i_dir + early_span:] += late

    e_early = 1.0 + float(np.sum(early ** 2))
    e_late = float(np.sum(late ** 2))

    c50 = AcousticMeasurement._calculate_clarity(rir, FS, split_time=0.05)
    d50 = AcousticMeasurement._calculate_definition(rir, FS, split_time=0.05)

    assert c50 is not None
    assert d50 is not None
    assert abs(c50 - 10 * np.log10(e_early / e_late)) < 0.3, f"C50={c50:.2f} expected {10*np.log10(e_early/e_late):.2f}"
    assert abs(d50 - e_early / (e_early + e_late)) < 1e-3, f"D50={d50:.4f} expected {e_early/(e_early+e_late):.4f}"


def test_truncated_low_dynamic_range_rir_is_flagged_not_fabricated():
    # Only ~10 dB of decay before a hard truncation into noise — the classic
    # setup where a 30 dB Schroeder fit flattens and extrapolates an inflated
    # RT60. The robust estimator must reject it instead of reporting a value.
    t60 = 3.0  # slow decay → only ~10 dB over the 0.5 s pre-truncation window
    rng = np.random.default_rng(3)
    n = int(2.5 * FS)
    decay_len = int(0.5 * FS)
    alpha = 6.907755278982137 / t60
    t = np.arange(decay_len) / FS
    rir = np.zeros(n)
    rir[:decay_len] = np.exp(-alpha * t) * rng.standard_normal(decay_len) * 0.1
    rir[int(0.05 * FS)] += 1.0
    rir += 1e-3 * rng.standard_normal(n)

    rt60, range_db = AcousticMeasurement._estimate_rt60_robust(rir, FS, decay_db=30.0)

    assert rt60 is None, f"Truncated IR should be rejected, got RT60={rt60:.3f}s (range={range_db:.1f} dB)"


def test_flat_noise_tail_does_not_inflate_rt60():
    # Real decay for 0.5 s (T60 = 1.0 s) followed by a long flat noise tail.
    # A noise-blind fit extends into the tail and flattens the slope.
    rng = np.random.default_rng(4)
    n = int(2.5 * FS)
    decay_len = int(0.5 * FS)
    alpha = 6.907755278982137 / 1.0
    t = np.arange(decay_len) / FS
    rir = np.zeros(n)
    rir[:decay_len] = np.exp(-alpha * t) * rng.standard_normal(decay_len)
    rir[int(0.05 * FS)] += 1.0
    rir += 1e-4 * rng.standard_normal(n)

    rt60, _ = AcousticMeasurement._estimate_rt60_robust(rir, FS, decay_db=30.0)

    assert rt60 is not None, "Real decay with a noise tail should still be measurable"
    assert rt60 <= 1.0 * 1.5, f"RT60={rt60:.3f}s inflated by the noise tail (expected ~1.0s)"


def test_anechoic_rir_yields_no_metrics():
    rir = np.zeros(int(0.2 * FS))
    rir[0] = 1.0
    params = AcousticMeasurement.calculate_acoustic_parameters_from_rir(rir, FS)

    assert params["rt60"] is None or params["rt60_reliable"] is False
    assert params["drr"] is None


def test_parameter_dict_shape_and_spl_semantics():
    rir = _exponential_decay_rir(t60=1.2, duration_s=2.0, delay_s=0.03, noise_std=1e-4)
    params = AcousticMeasurement.calculate_acoustic_parameters_from_rir(rir, FS)

    for key in (
        "rt60", "edt", "c50", "d50", "drr",
        "energy_level_db", "spl", "spl_is_relative",
        "rt60_reliable", "edt_reliable", "rt60_dynamic_range_db",
    ):
        assert key in params, f"missing key {key}"

    assert params["spl"] == params["energy_level_db"]
    assert params["spl_is_relative"] is True


def test_slow_clean_decay_with_low_noise_floor_is_not_nulled():
    """Regression: a slow clean exponential decay (T60 = 7 s) whose record ends
    before the decay completes was reported as RT60 = 0 / unreliable.

    The old asymptote guard estimated a 'noise floor' from the tail mean, which
    for a still-falling decay sits high enough that the Schroeder curve was
    already within margin of the asymptote at the -5 dB start point → range 0.0
    → None. Ray-traced / diffuse late-reverb tails are genuine signal, so the
    guard must be a linearity check, not a tail-mean floor."""
    t60 = 7.0
    rir = _exponential_decay_rir(t60=t60, duration_s=3.0, delay_s=0.05, noise_std=1e-4, seed=5)

    rt60, range_db = AcousticMeasurement._estimate_rt60_robust(rir, FS, decay_db=30.0)

    assert rt60 is not None, f"slow clean decay nulled (range={range_db:.1f} dB)"
    assert 7.0 * 0.8 <= rt60 <= 7.0 * 1.2, f"RT60={rt60:.2f}s expected ~{t60}s"
    assert range_db >= 15.0


def test_real_ism_shoebox_rir_not_inflated():
    """Regression: a real pyroomacoustics ISM-only shoebox RIR must not yield
    an absurd RT60 (Sabine ≈ 0.3 s for this room)."""
    pra = pytest.importorskip("pyroomacoustics")

    l, w, h = 6.0, 5.0, 3.0
    corners = np.array([
        [0, 0, 0], [l, 0, 0], [l, w, 0], [0, w, 0],
        [0, 0, h], [l, 0, h], [l, w, h], [0, w, h],
    ], dtype=float)
    # Outward-facing quad faces
    faces = [
        [0, 3, 2, 1],  # floor  -z
        [4, 5, 6, 7],  # ceiling +z
        [0, 1, 5, 4],  # wall  +x... outward
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ]
    walls = []
    for face in faces:
        mat = pra.Material(energy_absorption=0.4)
        walls.append(pra.wall_factory(corners[face].T, mat.energy_absorption["coeffs"], mat.scattering["coeffs"], "w"))

    room = pra.Room(walls, fs=FS, max_order=8, ray_tracing=False)
    room.add_source([3.0, 2.5, 1.5])
    room.add_microphone([1.0, 1.0, 1.5])
    room.compute_rir()

    rir = np.asarray(room.rir[0][0], dtype=np.float64)
    params = AcousticMeasurement.calculate_acoustic_parameters_from_rir(rir, FS)

    # Sabine for alpha=0.4: 0.161*90/(126*0.4) ≈ 0.29 s. ISM-only is non-diffuse,
    # so we accept up to ~2 s; the pre-fix estimator routinely reported > 5 s.
    if params["rt60"] is not None:
        assert params["rt60"] < 2.0, f"ISM-only RT60 inflated: {params['rt60']:.2f}s"