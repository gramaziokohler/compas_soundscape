"""Turn a measured ``Balloon`` into the compact form both engines consume.

Steps (``process_balloon``):

1. resample to the simulation rate (48 kHz);
2. one common onset crop for every direction (keeps the acoustic-centre delays
   between directions), ``DIRECTIVITY_IR_TAPS`` samples, short fade-out;
3. one global gain so the on-axis energy in ``DIRECTIVITY_NORMALIZE_BAND_HZ`` equals
   that of a unit impulse (the engines' free field at 1 m) — the device's own
   frequency response is kept, no per-direction normalisation;
4. octave-band per-hertz power per direction (``band_powers``: mean |X(f)|^2 over the band on
   a zero-padded FFT, so a unit impulse is 1 in every band and the fit's ``gain`` is a spectral
   magnitude; processing version 1 summed |X|^2, which tilted the gains +3 dB per octave);
5. a first-order fit per band, ``A(u) ≈ g·[a + (1 − a)·(n·u)]``, used by PFFDTD
   (whose reciprocal runs only resolve first-order patterns);
6. a polar preview (horizontal / vertical cuts) for the UI.

The result is written with ``np.savez_compressed`` (~5 MB) and read back by the
pyroomacoustics worker (``load_npz``); the fit alone travels inline to PFFDTD.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

from config.constants import (
    DIRECTIVITY_BAND_CENTER_FREQS,
    DIRECTIVITY_BAND_NFFT,
    DIRECTIVITY_IR_FADE_OUT_SAMPLES,
    DIRECTIVITY_IR_PREROLL_SAMPLES,
    DIRECTIVITY_IR_TAPS,
    DIRECTIVITY_NORMALIZE_BAND_HZ,
    DIRECTIVITY_ONSET_THRESHOLD_DB,
    DIRECTIVITY_PREVIEW_BANDS_HZ,
    DIRECTIVITY_PREVIEW_POINTS,
    DIRECTIVITY_PROCESSING_VERSION,
    DIRECTIVITY_SAMPLE_RATE,
)
from services.directivity_formats import Balloon

_EPS = 1e-20


@dataclass
class ProcessedBalloon:
    directions: np.ndarray      # (n, 3) float32, source frame
    irs: np.ndarray             # (n, taps) float32 at `fs`
    fs: int
    band_hz: list[float]
    band_energy: np.ndarray     # (n, n_bands) per-hertz band power (``band_powers``), stored as "band_energy"
    fit: dict                   # bands_hz, a, gain, axis (n_bands x 3), residual
    preview: dict
    meta: dict = field(default_factory=dict)

    @property
    def n_points(self) -> int:
        return int(self.directions.shape[0])

    @property
    def taps(self) -> int:
        return int(self.irs.shape[1])


# ── signal steps ────────────────────────────────────────────────────────────

def resample_irs(irs: np.ndarray, fs_in: float, fs_out: float) -> np.ndarray:
    if abs(fs_in - fs_out) < 1e-6:
        return np.asarray(irs, dtype=np.float64)
    frac = Fraction(fs_out / fs_in).limit_denominator(1000)
    return resample_poly(np.asarray(irs, dtype=np.float64), frac.numerator, frac.denominator, axis=-1)


def crop_irs(
    irs: np.ndarray,
    taps: int = DIRECTIVITY_IR_TAPS,
    preroll: int = DIRECTIVITY_IR_PREROLL_SAMPLES,
    fade: int = DIRECTIVITY_IR_FADE_OUT_SAMPLES,
    threshold_db: float = DIRECTIVITY_ONSET_THRESHOLD_DB,
) -> tuple[np.ndarray, int]:
    """Common onset crop of all directions -> ``((n, taps), start_sample)``."""
    irs = np.asarray(irs, dtype=np.float64)
    envelope = np.abs(irs).max(axis=0)
    peak = float(envelope.max()) if envelope.size else 0.0
    if peak <= 0:
        raise ValueError("The impulse responses are silent")
    above = np.flatnonzero(envelope > peak * 10 ** (threshold_db / 20.0))
    start = max(int(above[0]) - preroll, 0) if above.size else 0
    out = np.zeros((irs.shape[0], taps))
    seg = irs[:, start:start + taps]
    out[:, :seg.shape[1]] = seg
    if fade > 0 and taps > fade:
        window = 0.5 * (1.0 + np.cos(np.linspace(0.0, np.pi, fade, endpoint=False)))
        out[:, taps - fade:] *= window
    return out, start


def band_energies(irs: np.ndarray, fs: float, centers_hz=DIRECTIVITY_BAND_CENTER_FREQS) -> np.ndarray:
    """Energy of each IR in octave bands around ``centers_hz`` -> ``(n, n_bands)``."""
    irs = np.atleast_2d(np.asarray(irs, dtype=np.float64))
    spectrum = np.abs(np.fft.rfft(irs, axis=-1)) ** 2
    freqs = np.fft.rfftfreq(irs.shape[-1], 1.0 / fs)
    out = np.zeros((irs.shape[0], len(centers_hz)))
    for k, fc in enumerate(centers_hz):
        mask = (freqs >= fc / np.sqrt(2.0)) & (freqs < fc * np.sqrt(2.0))
        if mask.any():
            out[:, k] = spectrum[:, mask].sum(axis=-1) / irs.shape[-1]
    return out


_BAND_POWER_CHUNK = 256  # rows per FFT batch (memory)


def band_powers(irs: np.ndarray, fs: float, centers_hz=DIRECTIVITY_BAND_CENTER_FREQS,
                nfft: int = DIRECTIVITY_BAND_NFFT) -> np.ndarray:
    """Per-hertz power of each IR in octave bands -> ``(n, n_bands)``: mean |X(f)|^2 over the band.

    A unit impulse is 1 in every band (``band_energies`` instead grows with the bandwidth), so
    ``sqrt`` is the band's spectral magnitude. The FFT is zero-padded to ``nfft`` so a short IR
    still has many frequency samples in the low bands.
    """
    irs = np.atleast_2d(np.asarray(irs, dtype=np.float64))
    n_fft = max(int(nfft), irs.shape[-1])
    freqs = np.fft.rfftfreq(n_fft, 1.0 / fs)
    masks = [(freqs >= fc / np.sqrt(2.0)) & (freqs < fc * np.sqrt(2.0)) for fc in centers_hz]
    out = np.zeros((irs.shape[0], len(centers_hz)))
    for r0 in range(0, irs.shape[0], _BAND_POWER_CHUNK):
        spectrum = np.abs(np.fft.rfft(irs[r0:r0 + _BAND_POWER_CHUNK], n=n_fft, axis=-1)) ** 2
        for k, mask in enumerate(masks):
            if mask.any():
                out[r0:r0 + _BAND_POWER_CHUNK, k] = spectrum[:, mask].mean(axis=-1)
    return out


def _range_energy(ir: np.ndarray, fs: float, lo: float, hi: float) -> float:
    spectrum = np.abs(np.fft.rfft(ir)) ** 2
    freqs = np.fft.rfftfreq(ir.size, 1.0 / fs)
    mask = (freqs >= lo) & (freqs < hi)
    return float(spectrum[mask].sum() / ir.size)


def on_axis_index(directions: np.ndarray) -> int:
    return int(np.argmax(np.asarray(directions)[:, 0]))


def normalize_on_axis(irs: np.ndarray, directions: np.ndarray, fs: float,
                      band=DIRECTIVITY_NORMALIZE_BAND_HZ) -> tuple[np.ndarray, float]:
    """Scale all IRs so the on-axis energy in ``band`` equals a unit impulse's."""
    lo, hi = band
    ref = np.zeros(irs.shape[1])
    ref[0] = 1.0
    target = _range_energy(ref, fs, lo, hi)
    actual = _range_energy(irs[on_axis_index(directions)], fs, lo, hi)
    if actual <= _EPS:
        raise ValueError("The on-axis impulse response has no energy between "
                         f"{lo:.0f} and {hi:.0f} Hz")
    gain = float(np.sqrt(target / actual))
    return irs * gain, gain


