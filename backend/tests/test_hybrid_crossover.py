# backend/tests/test_hybrid_crossover.py
"""The crossover of the hybrid wave + geometric simulation (utils/hybrid_crossover.py).

* Schroeder frequency and the plan: factor, manual value, limits, and a wave-solver cap that
  lowers the crossover (never the reverse);
* the Linkwitz-Riley pair: a response joined with itself keeps a flat magnitude and its energy,
  the low branch is -6 dB at the crossover, nothing arrives before the direct sound;
* joining two different responses takes the low band from the wave one and the high band from
  the geometric one, for mono and for 4 channels, with unequal lengths;
* the overlap mismatch and the optional level match;
* the wave solver's world-axis ambisonics turned into the listener frame.
"""

import numpy as np
import pytest

from config.constants import (
    HYBRID_CROSSOVER_FALLBACK_HZ,
    HYBRID_CROSSOVER_MAX_HZ,
    HYBRID_CROSSOVER_MIN_HZ,
    HYBRID_LEVEL_MATCH_MAX_DB,
    HYBRID_WAVE_FMAX_MARGIN,
    PFFDTD_FMAX_MIN,
)
from pffdtd_backend.listener_frame import world_to_listener_foa
from utils.hybrid_crossover import (
    band_energy,
    combine,
    lr4_sos,
    overlap_mismatch_db,
    plan_crossover,
    schroeder_frequency,
    split_bands,
)

FS = 48000


def _magnitude_db(x, f):
    spectrum = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / FS)
    return 20 * np.log10(np.abs(spectrum[np.argmin(np.abs(freqs - f))]))


def _tone(f, n=FS, amplitude=1.0):
    return amplitude * np.sin(2 * np.pi * f * np.arange(n) / FS)


# ── plan ─────────────────────────────────────────────────────────────────────

def test_schroeder_frequency():
    assert schroeder_frequency(1.0, 100.0) == pytest.approx(200.0)
    assert schroeder_frequency(0.5, 200.0) == pytest.approx(100.0)
    assert schroeder_frequency(0.0, 100.0) is None
    assert schroeder_frequency(1.0, 0.0) is None
    assert schroeder_frequency(float("nan"), 100.0) is None


def test_plan_follows_the_schroeder_frequency():
    plan = plan_crossover("schroeder", 1.0, 100.0)
    assert plan.schroeder_hz == pytest.approx(200.0)
    assert plan.crossover_hz == pytest.approx(200.0)
    assert plan.wave_fmax == pytest.approx(200.0 * HYBRID_WAVE_FMAX_MARGIN)
    assert plan.limited_by is None and plan.notes == []
    assert plan_crossover("schroeder", 1.0, 100.0, factor=2.0).crossover_hz == pytest.approx(400.0)


def test_manual_crossover():
    plan = plan_crossover("manual", 1.0, 100.0, manual_hz=315.0)
    assert plan.crossover_hz == pytest.approx(315.0)
    assert plan.schroeder_hz == pytest.approx(200.0)       # still reported
    with pytest.raises(ValueError):
        plan_crossover("manual", 1.0, 100.0)
    with pytest.raises(ValueError):
        plan_crossover("octave", 1.0, 100.0)


def test_unknown_room_falls_back():
    plan = plan_crossover("schroeder", None, None)
    assert plan.crossover_hz == pytest.approx(HYBRID_CROSSOVER_FALLBACK_HZ)
    assert plan.schroeder_hz is None and plan.notes


def test_limits():
    big_hall = plan_crossover("schroeder", 2.0, 20000.0)    # f_s = 20 Hz
    assert big_hall.crossover_hz == pytest.approx(HYBRID_CROSSOVER_MIN_HZ) and big_hall.limited_by == "min"
    assert big_hall.wave_fmax >= PFFDTD_FMAX_MIN            # the solver's own minimum
    closet = plan_crossover("schroeder", 3.0, 1.0, wave_fmax_cap=4000.0)   # f_s = 3464 Hz
    assert closet.crossover_hz <= HYBRID_CROSSOVER_MAX_HZ


