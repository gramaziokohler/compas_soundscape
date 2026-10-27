"""Measured vs simulated comparison of the scene's pairs.

Time axis: the measured one (44.1 kHz, t = 0 at emission). Each simulated IR (48 kHz, re free
field at 1 m) is resampled, given the loudspeaker's phase, cleaned of the domain-edge echo with the
empty-domain control run (the solver is linear: run - (control - control's physical arrivals)),
aligned on the direct sound and scaled by one global gain fitted on the scene's ``gain_pair``. The
measured IR gets the solver's band limits. Both are compared in the same window.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from benchmarks.bras import bras_constants as K
from benchmarks.bras.bras_scene import MeasuredPair, PairGeometry
from benchmarks.bras.bras_signal import (
    band_energy_db,
    band_levels_db,
    bandlimit_like_sim,
    fractional_shift,
    gate,
    resample_ir,
    smooth_db,
    spectrum,
    xcorr_lag_s,
)
from benchmarks.bras.bras_source_phase import SourcePhase
from benchmarks.bras.bras_source_phase import apply as apply_source_phase
from benchmarks.bras.scenes import BandTest
from config.constants import AUDIO_SAMPLE_RATE, PFFDTD_SPEED_OF_SOUND

FS = K.ANALYSIS_FS


@dataclass
class PairResult:
    key: str
    source_id: str
    receiver_id: str
    line_of_sight: bool
    distance_m: float
    offaxis_deg: Optional[float]
    align_shift_ms: float
    direct_level_db: Optional[float]      # simulated - measured direct sound (line-of-sight pairs)
    bands_hz: list
    dl_db: list                           # simulated - measured per band
    mean_abs_dl_db: float
    max_abs_dl_db: float
    curves: dict = field(default_factory=dict, repr=False)   # plotting arrays, not serialised

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if k != "curves"}


NOMINAL_HZ = [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
              2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]


def band_centres(bt: BandTest, fmax: float) -> list:
    """Fractional-octave centres (base 1 kHz, nominal values for octaves / third octaves) whose
    centre lies in the compared band (a quarter band of tolerance at both ends)."""
    hi = bt.fmax_fraction * fmax
    n = bt.bands_per_octave
    tol = 2.0 ** (1.0 / (4 * n))
    ks = np.arange(int(np.floor(n * np.log2(bt.fmin_hz / 1000.0))) - 1, int(np.ceil(n * np.log2(hi / 1000.0))) + 2)
    exact = [1000.0 * 2.0 ** (k / n) for k in ks if bt.fmin_hz / tol <= 1000.0 * 2.0 ** (k / n) <= hi * tol]
    if n in (1, 3):
        return [float(min(NOMINAL_HZ, key=lambda v: abs(np.log2(v / f)))) for f in exact]
    return [float(round(f, 1)) for f in exact]


def metric_band(bt: BandTest, fmax: float) -> tuple[float, float]:
    return bt.fmin_hz, bt.fmax_fraction * fmax


def edge_echo_delay_s(src, rcv, bmin, bmax, ground_z: Optional[float] = None, c: float = PFFDTD_SPEED_OF_SOUND) -> float:
    """Earliest domain-edge echo after the direct sound (image source across each domain face;
    the face under a floor is shielded by it)."""
    s, r = np.asarray(src, np.float64), np.asarray(rcv, np.float64)
    d = float(np.linalg.norm(r - s))
    best = np.inf
    for k in range(3):
        for side, plane in (("min", bmin[k]), ("max", bmax[k])):
            if ground_z is not None and k == 2 and side == "min":
                continue
            img = s.copy()
            img[k] = 2.0 * plane - s[k]
            best = min(best, float(np.linalg.norm(r - img)) - d)
    return best / c


def floor_delay_s(src, rcv, ground_z: Optional[float], c: float = PFFDTD_SPEED_OF_SOUND) -> float:
    """Delay of the floor reflection after the direct sound (0 without a floor)."""
    if ground_z is None:
        return 0.0
    s, r = np.asarray(src, np.float64), np.asarray(rcv, np.float64)
    img = s.copy()
    img[2] = 2.0 * ground_z - s[2]
    return (float(np.linalg.norm(r - img)) - float(np.linalg.norm(r - s))) / c


def _fit_length(x: np.ndarray, n: int) -> np.ndarray:
    return np.pad(x, (0, max(0, n - len(x))))[:n]


def prepare_sim(sim48: np.ndarray, ctl48: Optional[np.ndarray], d_direct: float, echo_delay_s: float, n: int,
                phase: Optional[SourcePhase] = None, physical_delay_s: float = 0.0) -> np.ndarray:
    """Resampled simulated IR without the domain-edge echo, then with the loudspeaker phase.

    The control run's early part (direct sound, and the floor reflection when ``physical_delay_s``
    > 0) is physical and kept; everything after it is the domain edge and is subtracted. The time
    gating needs the solver's compact zero-phase pulses, so the phase (whose low-frequency group
    delay reaches several ms) is applied after the subtraction, never before.
    """
    sim = _fit_length(resample_ir(sim48, AUDIO_SAMPLE_RATE, FS), n)
    if ctl48 is not None:
        ctl = _fit_length(resample_ir(ctl48, AUDIO_SAMPLE_RATE, FS), n)
        t_d = d_direct / PFFDTD_SPEED_OF_SOUND
        keep_end = min(physical_delay_s + K.EDGE_SUBTRACT_KEEP_S, 0.5 * (physical_delay_s + echo_delay_s))
        fade = min(K.FADE_OUT_S, 0.5 * (keep_end - physical_delay_s))  # the fade starts after the last physical arrival
        physical = gate(ctl, FS, 0.0, t_d + keep_end - fade, 0.0, fade)
        sim = sim - (ctl - physical)
    return sim if phase is None else apply_source_phase(sim, FS, phase)


def windows(geom: PairGeometry, bt: BandTest) -> dict:
    t_d = geom.t_direct
    return {"full": (t_d - bt.pre_ms * 1e-3, t_d + bt.gate_ms * 1e-3),
            "direct": (t_d - bt.pre_ms * 1e-3, t_d + K.DIRECT_WINDOW_S)}


def _gated(x, win):
    return gate(x, FS, win[0], win[1], K.FADE_IN_S, K.FADE_OUT_S)


def align_shift_s(meas: np.ndarray, sim: np.ndarray, geom: PairGeometry, bt: BandTest) -> float:
    """Shift (s) that puts the simulated direct sound on the measured one."""
    shift0 = geom.t_direct - geom.d_direct / PFFDTD_SPEED_OF_SOUND
    win = windows(geom, bt)["direct"]
    lag = xcorr_lag_s(_gated(meas, win), _gated(fractional_shift(sim, shift0, FS), win), FS, K.XCORR_MAX_LAG_S)
    return shift0 - lag


def direct_level_db(meas: np.ndarray, sim: np.ndarray, geom: PairGeometry, bt: BandTest, fmax: float) -> float:
    """Simulated - measured energy of the direct sound in the compared band (dB)."""
    win = windows(geom, bt)["direct"]
    f, Hm = spectrum(_gated(meas, win), FS)
    _, Hs = spectrum(_gated(sim, win), FS)
    lo, hi = metric_band(bt, fmax)
    return band_energy_db(f, Hs, lo, hi) - band_energy_db(f, Hm, lo, hi)


def analyze_pair(meas_bl: np.ndarray, sim: np.ndarray, geom: PairGeometry, bt: BandTest, fmax: float) -> PairResult:
    """``meas_bl`` band-limited, ``sim`` aligned and scaled, both on the measured time axis."""
    win = windows(geom, bt)["full"]
    f, Hm = spectrum(_gated(meas_bl, win), FS)
    _, Hs = spectrum(_gated(sim, win), FS)
    bands = band_centres(bt, fmax)
    dl = band_levels_db(f, Hs, bands, bt.bands_per_octave) - band_levels_db(f, Hm, bands, bt.bands_per_octave)
    direct = direct_level_db(meas_bl, sim, geom, bt, fmax) if geom.line_of_sight else None
    f_plot = np.geomspace(K.PLOT_FMIN_HZ, fmax, 400)
    t = np.arange(len(meas_bl)) / FS
    sel = (t >= win[0] - K.FADE_IN_S) & (t <= win[1] + K.FADE_OUT_S)
    return PairResult(
        key=geom.key, source_id=geom.source_id, receiver_id=geom.receiver_id, line_of_sight=geom.line_of_sight,
        distance_m=round(geom.d_direct, 3), offaxis_deg=None if geom.offaxis_direct_deg is None else round(geom.offaxis_direct_deg, 1),
        align_shift_ms=0.0, direct_level_db=None if direct is None else round(direct, 2),
        bands_hz=bands, dl_db=dl.round(2).tolist(), mean_abs_dl_db=round(float(np.mean(np.abs(dl))), 2),
        max_abs_dl_db=round(float(np.max(np.abs(dl))), 2),
        curves={"f": f_plot, "meas_db": smooth_db(f, Hm, bt.smoothing_fraction, f_plot),
                "sim_db": smooth_db(f, Hs, bt.smoothing_fraction, f_plot),
                "meas_power": np.abs(Hm) ** 2, "sim_power": np.abs(Hs) ** 2, "f_lin": f,
                "t": t[sel], "meas_ir": meas_bl[sel], "sim_ir": sim[sel], "window": win, "sim_full": sim},
    )


def analyze_run(measured: list[MeasuredPair], sims: dict, ctls: Optional[dict], geoms: dict, bt: BandTest,
                fmax: float, bounds: tuple, gain_pair: str, phase: Optional[SourcePhase] = None,
                ground_z: Optional[float] = None) -> tuple[float, list[PairResult]]:
    """Global gain (``gain_pair``'s direct sound, else the first line-of-sight pair) and every pair's result."""
    prepared, shifts, meas_bl = {}, {}, {}
    for p in measured:
        g = geoms[p.key]
        echo = edge_echo_delay_s(p.source_position, p.receiver_position, *bounds, ground_z=ground_z)
        floor = floor_delay_s(p.source_position, p.receiver_position, ground_z)
        sim = prepare_sim(sims[p.key], None if ctls is None else ctls[p.key], g.d_direct, echo, len(p.ir), phase, floor)
        meas_bl[p.key] = bandlimit_like_sim(p.ir, FS, fmax)
        shifts[p.key] = align_shift_s(meas_bl[p.key], sim, g, bt)
        prepared[p.key] = fractional_shift(sim, shifts[p.key], FS)
    los = [p for p in measured if geoms[p.key].line_of_sight]
    ref = next((p for p in measured if p.key == gain_pair and geoms[p.key].line_of_sight), los[0] if los else measured[0])
    gain_db = -direct_level_db(meas_bl[ref.key], prepared[ref.key], geoms[ref.key], bt, fmax)
    g = 10.0 ** (gain_db / 20.0)
    results = []
    for p in measured:
        r = analyze_pair(meas_bl[p.key], prepared[p.key] * g, geoms[p.key], bt, fmax)
        r.align_shift_ms = round(shifts[p.key] * 1e3, 3)
        results.append(r)
    return gain_db, results


def average_response(results: list[PairResult], bt: BandTest, fmax: float) -> dict:
    """Power average of the pairs' gated responses (dB), smoothed, and the per-band dL statistics."""
    f = results[0].curves["f_lin"]
    meas = np.mean([r.curves["meas_power"] for r in results], axis=0)
    sim = np.mean([r.curves["sim_power"] for r in results], axis=0)
    f_plot = results[0].curves["f"]
    dl = np.array([r.dl_db for r in results])
    bands = results[0].bands_hz
    avg_dl = band_levels_db(f, np.sqrt(sim), bands, bt.bands_per_octave) - band_levels_db(f, np.sqrt(meas), bands, bt.bands_per_octave)
    return {"f": f_plot, "meas_db": smooth_db(f, np.sqrt(meas), bt.smoothing_fraction, f_plot),
            "sim_db": smooth_db(f, np.sqrt(sim), bt.smoothing_fraction, f_plot), "bands_hz": bands,
            "dl_of_average_db": avg_dl.round(2).tolist(), "dl_mean_db": dl.mean(axis=0).round(2).tolist(),
            "dl_min_db": dl.min(axis=0).round(2).tolist(), "dl_max_db": dl.max(axis=0).round(2).tolist(),
            "mean_abs_dl_db": round(float(np.mean(np.abs(dl))), 2)}