# ── geometry helpers ────────────────────────────────────────────────────────

def area_weights(directions: np.ndarray) -> np.ndarray:
    """Spherical Voronoi area per direction (uniform when the grid degenerates); sums to 1."""
    dirs = np.asarray(directions, dtype=np.float64)
    n = dirs.shape[0]
    try:
        from scipy.spatial import SphericalVoronoi

        sv = SphericalVoronoi(dirs, radius=1.0, center=np.zeros(3))
        areas = np.asarray(sv.calculate_areas(), dtype=np.float64)
        if areas.shape[0] != n or not np.all(np.isfinite(areas)) or areas.sum() <= 0:
            raise ValueError("bad areas")
    except Exception:
        areas = np.ones(n)
    return areas / areas.sum()


def fit_first_order(directions: np.ndarray, amplitudes: np.ndarray, weights: np.ndarray) -> dict:
    """Weighted least squares ``A ≈ c0 + c·u`` -> ``{a, gain, axis, residual}``.

    ``gain`` = on-axis amplitude ``c0 + |c|``, ``a = c0 / gain`` clamped to [0, 1]
    (Cardioid-family parameter: 1 omni, 0.5 cardioid, 0 figure-eight).
    """
    u = np.asarray(directions, dtype=np.float64)
    amp = np.asarray(amplitudes, dtype=np.float64)
    w = np.sqrt(np.asarray(weights, dtype=np.float64))
    design = np.column_stack([np.ones(u.shape[0]), u])
    theta, *_ = np.linalg.lstsq(design * w[:, None], amp * w, rcond=None)
    c0, c = float(theta[0]), theta[1:]
    cn = float(np.linalg.norm(c))
    axis = c / cn if cn > 1e-12 else np.array([1.0, 0.0, 0.0])
    gain = c0 + cn
    if gain <= 1e-12:
        a, gain = 1.0, 0.0
    else:
        a = float(np.clip(c0 / gain, 0.0, 1.0))
    model = design @ theta
    denom = float(np.sqrt(np.sum((w * amp) ** 2)))
    residual = float(np.sqrt(np.sum((w * (amp - model)) ** 2)) / denom) if denom > 0 else 0.0
    return {"a": a, "gain": float(gain), "axis": axis.tolist(), "residual": residual}


