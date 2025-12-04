# backend/services/pyroomacoustics_service.py
# Pyroomacoustics Acoustic Simulation Service

import numpy as np
import pyroomacoustics as pra
from scipy.io import wavfile
from pathlib import Path
from fastapi import HTTPException


class PyroomacousticsService:
    """Service for acoustic simulation using pyroomacoustics library"""

    @staticmethod
    def calculate_sabine_rt60(dimensions: list[float], materials: dict[str, float]) -> float:
        """
        Calculate theoretical RT60 using Sabine or Eyring formula.

        Uses Eyring formula for highly absorptive spaces (avg α > 0.3),
        Sabine formula otherwise.

        Args:
            dimensions: [width, length, height] in meters
            materials: Dictionary mapping wall names to absorption coefficients

        Returns:
            float: Theoretical RT60 in seconds
        """
        width, length, height = dimensions

        # Calculate surface areas
        north_south_area = length * height
        east_west_area = width * height
        floor_ceiling_area = width * length

        # Total surface area
        total_surface_area = 2 * (north_south_area + east_west_area + floor_ceiling_area)

        # Calculate total absorption (in sabins)
        total_absorption = (
            north_south_area * materials['north'] +
            north_south_area * materials['south'] +
            east_west_area * materials['east'] +
            east_west_area * materials['west'] +
            floor_ceiling_area * materials['floor'] +
            floor_ceiling_area * materials['ceiling']
        )

        # Average absorption coefficient
        avg_absorption = total_absorption / total_surface_area

        # Volume
        volume = width * length * height

        # Choose formula based on average absorption
        if avg_absorption > 0.3:
            # Eyring formula for highly absorptive spaces
            # RT60 = 0.161 * V / (-S * ln(1 - α_avg))
            # More accurate for high absorption
            rt60 = 0.161 * volume / (-total_surface_area * np.log(1 - avg_absorption + 1e-10))
        else:
            # Sabine formula for moderately absorptive spaces
            # RT60 = 0.161 * V / A
            rt60 = 0.161 * volume / (total_absorption + 1e-6)

        return rt60

    @staticmethod
    def calculate_optimal_max_order(
        dimensions: list[float],
        materials: dict[str, float],
        target_accuracy: float = 0.15
    ) -> int:
        """
        Calculate optimal max_order for image source method based on room size and materials.

        The max_order needs to be high enough to capture sufficient reflections for
        accurate RT60 measurement. Larger rooms and lower absorption require higher orders.

        Args:
            dimensions: [width, length, height] in meters
            materials: Dictionary mapping wall names to absorption coefficients
            target_accuracy: Target accuracy for RT60 (default: 15% error)

        Returns:
            int: Recommended max_order (clamped between 3 and 50)
        """
        # Calculate theoretical RT60
        rt60_theory = PyroomacousticsService.calculate_sabine_rt60(dimensions, materials)

        # Calculate average absorption
        absorptions = list(materials.values())
        avg_absorption = sum(absorptions) / len(absorptions)

        # Calculate room "size" (approximate mean free path)
        width, length, height = dimensions
        volume = width * length * height
        surface_area = 2 * (width * length + width * height + length * height)
        mean_free_path = 4 * volume / surface_area

        # Heuristic: max_order should allow enough reflections to reach theoretical RT60
        # Each reflection reduces sound pressure, and we need enough reflections
        # to capture the -60dB decay
        #
        # Rule of thumb: max_order ≈ (RT60 * speed_of_sound) / (2 * mean_free_path)
        # Adjusted for absorption: divide by (1 - avg_absorption) to get more reflections
        # for less absorptive rooms

        speed_of_sound = 343  # m/s
        reflection_distance = 2 * mean_free_path  # Distance per reflection order

        # Calculate how many reflections we need to cover RT60 time span
        distance_in_rt60 = rt60_theory * speed_of_sound
        estimated_max_order = distance_in_rt60 / reflection_distance

        # Adjust for absorption - less absorption needs more orders
        # Use a more conservative factor (0.3 instead of 0.5)
        absorption_factor = (1 - avg_absorption) ** 0.3
        estimated_max_order *= absorption_factor

        # Add safety margin for target accuracy
        # Reduced from 0.3 to 0.2 to be less aggressive
        accuracy_factor = 1.0 / target_accuracy
        estimated_max_order *= (accuracy_factor ** 0.2)

        # Apply a damping factor to prevent overestimation
        # ISM becomes less accurate at very high orders
        estimated_max_order *= 0.6  # Damping factor

        # Round up and clamp between reasonable bounds
        max_order = int(np.ceil(estimated_max_order))
        max_order = max(3, min(50, max_order))  # Clamp between 3 and 50 (increased for very reverberant spaces)

        return max_order

    @staticmethod
    def create_shoebox_room(
        dimensions: list[float],
        materials: dict[str, float],
        fs: int = 48000,
        max_order: int = None
    ) -> pra.ShoeBox:
        """
        Create a shoebox room with specified dimensions and wall materials.

        Args:
            dimensions: [width, length, height] in meters
            materials: Dictionary mapping wall names to absorption coefficients
                      Keys: 'north', 'south', 'east', 'west', 'floor', 'ceiling'
            fs: Sample rate in Hz
            max_order: Maximum reflection order for image source method
                      If None or not specified, will be calculated automatically
                      based on room dimensions and materials for optimal accuracy

        Returns:
            pra.ShoeBox: Configured shoebox room object

        Raises:
            HTTPException: If dimensions or materials are invalid
        """
        try:
            # Validate dimensions
            if len(dimensions) != 3:
                raise ValueError("Dimensions must be [width, length, height]")
            if any(d <= 0 for d in dimensions):
                raise ValueError("All dimensions must be positive")

            width, length, height = dimensions

            # Validate materials - must have all 6 walls
            required_walls = {'north', 'south', 'east', 'west', 'floor', 'ceiling'}
            if not all(wall in materials for wall in required_walls):
                raise ValueError(f"Materials must include all walls: {required_walls}")

            # Validate absorption coefficients (0-1)
            for wall, absorption in materials.items():
                if not (0 <= absorption <= 1):
                    raise ValueError(f"Absorption coefficient for {wall} must be between 0 and 1, got {absorption}")

            # Auto-calculate optimal max_order if not specified
            if max_order is None:
                max_order = PyroomacousticsService.calculate_optimal_max_order(
                    dimensions, materials
                )
                print(f"Auto-calculated optimal max_order: {max_order}")

            # Create material objects for each wall
            # pyroomacoustics expects absorption coefficients per frequency band
            # For simplicity, we use the same coefficient across all bands
            material_objects = {}
            for wall_name, absorption in materials.items():
                # Create material with single absorption value across frequency bands
                material_objects[wall_name] = pra.Material(absorption)

            # Create shoebox room
            # Note: ShoeBox constructor takes [length, width, height] (y, x, z)
            # but our API uses [width, length, height] (x, y, z) for consistency
            room = pra.ShoeBox(
                p=[length, width, height],  # Swap width and length for pra convention
                fs=fs,
                materials=material_objects,
                max_order=max_order
            )

            return room

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create room: {str(e)}")

    @staticmethod
    def simulate_room_acoustics(
        room: pra.ShoeBox,
        source_position: list[float],
        receiver_position: list[float]
    ) -> pra.ShoeBox:
        """
        Add source and receiver to room and compute room impulse response.

        Args:
            room: Shoebox room object
            source_position: [x, y, z] coordinates in meters
            receiver_position: [x, y, z] coordinates in meters

        Returns:
            pra.ShoeBox: Room with computed RIR

        Raises:
            HTTPException: If positions are invalid or simulation fails
        """
        try:
            # Validate positions
            if len(source_position) != 3 or len(receiver_position) != 3:
                raise ValueError("Positions must be [x, y, z] coordinates")

            # Convert positions to pyroomacoustics convention [y, x, z]
            # Our API: [x, y, z], pra expects: [y, x, z]
            source_pos_pra = [source_position[1], source_position[0], source_position[2]]
            receiver_pos_pra = [receiver_position[1], receiver_position[0], receiver_position[2]]

            # Validate positions are within room bounds
            room_dims = room.shoebox_dim  # Returns [length, width, height] in pra convention
            if not (0 <= source_pos_pra[0] <= room_dims[0] and
                    0 <= source_pos_pra[1] <= room_dims[1] and
                    0 <= source_pos_pra[2] <= room_dims[2]):
                raise ValueError(f"Source position {source_position} is outside room bounds")

            if not (0 <= receiver_pos_pra[0] <= room_dims[0] and
                    0 <= receiver_pos_pra[1] <= room_dims[1] and
                    0 <= receiver_pos_pra[2] <= room_dims[2]):
                raise ValueError(f"Receiver position {receiver_position} is outside room bounds")

            # Add source (omnidirectional point source)
            room.add_source(source_pos_pra)

            # Add microphone (single receiver)
            room.add_microphone(receiver_pos_pra)

            # Compute room impulse response using image source method
            room.compute_rir()

            return room

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to simulate acoustics: {str(e)}")

    @staticmethod
    def calculate_acoustic_parameters(room: pra.ShoeBox) -> dict[str, float]:
        """
        Calculate acoustic parameters from room impulse response.

        Args:
            room: Room with computed RIR

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
                rt60 = PyroomacousticsService._estimate_rt60_from_energy(rir, fs)

            # EDT: Early decay time (first 10 dB of decay)
            edt = pra.experimental.rt60.measure_rt60(rir, fs=fs, decay_db=10)
            if edt is None or np.isnan(edt):
                edt = rt60 * 0.7  # Approximation: EDT ≈ 0.7 * RT60

            # C50: Speech clarity (ratio of energy in first 50ms to rest)
            c50 = PyroomacousticsService._calculate_clarity(rir, fs, split_time=0.05)

            # C80: Music clarity (ratio of energy in first 80ms to rest)
            c80 = PyroomacousticsService._calculate_clarity(rir, fs, split_time=0.08)

            # D50: Definition (proportion of energy in first 50ms)
            d50 = PyroomacousticsService._calculate_definition(rir, fs, split_time=0.05)

            # DRR: Direct-to-reverberant ratio
            drr = PyroomacousticsService._calculate_drr(rir, fs)

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

    @staticmethod
    def export_impulse_response(
        room: pra.ShoeBox,
        output_path: str
    ) -> str:
        """
        Export room impulse response to WAV file.

        Args:
            room: Room with computed RIR
            output_path: Path to save WAV file

        Returns:
            str: Path to saved file

        Raises:
            HTTPException: If export fails
        """
        try:
            # Get RIR (first source, first microphone)
            rir = room.rir[0][0]
            fs = room.fs

            # Normalize to prevent clipping
            rir_normalized = rir / np.max(np.abs(rir))

            # Convert to 16-bit PCM
            rir_int16 = np.int16(rir_normalized * 32767)

            # Ensure output directory exists
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            # Save as WAV
            wavfile.write(output_path, fs, rir_int16)

            return output_path

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to export impulse response: {str(e)}")

    @staticmethod
    def get_material_database() -> dict[str, dict]:
        """
        Get database of material absorption presets.

        Returns:
            Dictionary mapping material names to their properties:
            - absorption: Absorption coefficient (0-1)
            - description: Human-readable description
            - category: Material category (Wall, Floor, Ceiling, Soft)
        """
        # Material database from constants (will be imported from constants.py)
        from config.constants import PYROOMACOUSTICS_MATERIALS

        return PYROOMACOUSTICS_MATERIALS
