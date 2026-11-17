# backend/utils/acoustic_measurement.py
"""Acoustic metrics of an impulse response: the compas_acoustics Analyser, nothing else.

Every IR the app produces or receives (compas_acoustics and legacy pyroomacoustics runs, PFFDTD,
hybrid, free positioning, uploads) is measured here, on the response before it is trimmed, so the
card's single numbers and the per-band table always come from one analysis:

* ``acoustic_parameters``: the ISO 3382-1 single numbers (T30, EDT, C50, C80, D50 = mean of the
  500 Hz and 1 kHz bands; STI over all bands) and their reliability;
* ``acoustic_parameters_bands``: the same metrics per octave band 125 Hz - 8 kHz plus the
  Analyser's reliability report.
"""

from __future__ import annotations

import math
import warnings
from typing import Optional

import numpy as np

from config.constants import (
    ACOUSTIC_METRIC_HEADLINE_BANDS,
    ACOUSTIC_METRIC_PARAMETERS,
    CA_TO_APP_LEVEL_SCALE,
)

_OCTAVE_UPPER_EDGE = math.sqrt(2.0)  # an octave band reaches f * sqrt(2)


def _number(value) -> Optional[float]:
    """A finite float, else None (CA reports NaN where a band cannot be measured)."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _analyser(w: np.ndarray, fs: int, generation: Optional[dict]):
    import compas_acoustics as ca

    if generation:
        # A compas_acoustics response: rebuilt on the package scale with its generation metadata, so
        # the Analyser starts its direct-sound search at the geometric arrival.
        source, receiver = ca.Source("s", 0.0, 0.0, 0.0), ca.Receiver("r", 1.0, 0.0, 0.0)
        ir = ca.ImpulseResponse("ir", source, receiver, w / CA_TO_APP_LEVEL_SCALE, int(fs),
                                normalized=False, generation=generation)
        return ca.Analyser(ir, channel=0)
    analyser = ca.Analyser(w, channel=0)
    analyser.sampling_rate = int(fs)
    return analyser


def measure_ir(
    rir: np.ndarray,
    fs: int,
    *,
    generation: Optional[dict] = None,
    band_limit_hz: Optional[float] = None,
) -> dict:
    """``{"acoustic_parameters": ..., "acoustic_parameters_bands": ...}`` of one impulse response.

    Args:
        rir: (samples,) or (samples, channels); channel 0 (the W channel of an ambisonic IR) is
            analysed. Pass the response BEFORE it is trimmed for export.
        fs: Sample rate in Hz.
        generation: The ``ImpulseResponse.generation`` of a compas_acoustics response, whose
            geometric direct-sound arrival then anchors the analysis.
        band_limit_hz: A band-limited IR (PFFDTD) carries nothing above this frequency: the bands
            reaching above it are left out (None), and the single numbers that need them too.
    """
    data = np.asarray(rir, dtype=np.float64)
    w = data if data.ndim == 1 else data[:, 0]
    if w.size == 0 or not np.any(w):
        raise ValueError("silent impulse response")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        analyser = _analyser(w, fs, generation)
        result = analyser.analyse(parameters=ACOUSTIC_METRIC_PARAMETERS)
        reliability = analyser.reliability()

    freqs = [int(f) for f in result["freqs"]]
    kept = [band_limit_hz is None or f * _OCTAVE_UPPER_EDGE <= band_limit_hz for f in freqs]

    def per_band(values) -> list:
        return [(_number(v) if keep else None) for v, keep in zip(values, kept)]

    bands: dict = {"frequency_bands": freqs}
    for key in ACOUSTIC_METRIC_PARAMETERS:
        bands[key] = per_band(result[key])
    bands["reliability"] = {
        "freqs": freqs,
        "range_db": per_band(reliability["range_db"]),
        **{flag: [bool(v) and keep for v, keep in zip(reliability[flag], kept)]
           for flag in ("EDT_reliable", "T20_reliable", "T30_reliable")},
    }

    headline_ok = all(kept[freqs.index(f)] for f in ACOUSTIC_METRIC_HEADLINE_BANDS)
    sti_ok = all(kept)

    def overall(key: str, ok: bool) -> Optional[float]:
        return _number(result.get(f"{key}_overall")) if ok else None

    def reliable(flag: str) -> bool:
        return headline_ok and all(bool(reliability[flag][freqs.index(f)]) for f in ACOUSTIC_METRIC_HEADLINE_BANDS)

    d50 = overall("D50", headline_ok)
    for key in ACOUSTIC_METRIC_PARAMETERS:
        bands[f"{key}_overall"] = overall(key, sti_ok if key == "STI" else headline_ok)

    headline = {
        "t30": overall("T30", headline_ok),
        "edt": overall("EDT", headline_ok),
        "c50": overall("C50", headline_ok),
        "c80": overall("C80", headline_ok),
        "d50": None if d50 is None else d50 / 100.0,
        "sti": overall("STI", sti_ok),
        "t30_reliable": reliable("T30_reliable"),
        "edt_reliable": reliable("EDT_reliable"),
    }
    return {"acoustic_parameters": headline, "acoustic_parameters_bands": bands}


def try_measure_ir(rir: np.ndarray, fs: int, label: str = "", **kwargs) -> dict:
    """``measure_ir``, or ``{}`` (with a printed warning) when the IR cannot be analysed."""
    try:
        return measure_ir(rir, fs, **kwargs)
    except Exception as exc:  # noqa: BLE001 - a metric failure never fails the IR itself
        print(f"  Warning: acoustic metrics failed{f' for {label}' if label else ''}: {exc}")
        return {}
