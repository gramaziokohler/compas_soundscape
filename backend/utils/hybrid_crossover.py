"""Crossover between a wave-based and a geometric impulse response (the hybrid simulation).

Below the Schroeder frequency a room answers with separate modes, which only a wave solver
models; above it the modes overlap and geometric acoustics (image sources, rays) holds. The
hybrid simulation runs both and joins them at a crossover frequency:

    f_s = 2000 * sqrt(T60 / V)            (Schroeder; T60 in s, V in m^3)

``plan_crossover`` picks the crossover (a multiple of f_s, or a given value) and the highest
frequency the wave solver must reach; ``combine`` joins two responses that share the sample
rate, the time origin (propagation delay kept) and the level reference (free field at 1 m).

The filters are a 4th-order Linkwitz-Riley pair (two cascaded 2nd-order Butterworth sections per
branch). Its low and high outputs are in phase at every frequency, so two coherent responses sum
to a flat magnitude (the sum is an all-pass) and the crossover adds no pre-ringing ahead of the
direct sound — which a zero-phase pair would. Each branch is -6 dB at the crossover.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional

import numpy as np
from scipy.signal import butter, sosfilt

from config.constants import (
    HYBRID_CROSSOVER_FALLBACK_HZ,
    HYBRID_CROSSOVER_MAX_HZ,
    HYBRID_CROSSOVER_MIN_HZ,
    HYBRID_LEVEL_MATCH_MAX_DB,
    HYBRID_WAVE_FMAX_MARGIN,
    HYBRID_WAVE_MAX_CELL_M,
    HYBRID_WAVE_SEED_CLEARANCE_MARGIN,
    PFFDTD_FMAX_MAX,
    PFFDTD_FMAX_MIN,
    PFFDTD_PPW_MAX,
    PFFDTD_SEED_CLEARANCE_CELLS,
    PFFDTD_SPEED_OF_SOUND,
)

CROSSOVER_SCHROEDER = "schroeder"
CROSSOVER_MANUAL = "manual"


def schroeder_frequency(rt60: float, volume: float) -> Optional[float]:
    """2000 sqrt(T60 / V) in Hz; None when either is unknown or not positive."""
    if not (rt60 and volume) or rt60 <= 0 or volume <= 0 or not np.isfinite(rt60) or not np.isfinite(volume):
        return None
    return float(2000.0 * np.sqrt(rt60 / volume))


@dataclass
class CrossoverPlan:
    crossover_hz: float            # where the two responses are joined
    wave_fmax: float               # highest frequency the wave solver must resolve
    schroeder_hz: Optional[float]  # of the room, when T60 and V are known
    rt60: Optional[float]
    volume_m3: Optional[float]
    mode: str
    factor: float
    limited_by: Optional[str] = None   # "wave_fmax_cap" | "min" | "max" | None
    notes: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def plan_crossover(
    mode: str,
    rt60: Optional[float],
    volume: Optional[float],
    manual_hz: Optional[float] = None,
    factor: float = 1.0,
    wave_fmax_cap: float = PFFDTD_FMAX_MAX,
    margin: float = HYBRID_WAVE_FMAX_MARGIN,
) -> CrossoverPlan:
    """The crossover frequency and the wave solver's fmax.

    ``mode`` "schroeder": ``factor`` x the Schroeder frequency of (``rt60``, ``volume``), falling
    back to HYBRID_CROSSOVER_FALLBACK_HZ when they are unknown; "manual": ``manual_hz``.
    The wave solver runs to ``margin`` x the crossover (its response is low-passed at its fmax, so
    the low branch must have rolled off by then), never above ``wave_fmax_cap``: a cap that binds
    lowers the crossover instead, and says so.
    """
    notes: list[str] = []
    f_s = schroeder_frequency(rt60 or 0.0, volume or 0.0)
    if mode == CROSSOVER_MANUAL:
        if not manual_hz or manual_hz <= 0:
            raise ValueError("A manual crossover needs a positive frequency")
        target = float(manual_hz)
    elif mode == CROSSOVER_SCHROEDER:
        if f_s is None:
            target = HYBRID_CROSSOVER_FALLBACK_HZ
            notes.append(
                f"The room's Schroeder frequency is unknown (no decay time or air volume); "
                f"crossover set to {HYBRID_CROSSOVER_FALLBACK_HZ:.0f} Hz."
            )
        else:
            target = float(factor) * f_s
    else:
        raise ValueError(f"Unknown crossover mode '{mode}'; '{CROSSOVER_SCHROEDER}' or '{CROSSOVER_MANUAL}'")

    limited = None
    crossover = target
    if crossover < HYBRID_CROSSOVER_MIN_HZ:
        crossover, limited = HYBRID_CROSSOVER_MIN_HZ, "min"
        notes.append(f"Crossover raised from {target:.0f} Hz to the {HYBRID_CROSSOVER_MIN_HZ:.0f} Hz minimum.")
    if crossover > HYBRID_CROSSOVER_MAX_HZ:
        crossover, limited = HYBRID_CROSSOVER_MAX_HZ, "max"
        notes.append(f"Crossover lowered from {target:.0f} Hz to the {HYBRID_CROSSOVER_MAX_HZ:.0f} Hz maximum.")

    cap = float(min(max(wave_fmax_cap, PFFDTD_FMAX_MIN), PFFDTD_FMAX_MAX))
    wave_fmax = crossover * margin
    if wave_fmax > cap:
        lowered = cap / margin
        notes.append(
            f"The wave solver is capped at {cap:.0f} Hz, so the crossover is {lowered:.0f} Hz instead of "
            f"{crossover:.0f} Hz: the band between is modelled by rays only."
        )
        crossover, wave_fmax, limited = lowered, cap, "wave_fmax_cap"
    wave_fmax = max(wave_fmax, PFFDTD_FMAX_MIN)
    return CrossoverPlan(
        crossover_hz=round(float(crossover), 2), wave_fmax=round(float(wave_fmax), 2),
        schroeder_hz=None if f_s is None else round(f_s, 2),
        rt60=None if not rt60 else round(float(rt60), 3), volume_m3=None if not volume else round(float(volume), 2),
        mode=mode, factor=float(factor), limited_by=limited, notes=notes,
    )


def wave_ppw(ppw: float, wave_fmax: float, min_seed_distance: Optional[float] = None) -> tuple[float, Optional[str]]:
    """Points per wavelength the wave part must run at: ``(ppw, note or None)``.

    At least ``ppw``; more when the cell that gives, c / (fmax ppw), is larger than
    HYBRID_WAVE_MAX_CELL_M or leaves a source or listener closer to a surface than the solver
    accepts (``min_seed_distance`` in m, the smallest such distance). Never above PFFDTD_PPW_MAX:
    a point nearer than that allows is left to the solver's own check, which names it.
    """
    cell = PFFDTD_SPEED_OF_SOUND / (wave_fmax * ppw)
    wanted = min(cell, HYBRID_WAVE_MAX_CELL_M)
    reason = None if wanted == cell else f"cells no larger than {HYBRID_WAVE_MAX_CELL_M * 100:.0f} cm"
    if min_seed_distance is not None and np.isfinite(min_seed_distance) and min_seed_distance > 0:
        for_seeds = min_seed_distance / (PFFDTD_SEED_CLEARANCE_CELLS * HYBRID_WAVE_SEED_CLEARANCE_MARGIN)
        if for_seeds < wanted:
            wanted = for_seeds
            reason = f"a source or listener {min_seed_distance * 100:.0f} cm from a surface"
    needed = min(max(float(ppw), PFFDTD_SPEED_OF_SOUND / (wave_fmax * wanted)), PFFDTD_PPW_MAX)
    if needed <= ppw + 1e-9:
        return float(ppw), None
    return float(needed), (
        f"Wave grid refined from {ppw:g} to {needed:.0f} points per wavelength at {wave_fmax:.0f} Hz "
        f"({PFFDTD_SPEED_OF_SOUND / (wave_fmax * needed) * 100:.0f} cm cells) for {reason}."
    )


def lr4_sos(crossover_hz: float, fs: float, kind: str) -> np.ndarray:
    """4th-order Linkwitz-Riley low-pass or high-pass ("low" / "high") as second-order sections."""
    if not 0.0 < crossover_hz < fs / 2.0:
        raise ValueError(f"The crossover must lie between 0 and {fs / 2:.0f} Hz, got {crossover_hz}")
    section = butter(2, crossover_hz, btype=kind, fs=fs, output="sos")
    return np.vstack([section, section])


def _columns(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    return x[:, None] if x.ndim == 1 else x


def split_bands(x: np.ndarray, fs: float, crossover_hz: float) -> tuple[np.ndarray, np.ndarray]:
    """``(low, high)`` branches of ``x`` ((samples,) or (samples, channels)); low + high is all-pass ``x``."""
    low = sosfilt(lr4_sos(crossover_hz, fs, "low"), x, axis=0)
    high = sosfilt(lr4_sos(crossover_hz, fs, "high"), x, axis=0)
    return low, high


def band_energy(x: np.ndarray, fs: float, lo: float, hi: float) -> float:
    """Energy of the first channel of ``x`` between ``lo`` and ``hi`` Hz (from its spectrum)."""
    signal = _columns(x)[:, 0]
    if len(signal) == 0:
        return 0.0
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1.0 / fs)
    band = (freqs >= lo) & (freqs < hi)
    return float(np.sum(np.abs(spectrum[band]) ** 2) / len(signal))


def overlap_mismatch_db(wave: np.ndarray, geometric: np.ndarray, fs: float, crossover_hz: float) -> Optional[float]:
    """Wave level minus geometric level (dB) in the octave centred on the crossover — the band both
    methods model. Near 0 dB the two agree there; a large value means the join will show."""
    lo, hi = crossover_hz / np.sqrt(2.0), crossover_hz * np.sqrt(2.0)
    e_wave, e_geo = band_energy(wave, fs, lo, hi), band_energy(geometric, fs, lo, hi)
    if e_wave <= 0.0 or e_geo <= 0.0:
        return None
    return float(10.0 * np.log10(e_wave / e_geo))


def combine(
    wave: np.ndarray,
    geometric: np.ndarray,
    fs: float,
    crossover_hz: float,
    level_match: bool = False,
) -> tuple[np.ndarray, dict]:
    """Low band of ``wave`` + high band of ``geometric``: ``(response, info)``.

    Both are (samples,) or (samples, channels) with the same channel count, sample rate, time
    origin and level reference; the shorter one is zero-padded. ``level_match`` scales the wave
    branch so its level in the crossover octave equals the geometric one (limited to
    +/- HYBRID_LEVEL_MATCH_MAX_DB): for rooms whose materials the two engines model differently.
    ``info``: the overlap mismatch (dB, wave minus geometric) and the gain applied to the wave.
    """
    mono = np.asarray(wave).ndim == 1 and np.asarray(geometric).ndim == 1
    w, g = _columns(wave), _columns(geometric)
    if w.shape[1] != g.shape[1]:
        raise ValueError(f"Channel counts differ: wave {w.shape[1]}, geometric {g.shape[1]}")
    n = max(len(w), len(g))
    w = np.pad(w, ((0, n - len(w)), (0, 0)))
    g = np.pad(g, ((0, n - len(g)), (0, 0)))

    mismatch = overlap_mismatch_db(w, g, fs, crossover_hz)
    gain_db = 0.0
    if level_match and mismatch is not None:
        gain_db = float(np.clip(-mismatch, -HYBRID_LEVEL_MATCH_MAX_DB, HYBRID_LEVEL_MATCH_MAX_DB))
        w = w * 10.0 ** (gain_db / 20.0)

    low, _ = split_bands(w, fs, crossover_hz)
    _, high = split_bands(g, fs, crossover_hz)
    out = low + high
    info = {
        "overlap_mismatch_db": None if mismatch is None else round(mismatch, 2),
        "wave_gain_db": round(gain_db, 2),
    }
    return (out[:, 0] if mono else out), info

