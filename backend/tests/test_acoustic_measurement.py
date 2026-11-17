# backend/tests/test_acoustic_measurement.py
"""The app's one analysis of an IR (utils.acoustic_measurement.measure_ir, the compas_acoustics
Analyser) and the decay-based export trim (utils.audio_processing.trim_ir).

* the single numbers are the ISO 3382-1 values: mean of the 500 Hz and 1 kHz bands of the same
  per-band analysis, so the card and the per-band table can never disagree;
* a known exponential decay gives its T30 back; D50 is 0-1 in the headline, % per band;
* a band-limited IR (PFFDTD) leaves out the bands above its limit, and the single numbers that
  need them;
* an ambisonic IR is measured on its W channel;
* the trim follows the energy decay (not the direct sound's level) and fades out.
"""

import numpy as np
import pytest

pytest.importorskip("compas_acoustics")

from utils.acoustic_measurement import measure_ir, try_measure_ir  # noqa: E402
from utils.audio_processing import trim_ir  # noqa: E402

FS = 48000


def _decay_ir(t60: float, duration_s: float = 3.0, delay_s: float = 0.02, seed: int = 0) -> np.ndarray:
    """Propagation delay, a direct spike, then exponentially decaying noise (60 dB in t60)."""
    rng = np.random.default_rng(seed)
    n = int(duration_s * FS)
    t = np.arange(n) / FS
    rir = np.exp(-6.907755278982137 / t60 * t) * rng.standard_normal(n) * 0.3
    i_delay = int(delay_s * FS)
    rir[:i_delay] = 0.0
    rir[i_delay] += 1.0
    return rir


def test_headline_is_the_iso_mean_of_the_500_and_1000_hz_bands():
    out = measure_ir(_decay_ir(1.2), FS)
    head, bands = out["acoustic_parameters"], out["acoustic_parameters_bands"]
    freqs = bands["frequency_bands"]
    i500, i1k = freqs.index(500), freqs.index(1000)
    for head_key, band_key in (("t30", "T30"), ("edt", "EDT"), ("c50", "C50"), ("c80", "C80")):
        expected = (bands[band_key][i500] + bands[band_key][i1k]) / 2
        assert head[head_key] == pytest.approx(expected, abs=0.011), head_key
        assert bands[f"{band_key}_overall"] == pytest.approx(head[head_key])
    assert head["d50"] == pytest.approx((bands["D50"][i500] + bands["D50"][i1k]) / 200, abs=1e-3)
    assert 0.0 < head["sti"] < 1.0


def test_known_decay_time_is_recovered_and_reliable():
    out = measure_ir(_decay_ir(1.2), FS)
    head = out["acoustic_parameters"]
    assert head["t30"] == pytest.approx(1.2, rel=0.1)
    assert head["edt"] == pytest.approx(1.2, rel=0.2)
    assert head["t30_reliable"] and head["edt_reliable"]
    assert set(out["acoustic_parameters_bands"]) >= {
        "frequency_bands", "T30", "EDT", "C50", "C80", "D50", "STI", "reliability"}


def test_a_short_record_is_flagged_unreliable():
    # cut after 0.3 s of a 1.2 s decay: about 15 dB of decay, T30 needs 45
    head = measure_ir(_decay_ir(1.2, duration_s=0.3), FS)["acoustic_parameters"]
    assert head["t30_reliable"] is False


def test_band_limit_drops_the_bands_above_it():
    out = measure_ir(_decay_ir(1.0), FS, band_limit_hz=2000.0)
    bands, head = out["acoustic_parameters_bands"], out["acoustic_parameters"]
    for f, t30 in zip(bands["frequency_bands"], bands["T30"]):
        assert (t30 is None) == (f * np.sqrt(2) > 2000.0), f
    assert head["t30"] is not None            # 500 Hz and 1 kHz are inside the limit
    assert head["sti"] is None                # STI needs every band
    low = measure_ir(_decay_ir(1.0), FS, band_limit_hz=1000.0)["acoustic_parameters"]
    assert low["t30"] is None and low["t30_reliable"] is False


def test_an_ambisonic_ir_is_measured_on_w():
    w = _decay_ir(0.8)
    foa = np.column_stack([w, 0.5 * _decay_ir(3.0, seed=1), np.zeros_like(w), np.zeros_like(w)])
    assert measure_ir(foa, FS)["acoustic_parameters"]["t30"] == pytest.approx(
        measure_ir(w, FS)["acoustic_parameters"]["t30"])


def test_silence_is_not_measured():
    with pytest.raises(ValueError):
        measure_ir(np.zeros(FS), FS)
    assert try_measure_ir(np.zeros(FS), FS) == {}


def test_trim_follows_the_energy_decay_and_fades_out():
    t60 = 1.0
    ir = _decay_ir(t60, duration_s=3.0, delay_s=0.0)
    out = trim_ir(ir, FS)
    # -60 dB of the energy decay is reached about t60 after the start (+5 % margin)
    assert out.size / FS == pytest.approx(t60 * 1.05, rel=0.1)
    assert out[-1] == 0.0 and np.allclose(out[: FS // 2], ir[: FS // 2])
    # a near listener (direct sound 40 dB above the reverberation) keeps its whole decay: the cut
    # does not follow the direct sound's peak
    near = ir * 0.01
    near[0] = 1.0
    assert trim_ir(near, FS).size / FS > 0.6


def test_trim_keeps_channels_and_leaves_silence_alone():
    ir = _decay_ir(0.5, duration_s=2.0)
    stacked = np.column_stack([ir, 0.5 * ir]).astype(np.float32)
    out = trim_ir(stacked, FS)
    assert out.ndim == 2 and out.shape[1] == 2 and out.dtype == np.float32
    assert out.shape[0] < stacked.shape[0]
    silent = np.zeros(100)
    assert trim_ir(silent, FS) is silent
