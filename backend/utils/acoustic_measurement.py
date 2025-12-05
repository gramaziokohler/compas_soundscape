# backend/utils/acoustic_measurement.py
# Acoustic Measurement Utilities

import numpy as np
import pyroomacoustics as pra
from fastapi import HTTPException


class AcousticMeasurement:
    """Utility class for calculating acoustic parameters from room impulse responses"""

    @staticmethod
    def calculate_acoustic_parameters(room) -> dict[str, float]:
        """
        Calculate acoustic parameters from room impulse response.

        Args:
            room: Room with computed RIR (pra.Room or pra.ShoeBox)

        Returns:
            Dictionary with acoustic parameters:
            - rt60: Reverberation time (T60) in seconds
            - edt: Early decay time in seconds
            - c50: Speech clarity in dB
            - c80: Music clarity in dB
            - d50: Definition (0-1)
            - drr: Direct-to-reverberant ratio in dB

        Raises:
            HTTPException: If calculation fails
        """
        try:
            # Get RIR (first source, first microphone)
            rir = room.rir[0][0]
            fs = room.fs

            # RT60: Reverberation time using Schroeder integration
            rt60 = pra.experimental.rt60.measure_rt60(rir, fs=fs, decay_db=60)
            if rt60 is None or np.isnan(rt60):
                # Fallback: estimate from energy decay
                rt60 = AcousticMeasurement._estimate_rt60_from_energy(rir, fs)

            # EDT: Early decay time (first 10 dB of decay)
            edt = pra.experimental.rt60.measure_rt60(rir, fs=fs, decay_db=10)
            if edt is None or np.isnan(edt):
                edt = rt60 * 0.7  # Approximation: EDT ≈ 0.7 * RT60

            # C50: Speech clarity (ratio of energy in first 50ms to rest)
            c50 = AcousticMeasurement._calculate_clarity(rir, fs, split_time=0.05)

            # C80: Music clarity (ratio of energy in first 80ms to rest)
            c80 = AcousticMeasurement._calculate_clarity(rir, fs, split_time=0.08)

            # D50: Definition (proportion of energy in first 50ms)
            d50 = AcousticMeasurement._calculate_definition(rir, fs, split_time=0.05)

            # DRR: Direct-to-reverberant ratio
            drr = AcousticMeasurement._calculate_drr(rir, fs)

            return {
                "rt60": float(rt60),
                "edt": float(edt),
                "c50": float(c50),
                "c80": float(c80),
                "d50": float(d50),
                "drr": float(drr)
            }

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to calculate acoustic parameters: {str(e)}")

    @staticmethod
    def _estimate_rt60_from_energy(rir: np.ndarray, fs: int) -> float:
        """Estimate RT60 from energy decay curve"""
        # Calculate energy decay curve (Schroeder integration)
        energy = rir ** 2
        schroeder = np.cumsum(energy[::-1])[::-1]
        schroeder_db = 10 * np.log10(schroeder / schroeder[0] + 1e-10)

        # Find time when decay reaches -60 dB
        try:
            idx_60db = np.where(schroeder_db <= -60)[0][0]
            rt60 = idx_60db / fs
        except IndexError:
            # If -60dB not reached, extrapolate from -5dB to -25dB
            try:
                idx_5db = np.where(schroeder_db <= -5)[0][0]
                idx_25db = np.where(schroeder_db <= -25)[0][0]
                time_20db = (idx_25db - idx_5db) / fs
                rt60 = time_20db * 3  # Extrapolate to 60dB
            except IndexError:
                rt60 = 0.5  # Default fallback

        return rt60

    @staticmethod
    def _calculate_clarity(rir: np.ndarray, fs: int, split_time: float) -> float:
        """Calculate clarity index (C50 or C80) in dB"""
        split_sample = int(split_time * fs)

        if split_sample >= len(rir):
            return 0.0

        early_energy = np.sum(rir[:split_sample] ** 2)
        late_energy = np.sum(rir[split_sample:] ** 2)

        if late_energy == 0:
            return 50.0  # Maximum clarity if no late reflections

        clarity_db = 10 * np.log10((early_energy / late_energy) + 1e-10)
        return clarity_db

    @staticmethod
    def _calculate_definition(rir: np.ndarray, fs: int, split_time: float) -> float:
        """Calculate definition (D50) as proportion of early energy"""
        split_sample = int(split_time * fs)

        if split_sample >= len(rir):
            return 1.0

        early_energy = np.sum(rir[:split_sample] ** 2)
        total_energy = np.sum(rir ** 2)

        if total_energy == 0:
            return 0.0

        definition = early_energy / total_energy
        return min(1.0, max(0.0, definition))  # Clamp to [0, 1]

    @staticmethod
    def _calculate_drr(rir: np.ndarray, fs: int) -> float:
        """Calculate direct-to-reverberant ratio in dB"""
        # Find direct sound peak (first 5ms)
        direct_samples = int(0.005 * fs)
        direct_energy = np.sum(rir[:direct_samples] ** 2)

        # Reverberant energy (after first 5ms)
        reverb_energy = np.sum(rir[direct_samples:] ** 2)

        if reverb_energy == 0:
            return 50.0  # Maximum DRR if no reverb

        drr_db = 10 * np.log10((direct_energy / reverb_energy) + 1e-10)
        return drr_db
