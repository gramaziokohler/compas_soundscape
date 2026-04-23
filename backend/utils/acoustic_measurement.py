# backend/utils/acoustic_measurement.py
# Acoustic Measurement Utilities

import numpy as np
import pyroomacoustics as pra
from fastapi import HTTPException

_P_REF = 2e-5  # acoustic reference pressure [Pa]


class AcousticMeasurement:
    """Utility class for calculating acoustic parameters from room impulse responses"""

    @staticmethod
    def calculate_acoustic_parameters_from_rir(rir: np.ndarray, fs: int) -> dict[str, float]:
        """
        Calculate acoustic parameters from a raw RIR array.

        SPL is computed as a relative energy level (normalized IR → no physical unit).
        For physical-pressure IRs use calculate_spl_from_pressure() and override the
        'spl' key in the returned dict before saving to results.json.

        Returns:
            Dictionary with acoustic parameters:
            - rt60: Reverberation time (T60) in seconds
            - edt: Early decay time in seconds
            - c50: Speech clarity in dB
            - spl: Relative energy level in dB (10·log10(Σh²/fs))
            - d50: Definition (0-1)
            - drr: Direct-to-reverberant ratio in dB
        """
        try:
            rt60 = pra.experimental.rt60.measure_rt60(rir, fs=fs, decay_db=30)
            if rt60 is None or np.isnan(rt60):
                rt60 = AcousticMeasurement._estimate_rt60_from_energy(rir, fs)

            edt = pra.experimental.rt60.measure_rt60(rir, fs=fs, decay_db=10)
            if edt is None or np.isnan(edt):
                edt = rt60 * 0.7

            c50 = AcousticMeasurement._calculate_clarity(rir, fs, split_time=0.05)
            d50 = AcousticMeasurement._calculate_definition(rir, fs, split_time=0.05)
            drr = AcousticMeasurement._calculate_drr(rir, fs)
            spl = AcousticMeasurement.calculate_spl_from_ir(rir, fs)

            return {
                "rt60": float(rt60),
                "edt": float(edt),
                "c50": float(c50),
                "spl": float(spl),
                "d50": float(d50),
                "drr": float(drr),
            }

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to calculate acoustic parameters: {str(e)}")

    # ─── SPL helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def calculate_spl_from_ir(rir: np.ndarray, fs: int) -> float:
        """
        Relative SPL from a normalized IR: 10·log10(Σh²/fs) in dB.

        Valid for comparing positions within the same simulation but has no
        absolute physical meaning (no reference pressure).
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

    # ─── Private helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _estimate_rt60_from_energy(rir: np.ndarray, fs: int) -> float:
        energy = rir ** 2
        schroeder = np.cumsum(energy[::-1])[::-1]
        schroeder_db = 10 * np.log10(schroeder / schroeder[0] + 1e-10)
        try:
            idx_60db = np.where(schroeder_db <= -60)[0][0]
            return idx_60db / fs
        except IndexError:
            try:
                idx_5db  = np.where(schroeder_db <= -5)[0][0]
                idx_25db = np.where(schroeder_db <= -25)[0][0]
                return ((idx_25db - idx_5db) / fs) * 3
            except IndexError:
                return 0.5

    @staticmethod
    def _calculate_clarity(rir: np.ndarray, fs: int, split_time: float) -> float:
        split_sample = int(split_time * fs)
        if split_sample >= len(rir):
            return 0.0
        early_energy = np.sum(rir[:split_sample] ** 2)
        late_energy  = np.sum(rir[split_sample:] ** 2)
        if late_energy == 0:
            return 50.0
        return float(10 * np.log10((early_energy / late_energy) + 1e-10))

    @staticmethod
    def _calculate_definition(rir: np.ndarray, fs: int, split_time: float) -> float:
        split_sample = int(split_time * fs)
        if split_sample >= len(rir):
            return 1.0
        early_energy = np.sum(rir[:split_sample] ** 2)
        total_energy = np.sum(rir ** 2)
        if total_energy == 0:
            return 0.0
        return float(min(1.0, max(0.0, early_energy / total_energy)))

    @staticmethod
    def _calculate_drr(rir: np.ndarray, fs: int) -> float:
        direct_samples  = int(0.005 * fs)
        direct_energy   = np.sum(rir[:direct_samples] ** 2)
        reverb_energy   = np.sum(rir[direct_samples:] ** 2)
        if reverb_energy == 0:
            return 50.0
        return float(10 * np.log10((direct_energy / reverb_energy) + 1e-10))