def fit_all_bands(directions: np.ndarray, band_power: np.ndarray, band_hz) -> dict:
    """First-order fit per band of the per-hertz band power (``band_powers``): ``gain`` is the
    on-axis spectral magnitude of the band (1 for a unit impulse)."""
    weights = area_weights(directions)
    amps = np.sqrt(np.maximum(band_power, 0.0))
    fits = [fit_first_order(directions, amps[:, k], weights) for k in range(amps.shape[1])]
    return {
        "bands_hz": [float(f) for f in band_hz],
        "a": [f["a"] for f in fits],
        "gain": [f["gain"] for f in fits],
        "axis": [f["axis"] for f in fits],
        "residual": [f["residual"] for f in fits],
    }


def _nearest(directions: np.ndarray, probes: np.ndarray) -> np.ndarray:
    return np.argmax(np.asarray(probes) @ np.asarray(directions).T, axis=1)


def preview_summary(directions: np.ndarray, irs: np.ndarray, fs: float,
                    bands_hz=DIRECTIVITY_PREVIEW_BANDS_HZ, n_points: int = DIRECTIVITY_PREVIEW_POINTS) -> dict:
    """Polar cuts in dB re on-axis: horizontal (0 front, 90 left) and vertical (0 front, 90 up)."""
    amp = np.sqrt(np.maximum(band_powers(irs, fs, bands_hz), 0.0))
    on = on_axis_index(directions)
    back = int(np.argmin(np.asarray(directions)[:, 0]))
    ref = np.maximum(amp[on], _EPS)
    angles = np.linspace(0.0, 2 * np.pi, n_points, endpoint=False)
    horizontal = np.column_stack([np.cos(angles), np.sin(angles), np.zeros_like(angles)])
    vertical = np.column_stack([np.cos(angles), np.zeros_like(angles), np.sin(angles)])
    h_idx, v_idx = _nearest(directions, horizontal), _nearest(directions, vertical)
    to_db = lambda rows: (20.0 * np.log10(np.maximum(rows, _EPS) / ref)).T.round(2).tolist()  # noqa: E731
    return {
        "bands_hz": [float(f) for f in bands_hz],
        "angle_step_deg": 360.0 / n_points,
        "horizontal_db": to_db(amp[h_idx]),
        "vertical_db": to_db(amp[v_idx]),
        "front_back_db": (20.0 * np.log10(ref / np.maximum(amp[back], _EPS))).round(2).tolist(),
    }