def test_a_wave_cap_lowers_the_crossover():
    plan = plan_crossover("schroeder", 1.0, 25.0, wave_fmax_cap=300.0)    # f_s = 400 Hz
    assert plan.limited_by == "wave_fmax_cap"
    assert plan.wave_fmax == pytest.approx(300.0)
    assert plan.crossover_hz == pytest.approx(300.0 / HYBRID_WAVE_FMAX_MARGIN)
    assert any("capped" in note for note in plan.notes)


# ── filters ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("fc", [60.0, 200.0, 800.0])
def test_joined_with_itself_is_all_pass(fc):
    rng = np.random.default_rng(0)
    x = rng.standard_normal(FS)
    y, info = combine(x, x, FS, fc)
    assert info["overlap_mismatch_db"] == pytest.approx(0.0, abs=1e-6)
    spectrum_x, spectrum_y = np.abs(np.fft.rfft(x)), np.abs(np.fft.rfft(y))
    freqs = np.fft.rfftfreq(len(x), 1 / FS)
    band = (freqs > 20) & (freqs < 20000)
    ratio_db = 20 * np.log10(spectrum_y[band] / spectrum_x[band])
    # smoothed over 1/3 octave the magnitude is flat (the raw ratio only carries the truncated tail)
    assert abs(np.median(ratio_db)) < 0.05
    assert np.sum(y ** 2) == pytest.approx(np.sum(x ** 2), rel=0.01)


def test_branches_are_6_db_down_at_the_crossover():
    fc = 250.0
    impulse = np.zeros(FS)
    impulse[0] = 1.0
    low, high = split_bands(impulse, FS, fc)
    assert _magnitude_db(low, fc) == pytest.approx(-6.02, abs=0.1)
    assert _magnitude_db(high, fc) == pytest.approx(-6.02, abs=0.1)
    assert _magnitude_db(low, fc * 4) < -45        # 24 dB / octave
    assert _magnitude_db(high, fc / 4) < -45
    assert lr4_sos(fc, FS, "low").shape == (2, 6)
    with pytest.raises(ValueError):
        lr4_sos(FS, FS, "low")


