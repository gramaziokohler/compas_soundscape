# backend/utils/acoustic_measurement.py
# Acoustic Measurement Utilities

import numpy as np
import pyroomacoustics as pra

from config.constants import (
    PYROOMACOUSTICS_METRICS_DIRECT_SEARCH_FRACTION_S,
    PYROOMACOUSTICS_METRICS_DIRECT_THRESHOLD_FRACTION,
    PYROOMACOUSTICS_METRICS_DIRECT_WINDOW_S,
    PYROOMACOUSTICS_METRICS_EDT_MIN_DYNAMIC_RANGE_DB,
    PYROOMACOUSTICS_METRICS_RT60_MIN_DYNAMIC_RANGE_DB,
)

_P_REF = 2e-5  # acoustic reference pressure [Pa]


class AcousticMeasurement:
    """Utility class for calculating acoustic parameters from room impulse responses.

    RT60/EDT follow the ISO 3382 Schroeder-method principle, but with a
    noise-floor/dynamic-range guard: a metric is only reported when the
    measured decay covers a minimum level drop. Without that guard, a
    truncated or non-diffuse RIR tail flattens the least-squares fit and
    extrapolates to an inflated RT60.
    """

    @staticmethod
    def calculate_acoustic_parameters_from_rir(rir: np.ndarray, fs: int) -> dict:
        """
        Calculate acoustic parameters from a raw RIR array.

        Time-windowed metrics (DRR, C50, D50) are anchored to the *direct
        arrival*, not to sample 0 — the RIR carries the propagation delay
        ``dist/c``, so anchoring at sample 0 silently misclassifies the direct
        sound for any source-receiver distance above a few metres.

        Unmeasurable metrics are returned as ``None`` with an explicit
        ``*_reliable`` flag instead of a fabricated sentinel value.

        Args:
            rir: Mono (or first-order W) impulse response.
            fs: Sample rate in Hz.

        Returns:
            Dictionary with:
            - rt60: T60 (s) extrapolated from a T30 decay, or None
            - edt:  Early decay time 6*T10 (s), or None
            - c50: Speech clarity (dB), or None
            - d50: Definition (0-1), or None
            - drr: Direct-to-reverberant ratio (dB), or None
            - energy_level_db: RELATIVE energy level 10*log10(sum(h^2)/fs) dB
            - spl: Deprecated alias of energy_level_db (see spl_is_relative)
            - spl_is_relative: True (this SPL is NOT sound pressure level)
            - rt60_reliable / edt_reliable: whether the decay range was adequate
            - rt60_dynamic_range_db: measured decay range used for the fit
        """
        rir = np.asarray(rir, dtype=np.float64).ravel()
        if rir.size == 0:
            return {}

        rt60, rt60_range = AcousticMeasurement._estimate_rt60_robust(
            rir, fs, decay_db=30.0
        )
        edt, edt_range = AcousticMeasurement._estimate_rt60_robust(
            rir,
            fs,
            decay_db=10.0,
            min_range_db=PYROOMACOUSTICS_METRICS_EDT_MIN_DYNAMIC_RANGE_DB,
        )

        c50 = AcousticMeasurement._calculate_clarity(rir, fs, split_time=0.05)
        d50 = AcousticMeasurement._calculate_definition(rir, fs, split_time=0.05)
        drr = AcousticMeasurement._calculate_drr(rir, fs)

        energy_level_db = AcousticMeasurement.calculate_spl_from_ir(rir, fs)

        return {
            "rt60": rt60,
            "edt": edt,
            "c50": c50,
            "d50": d50,
            "drr": drr,
            "energy_level_db": energy_level_db,
            "spl": energy_level_db,  # deprecated alias (relative level, not SPL)
            "spl_is_relative": True,
            "rt60_reliable": rt60 is not None
            and rt60_range >= PYROOMACOUSTICS_METRICS_RT60_MIN_DYNAMIC_RANGE_DB,
            "edt_reliable": edt is not None
            and edt_range >= PYROOMACOUSTICS_METRICS_EDT_MIN_DYNAMIC_RANGE_DB,
            "rt60_dynamic_range_db": float(rt60_range),
        }

    # ─── SPL helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def calculate_spl_from_ir(rir: np.ndarray, fs: int) -> float:
        """
        Relative energy level from a normalized IR: 10·log10(Σh²/fs) in dB.

        Valid for comparing positions within the same simulation but has no
        absolute physical meaning (no reference pressure). Not SPL.
        """
        if len(rir) == 0:
            return -120.0
        energy_per_s = np.sum(rir ** 2) / fs
        if energy_per_s <= 0:
            return -120.0
        return float(10 * np.log10(energy_per_s))

    @staticmethod
    def calculate_spl_from_pressure(ir_pa: np.ndarray) -> float:
        """
        Physical SPL from an IR whose samples are in Pascals.

        SPL = 20·log10(p_rms / p_ref)  where p_ref = 20 μPa.
        Used for wave-based (DG) and DE-scaled IRs.
        """
        if len(ir_pa) == 0:
            return -120.0
        p_rms = np.sqrt(np.mean(ir_pa ** 2))
        if p_rms <= 0:
            return -120.0
        return float(20 * np.log10(p_rms / _P_REF))

    @staticmethod
    def calculate_de_spl_from_json(json_data: dict) -> float | None:
        """
        Extract broadband SPL for a DE pair from its results JSON.

        DE writes per-band steady-state SPL in
        results[0].responses[0].parameters.spl_t0_freq (list[float], dB SPL).
        Returns the mean across bands, or None if unavailable.
        """
        try:
            spl_t0_freq = json_data["results"][0]["responses"][0]["parameters"]["spl_t0_freq"]
            values = [float(v) for v in spl_t0_freq if v is not None]
            return float(np.mean(values)) if values else None
        except (KeyError, IndexError, TypeError):
            return None

    @staticmethod
    def calculate_dg_spl_from_json(json_data: dict, receiver_index: int) -> float | None:
        """
        Compute physical SPL from DG receiver pressure time series.

        DG stores the corrected broadband IR (Pa) in
        results[0].responses[receiver_index].receiverResults.
        """
        try:
            responses = json_data.get("results", [{}])[0].get("responses", [])
            if receiver_index >= len(responses):
                return None
            ir_raw = responses[receiver_index].get("receiverResults", [])
            if not ir_raw:
                return None
            ir_pa = np.array(ir_raw, dtype=np.float64).flatten()
            ir_pa = np.nan_to_num(ir_pa, nan=0.0, posinf=0.0, neginf=0.0)
            return AcousticMeasurement.calculate_spl_from_pressure(ir_pa)
        except Exception:
            return None

    # ─── RT60 / EDT (ISO 3382 Schroeder method, robust) ─────────────────────

    @staticmethod
    def _estimate_rt60_robust(
        rir: np.ndarray,
        fs: int,
        decay_db: float = 30.0,
        min_range_db: float = PYROOMACOUSTICS_METRICS_RT60_MIN_DYNAMIC_RANGE_DB,
        headroom_db: float = 5.0,
        ref_win_s: float = 0.1,
        linearity_db: float = 3.0,
    ) -> tuple[float | None, float]:
        """
        Schroeder-backward-integration RT60 estimate with a linearity guard.

        Fits a linear decay in the log domain from ``-headroom_db`` dB to
        ``-(headroom_db + decay_db)`` dB and extrapolates to −60 dB. The fit
        endpoint is the first point where the Schroeder curve deviates from the
        decay line established over the first ``ref_win_s`` seconds — i.e. the
        curve either FLATTENS (a long flat noise/reverb tail that would flatten
        the least-squares slope and inflate RT60) or PLUNGES (a truncation /
        hard record cut that would steepen it). This is deliberately NOT a
        tail-estimated noise-floor asymptote: ray-traced and diffuse IRs carry a
        genuine stochastic late-reverb tail that a naive tail-mean floor
        misclassifies as noise, killing otherwise measurable decays.

        If the usable segment covers less than ``min_range_db`` of level drop,
        returns ``(None, range_db)`` so the caller flags the metric unreliable.

        Returns:
            (rt60_seconds | None, dynamic_range_db)
        """
        power = np.asarray(rir, dtype=np.float64) ** 2
        n = power.size
        if n < max(4, int(0.01 * fs)):  # need at least ~10 ms of signal
            return None, 0.0

        # Schroeder backward energy integration
        schroeder = np.cumsum(power[::-1])[::-1]
        nz = np.flatnonzero(schroeder > 0)
        if nz.size == 0:
            return None, 0.0
        schroeder = schroeder[: nz[-1] + 1]
        m = schroeder.size
        if m < 8:
            return None, 0.0

        sch = 10 * np.log10(schroeder)
        sch -= sch[0]

        # −headroom_db headroom from the start of the decay
        i5_candidates = np.flatnonzero(sch < -headroom_db)
        if i5_candidates.size == 0:
            return None, 0.0
        i5 = int(i5_candidates[0])

        # Reference decay slope over a short window right after the headroom
        # point, where a real (non-truncated) decay is still linear.
        ref_n = max(4, int(ref_win_s * fs))
        i_ref = min(i5 + ref_n, m - 1)
        ref_dt = (i_ref - i5) / fs
        ref_slope = (sch[i_ref] - sch[i5]) / ref_dt if ref_dt > 0 else 0.0
        if ref_slope >= 0:
            return None, 0.0

        # Exclude the final steep truncation tail (last 1%) from the fit.
        trim_tail = max(i5 + 1, int(m * 0.99))

        # Fit endpoint: first point after i5 where the curve deviates from the
        # extrapolated decay line by more than linearity_db (flattening or
        # plunge), capped by the target level and the truncation trim.
        t = np.arange(m) / fs
        ref_line = sch[i5] + ref_slope * (t - t[i5])
        dev = sch - ref_line
        dev_region = dev[i5 + 1:trim_tail]
        dev_idx = np.flatnonzero(np.abs(dev_region) > linearity_db)
        i_end = (i5 + 1 + int(dev_idx[0])) if dev_idx.size else (trim_tail - 1)

        target = -(headroom_db + decay_db)
        below = np.flatnonzero(sch[i5:] <= target)
        if below.size:
            i_end = min(i_end, i5 + int(below[0]))

        if i_end - i5 < 4:
            return None, 0.0

        seg = sch[i5:i_end + 1]
        t_seg = np.arange(seg.size) / fs
        slope, _ = np.polyfit(t_seg, seg, 1)
        range_db = float(seg[0] - seg[-1])

        if range_db < min_range_db or slope >= 0:
            return None, range_db
        rt60 = float(-60.0 / slope)
        if not np.isfinite(rt60) or rt60 <= 0:
            return None, range_db
        return rt60, range_db

    # ─── Direct-arrival-anchored window metrics ──────────────────────────────

    @staticmethod
    def _direct_arrival_index(rir: np.ndarray, fs: int) -> int | None:
        """
        Index of the direct-sound arrival.

        The direct sound is the first sample that rises above
        ``threshold_fraction`` of the GLOBAL peak within the first
        ``search_fraction_s`` seconds of the RIR. Anchoring to the global peak
        (not a window peak) keeps the detector correct for far sources whose
        arrival is later than the early part of the RIR. Returns None when the
        RIR has no detectable arrival (silence / pure noise).
        """
        search_n = int(PYROOMACOUSTICS_METRICS_DIRECT_SEARCH_FRACTION_S * fs)
        window = rir[:search_n]
        if window.size == 0:
            return None
        peak = float(np.max(np.abs(rir)))
        if peak <= 0:
            return None
        thr = PYROOMACOUSTICS_METRICS_DIRECT_THRESHOLD_FRACTION * peak
        idx = np.flatnonzero(np.abs(window) >= thr)
        return int(idx[0]) if idx.size else None

    @staticmethod
    def _calculate_clarity(rir: np.ndarray, fs: int, split_time: float) -> float | None:
        """
        Clarity index C50 (dB): 10·log10(early / late), early defined as the
        first ``split_time`` seconds AFTER the direct arrival (ISO 3382). None
        when the direct arrival is undetectable or either energy is zero.
        """
        i_dir = AcousticMeasurement._direct_arrival_index(rir, fs)
        if i_dir is None:
            return None
        split_sample = i_dir + int(split_time * fs)
        early_energy = float(np.sum(rir[:split_sample] ** 2))
        late_energy = float(np.sum(rir[split_sample:] ** 2))
        if early_energy <= 0 or late_energy <= 0:
            return None
        return float(10 * np.log10(early_energy / late_energy))

    @staticmethod
    def _calculate_definition(rir: np.ndarray, fs: int, split_time: float) -> float | None:
        """
        Definition D50 (0-1): early / total energy, early defined as the first
        ``split_time`` seconds AFTER the direct arrival. None when the direct
        arrival is undetectable or the RIR is silent.
        """
        i_dir = AcousticMeasurement._direct_arrival_index(rir, fs)
        if i_dir is None:
            return None
        split_sample = i_dir + int(split_time * fs)
        early_energy = float(np.sum(rir[:split_sample] ** 2))
        total_energy = float(np.sum(rir ** 2))
        if total_energy <= 0:
            return None
        return float(min(1.0, max(0.0, early_energy / total_energy)))

    @staticmethod
    def _calculate_drr(rir: np.ndarray, fs: int) -> float | None:
        """
        Direct-to-reverberant ratio (dB).

        Direct energy is the ``DIRECT_WINDOW_S`` window AFTER the direct
        arrival (anchored, so it works at any source-receiver distance);
        reverberant energy is everything else. None when the arrival is
        undetectable or there is no reverberant energy.
        """
        i_dir = AcousticMeasurement._direct_arrival_index(rir, fs)
        if i_dir is None:
            return None
        window = int(PYROOMACOUSTICS_METRICS_DIRECT_WINDOW_S * fs)
        hi = min(len(rir), i_dir + window)
        direct_energy = float(np.sum(rir[i_dir:hi] ** 2))
        reverb_energy = float(np.sum(rir ** 2)) - direct_energy
        if direct_energy <= 0 or reverb_energy <= 0:
            return None
        return float(10 * np.log10(direct_energy / reverb_energy))