def front_direction_angle_deg(fit: dict, lo: float = 1000.0, hi: float = 4000.0) -> float:
    """Angle between +x and the mean first-order axis of the bands in ``[lo, hi]`` Hz (self-check)."""
    axes = [np.asarray(ax) for fc, ax in zip(fit["bands_hz"], fit["axis"]) if lo <= fc <= hi]
    if not axes:
        return 0.0
    mean = np.mean(axes, axis=0)
    norm = float(np.linalg.norm(mean))
    if norm < 1e-9:
        return 0.0
    return float(np.degrees(np.arccos(np.clip(mean[0] / norm, -1.0, 1.0))))


# ── pipeline + storage ──────────────────────────────────────────────────────

def process_balloon(balloon: Balloon, fs_out: int = DIRECTIVITY_SAMPLE_RATE) -> ProcessedBalloon:
    dirs = np.asarray(balloon.directions, dtype=np.float64)
    irs = resample_irs(balloon.irs, balloon.fs, fs_out)
    irs, start = crop_irs(irs)
    irs, gain = normalize_on_axis(irs, dirs, fs_out)
    band_hz = [float(f) for f in DIRECTIVITY_BAND_CENTER_FREQS]
    power = band_powers(irs, fs_out, band_hz)
    fit = fit_all_bands(dirs, power, band_hz)
    return ProcessedBalloon(
        directions=dirs.astype(np.float32),
        irs=irs.astype(np.float32),
        fs=int(fs_out),
        band_hz=band_hz,
        band_energy=power,
        fit=fit,
        preview=preview_summary(dirs, irs, fs_out),
        meta={
            "format": balloon.fmt,
            "label": balloon.label,
            "fs_in": float(balloon.fs),
            "taps_in": int(np.asarray(balloon.irs).shape[1]),
            "crop_offset_samples": int(start),
            "gain_applied": float(gain),
            "front_angle_deg": front_direction_angle_deg(fit),
            "processing_version": DIRECTIVITY_PROCESSING_VERSION,
        },
    )


def save_npz(path: Path | str, processed: ProcessedBalloon) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.npz")
    np.savez_compressed(
        tmp,
        directions=processed.directions,
        irs=processed.irs,
        fs=np.int64(processed.fs),
        band_hz=np.asarray(processed.band_hz),
        band_energy=processed.band_energy.astype(np.float32),
        fit_json=json.dumps(processed.fit),
        preview_json=json.dumps(processed.preview),
        meta_json=json.dumps(processed.meta),
    )
    os.replace(tmp, path)
    return path


def load_npz(path: Path | str) -> dict:
    """``{directions, irs, fs, band_hz, band_energy, fit, preview, meta}`` of a saved balloon.

    ``band_energy`` is the per-hertz band power (``band_powers``). Balloons stored by an older
    processing version get it and the fit recomputed from their stored IRs, which is exactly what
    a fresh import would give (the IRs are the resampled, cropped, normalised ones).
    """
    with np.load(Path(path), allow_pickle=False) as data:
        out = {
            "directions": np.asarray(data["directions"], dtype=np.float64),
            "irs": np.asarray(data["irs"], dtype=np.float64),
            "fs": int(data["fs"]),
            "band_hz": np.asarray(data["band_hz"], dtype=np.float64).tolist(),
            "band_energy": np.asarray(data["band_energy"], dtype=np.float64),
            "fit": json.loads(str(data["fit_json"])),
            "preview": json.loads(str(data["preview_json"])),
            "meta": json.loads(str(data["meta_json"])),
        }
    if int(out["meta"].get("processing_version", 1)) < DIRECTIVITY_PROCESSING_VERSION:
        upgrade_loaded(out)
    return out


def upgrade_loaded(data: dict) -> dict:
    """Recompute the band levels and the fit of a loaded older balloon in place (see ``load_npz``)."""
    data["band_energy"] = band_powers(data["irs"], data["fs"], data["band_hz"])
    data["fit"] = fit_all_bands(data["directions"], data["band_energy"], data["band_hz"])
    data["meta"] = {**data["meta"], "processing_version": DIRECTIVITY_PROCESSING_VERSION,
                    "upgraded_from_version": int(data["meta"].get("processing_version", 1)),
                    "front_angle_deg": front_direction_angle_deg(data["fit"])}
    return data


def analytical_fit(p: float) -> dict:
    """First-order spec of a Cardioid-family pattern (one band, unit gain, axis +x)."""
    return {"bands_hz": [], "a": [float(p)], "gain": [1.0], "axis": [[1.0, 0.0, 0.0]], "residual": [0.0]}