def test_nothing_arrives_before_the_direct_sound():
    onset = 2400                                    # 50 ms of propagation
    x = np.zeros(FS // 2)
    x[onset] = 1.0
    y, _ = combine(x, x, FS, 120.0)
    assert np.max(np.abs(y[:onset])) == 0.0         # causal filters: no pre-ringing
    assert np.argmax(np.abs(y)) == onset            # the peak stays on the arrival


def test_low_band_from_the_wave_high_band_from_the_rays():
    fc = 200.0
    wave = _tone(50.0) + _tone(2000.0, amplitude=0.5)        # its 2 kHz content must be dropped
    rays = _tone(2000.0, amplitude=2.0) + _tone(50.0, amplitude=3.0)   # its 50 Hz content must be dropped
    y, _ = combine(wave, rays, FS, fc)
    steady = y[FS // 4:]
    assert _magnitude_db(steady, 50.0) == pytest.approx(_magnitude_db(_tone(50.0)[FS // 4:], 50.0), abs=0.2)
    assert _magnitude_db(steady, 2000.0) == pytest.approx(_magnitude_db(_tone(2000.0, amplitude=2.0)[FS // 4:], 2000.0), abs=0.2)


def test_channels_and_lengths():
    rng = np.random.default_rng(1)
    wave = rng.standard_normal((1000, 4))
    rays = rng.standard_normal((3000, 4))
    y, _ = combine(wave, rays, FS, 300.0)
    assert y.shape == (3000, 4)
    mono, _ = combine(wave[:, 0], rays[:, 0], FS, 300.0)
    assert mono.shape == (3000,)
    np.testing.assert_allclose(mono, y[:, 0])
    with pytest.raises(ValueError):
        combine(wave, rays[:, :1], FS, 300.0)


def test_overlap_mismatch_and_level_match():
    fc = 200.0
    rng = np.random.default_rng(2)
    rays = rng.standard_normal(FS)
    wave = rays * 10 ** (4.0 / 20)                  # the wave part 4 dB hot
    assert overlap_mismatch_db(wave, rays, FS, fc) == pytest.approx(4.0, abs=0.01)
    plain, info = combine(wave, rays, FS, fc)
    assert info == {"overlap_mismatch_db": pytest.approx(4.0, abs=0.01), "wave_gain_db": 0.0}
    matched, info = combine(wave, rays, FS, fc, level_match=True)
    assert info["wave_gain_db"] == pytest.approx(-4.0, abs=0.01)
    reference, _ = combine(rays, rays, FS, fc)
    np.testing.assert_allclose(matched, reference, atol=1e-6)
    assert not np.allclose(plain, reference, atol=1e-3)
    # the correction is limited
    _, info = combine(rays * 100.0, rays, FS, fc, level_match=True)
    assert info["wave_gain_db"] == pytest.approx(-HYBRID_LEVEL_MATCH_MAX_DB)
    assert overlap_mismatch_db(np.zeros(FS), rays, FS, fc) is None


def test_band_energy_is_parseval():
    x = _tone(100.0)
    assert band_energy(x, FS, 50.0, 200.0) == pytest.approx(np.sum(x ** 2) / 2, rel=1e-3)   # one-sided spectrum
    assert band_energy(x, FS, 1000.0, 2000.0) < 1e-12


def test_world_to_listener_foa():
    # Channels first [W, Y, Z, X]. A plane wave from world -Y (the listener's front): world Y = -1
    world = np.array([[1.0], [-1.0], [0.0], [0.0]])
    np.testing.assert_allclose(world_to_listener_foa(world), [[1.0], [0.0], [0.0], [1.0]])    # front -> X = +1
    # From world +X (the listener's left): world X = +1 -> listener Y = +1
    world = np.array([[1.0], [0.0], [0.0], [1.0]])
    np.testing.assert_allclose(world_to_listener_foa(world), [[1.0], [1.0], [0.0], [0.0]])
    # From above: unchanged
    world = np.array([[1.0], [0.0], [1.0], [0.0]])
    np.testing.assert_allclose(world_to_listener_foa(world), world)
    mono = np.ones((1, 8))
    assert world_to_listener_foa(mono).shape == (1, 8)


def test_wave_grid_is_refined_for_low_crossovers_and_near_surfaces():
    from config.constants import HYBRID_WAVE_MAX_CELL_M, PFFDTD_PPW_MAX, PFFDTD_SEED_CLEARANCE_CELLS, PFFDTD_SPEED_OF_SOUND
    from utils.hybrid_crossover import wave_ppw

    cell = lambda fmax, ppw: PFFDTD_SPEED_OF_SOUND / (fmax * ppw)  # noqa: E731
    # a small room's crossover: the requested resolution is already fine
    assert wave_ppw(12.0, 350.0) == (12.0, None)
    # a large hall (wave to 100 Hz): 8 ppw would be 43 cm cells
    ppw, note = wave_ppw(8.0, 100.0)
    assert cell(100.0, ppw) == pytest.approx(HYBRID_WAVE_MAX_CELL_M)
    assert "refined" in note
    # a source 30 cm from a wall needs cells it clears by the solver's 3, with a margin
    ppw, note = wave_ppw(8.0, 100.0, min_seed_distance=0.30)
    assert PFFDTD_SEED_CLEARANCE_CELLS * cell(100.0, ppw) < 0.30
    assert "30 cm from a surface" in note
    # far from every surface: the cell limit decides, not the seeds
    assert wave_ppw(8.0, 100.0, min_seed_distance=5.0)[0] == pytest.approx(wave_ppw(8.0, 100.0)[0])
    # never beyond what the solver accepts; an unusable distance is ignored
    assert wave_ppw(8.0, 100.0, min_seed_distance=0.001)[0] == PFFDTD_PPW_MAX
    assert wave_ppw(12.0, 350.0, min_seed_distance=float("nan")) == (12.0, None)
