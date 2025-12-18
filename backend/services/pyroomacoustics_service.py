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
    def add_receiver_to_room(
        room,  # pra.Room
        receiver_position: list[float],
        simulation_mode: str = None
    ):
        """
        Add receiver microphone(s) to room based on simulation mode.

        Args:
            room: Room object (pra.Room)
            receiver_position: [x, y, z] coordinates in meters
            simulation_mode: "mono" or "foa"
                           If None, defaults to "mono"

        Returns:
            Room with added microphone(s)

        Raises:
            ValueError: If positions are invalid or microphone setup fails

        Note:
            - Mono mode: Single omnidirectional microphone
            - FOA mode: 4 coincident microphones with proper B-format directivity (W=omni, X/Y/Z=fig-8)
            - FOA directivity requires ISM and is not supported with ray tracing
        """
        from config.constants import (
            PYROOMACOUSTICS_SIMULATION_MODE_MONO,
            PYROOMACOUSTICS_SIMULATION_MODE_FOA
        )

        # Default to mono if not specified
        if simulation_mode is None:
            simulation_mode = PYROOMACOUSTICS_SIMULATION_MODE_MONO

        # Validate position
        if len(receiver_position) != 3:
            raise ValueError("Receiver position must be [x, y, z] coordinates")

        try:
            if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_MONO:
                # Single omnidirectional microphone
                room.add_microphone(receiver_position)
                print(f"Added mono microphone at {receiver_position}")

            elif simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
                # B-format First Order Ambisonics using proper directivity patterns
                from pyroomacoustics.directivities import CardioidFamily, DirectionVector

                # W channel: Omnidirectional (p=1.0)
                w_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=0, colatitude=0, degrees=True),
                    p=1.0,  # p=1.0 for omnidirectional
                    gain=1.0
                )
                # X channel: Figure-of-8 along +X axis
                x_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=90, colatitude=90, degrees=True),
                    p=0.0,  # p=0.0 for figure-of-8
                    gain=1.0
                )
                # Y channel: Figure-of-8 along +Y axis
                y_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=0, colatitude=90, degrees=True),
                    p=0.0,  # p=0.0 for figure-of-8
                    gain=1.0
                )
                # Z channel: Figure-of-8 along +Z axis
                z_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=0, colatitude=0, degrees=True),
                    p=0.0,  # p=0.0 for figure-of-8
                    gain=1.0
                )

                # Add coincident B-format microphones (all at same position)
                room.add_microphone(receiver_position, directivity=w_directivity)  # W
                room.add_microphone(receiver_position, directivity=x_directivity)  # X
                room.add_microphone(receiver_position, directivity=y_directivity)  # Y
                room.add_microphone(receiver_position, directivity=z_directivity)  # Z

                print(f"Added B-format FOA microphone at {receiver_position} with proper directivity (W=omni, X/Y/Z=fig-8)")
                print("NOTE: Directivity only supported with ISM. Ray tracing should be disabled.")

            else:
                raise ValueError(f"Unsupported simulation mode: {simulation_mode}")

            return room

        except (ValueError, AssertionError) as e:
            error_msg = str(e)
            if "inside" in error_msg.lower() or "outside" in error_msg.lower():
                raise ValueError(f"Receiver position {receiver_position} is not inside the room geometry. "
                               f"Please ensure receivers are placed within the model bounds.")
            raise ValueError(f"Failed to add receiver at {receiver_position}: {error_msg}")

    @staticmethod
    def create_room_from_mesh(
        vertices: list[list[float]],
        faces: list[list[int]],
        face_materials: dict[int, float] = None,
        face_entity_map: list[int] = None,
        entity_materials: dict[int, float] = None,
        face_scattering: dict[int, float] = None,
        entity_scattering: dict[int, float] = None,
        fs: int = None,
        max_order: int = 15,
        ray_tracing: bool = False,
        air_absorption: bool = False
    ) -> pra.Room:
        """
        Create a pyroomacoustics Room from a mesh with materials assigned per face or entity.

        This method supports two material assignment modes:
        1. Direct face materials: Pass face_materials dict
        2. Entity-based materials: Pass face_entity_map + entity_materials dict

        Args:
            vertices: List of [x, y, z] vertex coordinates
            faces: List of face vertex indices (e.g., [[0,1,2], [1,2,3]])
            face_materials: Dictionary mapping face index to absorption coefficient (0-1)
                           If a face is not in the dict, default to 0.5 (moderate absorption)
            face_entity_map: List mapping each face index to an entity index (for entity mode)
            entity_materials: Dictionary mapping entity index to absorption coefficient (0-1)
            face_scattering: Dictionary mapping face index to scattering coefficient (0-1)
                            If None or face not in dict, uses default from constants
                            Only used when ray_tracing=True
            entity_scattering: Dictionary mapping entity index to scattering coefficient (0-1)
                              Only used when ray_tracing=True and face_entity_map provided
            fs: Sample rate in Hz (default: from constants.AUDIO_SAMPLE_RATE)
            max_order: Maximum reflection order for image source method
                      Note: Use max_order=3 when ray_tracing=True for optimal results
            ray_tracing: Enable hybrid ISM and ray tracing simulator (default: False)
            air_absorption: Enable frequency-dependent air absorption (default: False)

        Returns:
            pra.Room: Configured room object with walls

        Raises:
            HTTPException: If mesh or materials are invalid

        Note:
            - When ray_tracing=True, call enable_ray_tracing() after adding sources/receivers
            - Ray tracing provides better accuracy for late reverberation in complex geometries
            - Scattering coefficients control how diffusely sound reflects off surfaces
        """
        try:
            # Import constants
            from config.constants import PYROOMACOUSTICS_DEFAULT_SCATTERING, AUDIO_SAMPLE_RATE

            # Use default sample rate if not provided
            if fs is None:
                fs = AUDIO_SAMPLE_RATE

            # Validate inputs
            if not vertices or not faces:
                raise ValueError("Vertices and faces cannot be empty")

            if len(vertices) < 3:
                raise ValueError("Mesh must have at least 3 vertices")

            if len(faces) < 4:
                raise ValueError("Mesh must have at least 4 faces to form a closed space")

            # Build face_materials dict based on input mode
            if face_materials is None:
                if face_entity_map is not None and entity_materials is not None:
                    # Entity-based mode
                    if len(faces) != len(face_entity_map):
                        raise ValueError("face_entity_map must have same length as faces")

                    face_materials = {}
                    for face_idx, entity_idx in enumerate(face_entity_map):
                        face_materials[face_idx] = entity_materials.get(entity_idx, 0.5)

                    # Build face_scattering from entity_scattering if provided
                    if entity_scattering is not None and ray_tracing:
                        face_scattering = {}
                        for face_idx, entity_idx in enumerate(face_entity_map):
                            if entity_idx in entity_scattering:
                                face_scattering[face_idx] = entity_scattering[entity_idx]
                else:
                    # No materials provided - use defaults
                    face_materials = {}

            # Convert vertices to numpy array for easier indexing
            vertices_np = np.array(vertices)

            # Create walls from faces
            walls = []
            for face_idx, face in enumerate(faces):
                # Get absorption coefficient for this face (default: 0.5)
                absorption = face_materials.get(face_idx, 0.5)

                # Validate absorption
                if not (0 <= absorption <= 1):
                    raise ValueError(f"Absorption for face {face_idx} must be between 0 and 1, got {absorption}")

                # Get scattering coefficient for this face (only used if ray_tracing=True)
                scattering = None
                if ray_tracing:
                    if face_scattering is None:
                        scattering = PYROOMACOUSTICS_DEFAULT_SCATTERING
                    else:
                        scattering = face_scattering.get(face_idx, PYROOMACOUSTICS_DEFAULT_SCATTERING)

                    # Validate scattering
                    if not (0 <= scattering <= 1):
                        raise ValueError(f"Scattering for face {face_idx} must be between 0 and 1, got {scattering}")

                # Extract face vertices (corners of the wall)
                # pyroomacoustics expects corners for walls in 3D form [3, n_corners]
                face_vertices = vertices_np[face]  # Shape: [n_corners, 3]

                # Create wall from corners
                # Note: pra.Wall expects:
                # - corners as array [3, n_corners]
                # - absorption as numpy array [m, 1] where m is number of frequency bands
                # - scattering as numpy array [m, 1] (optional, for ray tracing)
                # For simplicity, use single frequency band with the given absorption value
                absorption_array = np.array([[absorption]], dtype=np.float32)

                # Create wall parameters
                wall_params = {
                    "corners": face_vertices.T.astype(np.float32),  # Transpose to [3, n_corners]
                    "absorption": absorption_array,
                    "name": f"face_{face_idx}"
                }

                # Add scattering if ray tracing is enabled
                if ray_tracing and scattering is not None:
                    scattering_array = np.array([[scattering]], dtype=np.float32)
                    wall_params["scattering"] = scattering_array

                wall = pra.Wall(**wall_params)
                walls.append(wall)

            # Create room from walls
            # Use Room constructor with walls and ray tracing parameters
            room = pra.Room(
                walls=walls,
                fs=fs,
                max_order=max_order,
                ray_tracing=ray_tracing,
                air_absorption=air_absorption
            )

            return room

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create room from mesh: {str(e)}")

    @staticmethod
    def enable_ray_tracing(
        room,  # pra.Room
        n_rays: int = None,
        receiver_radius: float = None,
        energy_thres: float = None,
        time_thres: float = None,
        hist_bin_size: float = None
    ):
        """
        Enable hybrid ISM and ray tracing simulator for more accurate late reverberation.

        The hybrid approach combines Image Source Method (ISM) for early reflections
        with ray tracing for late reverb, providing better accuracy especially for
        complex geometries and longer reverberation times.

        Args:
            room: Room object (pra.Room) with ray_tracing=True
            n_rays: Number of rays to shoot (default: from constants)
            receiver_radius: Sphere radius around microphone in meters (default: from constants)
            energy_thres: Threshold for ray termination (default: from constants)
            time_thres: Maximum ray flight time in seconds (default: from constants)
            hist_bin_size: Time granularity of energy bins in seconds (default: from constants)

        Returns:
            Room with ray tracing enabled

        Raises:
            HTTPException: If room was not created with ray_tracing=True or configuration fails

        Note:
            - The room must be created with ray_tracing=True parameter
            - Use max_order=3 with hybrid simulator for optimal results
            - Ray tracing is more computationally intensive than ISM alone
        """
        try:
            # Import constants
            from config.constants import (
                PYROOMACOUSTICS_RAY_TRACING_N_RAYS,
                PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS,
                PYROOMACOUSTICS_RAY_TRACING_ENERGY_THRES,
                PYROOMACOUSTICS_RAY_TRACING_TIME_THRES,
                PYROOMACOUSTICS_RAY_TRACING_HIST_BIN_SIZE
            )

            # Use defaults from constants if not provided
            n_rays = n_rays or PYROOMACOUSTICS_RAY_TRACING_N_RAYS
            receiver_radius = receiver_radius or PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS
            energy_thres = energy_thres or PYROOMACOUSTICS_RAY_TRACING_ENERGY_THRES
            time_thres = time_thres or PYROOMACOUSTICS_RAY_TRACING_TIME_THRES
            hist_bin_size = hist_bin_size or PYROOMACOUSTICS_RAY_TRACING_HIST_BIN_SIZE

            # Validate parameters
            if n_rays <= 0:
                raise ValueError("n_rays must be positive")
            if receiver_radius <= 0:
                raise ValueError("receiver_radius must be positive")
            if energy_thres <= 0:
                raise ValueError("energy_thres must be positive")
            if time_thres <= 0:
                raise ValueError("time_thres must be positive")
            if hist_bin_size <= 0:
                raise ValueError("hist_bin_size must be positive")

            # Enable ray tracing with specified parameters
            # This will raise an error if room wasn't created with ray_tracing=True
            room.set_ray_tracing(
                n_rays=n_rays,
                receiver_radius=receiver_radius,
                energy_thres=energy_thres,
                time_thres=time_thres,
                hist_bin_size=hist_bin_size
            )

            print(f"Ray tracing enabled with {n_rays} rays, receiver_radius={receiver_radius}m")

            return room

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to enable ray tracing: {str(e)}")

    @staticmethod
    def simulate_room_acoustics(
        room,  # pra.Room
        source_position: list[float],
        receiver_position: list[float],
        enable_ray_tracing: bool = True,
        ray_tracing_params: dict = None,
        simulation_mode: str = None
    ):
        """
        Add source and receiver to room and compute room impulse response.

        Args:
            room: Room object (pra.Room)
            source_position: [x, y, z] coordinates in meters
            receiver_position: [x, y, z] coordinates in meters
            enable_ray_tracing: If True and room was created with ray_tracing=True,
                              automatically enable ray tracing before computing RIR (default: True)
            ray_tracing_params: Optional dict with ray tracing parameters:
                              {n_rays, receiver_radius, energy_thres, time_thres, hist_bin_size}
                              If None, uses defaults from constants
            simulation_mode: Simulation mode - "mono" or "foa"
                           If None, defaults to "mono"

        Returns:
            Room with computed RIR

        Raises:
            HTTPException: If positions are invalid or simulation fails

        Note:
            - Ray tracing is automatically configured if the room was created with ray_tracing=True
            - To disable automatic ray tracing setup, set enable_ray_tracing=False
            - FOA mode adds four microphones for W, X, Y, Z ambisonics components
        """
        try:
            # Import constants
            from config.constants import (
                PYROOMACOUSTICS_SIMULATION_MODE_MONO,
                PYROOMACOUSTICS_SIMULATION_MODE_FOA
            )

            # Default to mono if not specified
            if simulation_mode is None:
                simulation_mode = PYROOMACOUSTICS_SIMULATION_MODE_MONO

            # Validate positions
            if len(source_position) != 3 or len(receiver_position) != 3:
                raise ValueError("Positions must be [x, y, z] coordinates")

            # Use positions as-is for mesh-based rooms (already in correct coordinate system)
            source_pos = source_position
            receiver_pos = receiver_position

            # Add source (omnidirectional point source)
            try:
                room.add_source(source_pos)
            except (ValueError, AssertionError) as e:
                error_msg = str(e)
                if "inside" in error_msg.lower() or "outside" in error_msg.lower():
                    raise ValueError(f"Source position {source_pos} is not inside the room geometry. "
                                   f"Please ensure sources are placed within the model bounds.")
                raise ValueError(f"Failed to add source at {source_pos}: {error_msg}")

            # Add microphones using the helper method
            PyroomacousticsService.add_receiver_to_room(room, receiver_pos, simulation_mode)

            # Disable ray tracing for FOA mode since directivity requires ISM
            if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
                enable_ray_tracing = False

            # Enable ray tracing if enabled and room supports it
            # Try to enable ray tracing - it will only work if room was created with ray_tracing=True
            if enable_ray_tracing:
                try:
                    if ray_tracing_params:
                        PyroomacousticsService.enable_ray_tracing(room, **ray_tracing_params)
                    else:
                        PyroomacousticsService.enable_ray_tracing(room)
                    print("Ray tracing enabled for hybrid ISM/ray tracing simulation")
                except (ValueError, AttributeError) as e:
                    # Room doesn't support ray tracing (wasn't created with ray_tracing=True)
                    print(f"Ray tracing not available for this room (expected for ISM-only mode)")
                except Exception as e:
                    # Unexpected error
                    print(f"Warning: Failed to enable ray tracing: {type(e).__name__}: {str(e)}")
                    pass

            # Compute room impulse response using image source method
            # (or hybrid ISM + ray tracing if enabled)
            room.compute_rir()

            return room

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to simulate acoustics: {str(e)}")

    @staticmethod
    def export_impulse_response(
        room,  # pra.Room
        output_path: str,
        source_idx: int = 0
    ) -> str:
        """
        Export room impulse response to WAV file.
        Handles mono (1-ch) and FOA ambisonics (4-ch) IRs.

        Args:
            room: Room with computed RIR (pra.Room)
            output_path: Path to save WAV file
            source_idx: Index of the source to export (default: 0)

        Returns:
            str: Path to saved file

        Raises:
            HTTPException: If export fails

        Note:
            room.rir is indexed as [mic_idx][source_idx]
        """
        try:
            # Get number of microphones and sample rate
            # room.rir[mic_idx][source_idx] for each microphone
            num_mics = len(room.rir)
            fs = room.fs

            # Validate we have microphones
            if num_mics == 0:
                raise ValueError("No microphones found in room")

            # Validate source index
            if source_idx >= len(room.rir[0]):
                raise ValueError(f"Source index {source_idx} out of range (total sources: {len(room.rir[0])})")

            if num_mics == 1:
                # Mono: single channel
                rir = room.rir[0][source_idx]

                # Validate RIR is not empty
                if rir is None or len(rir) == 0:
                    raise ValueError(f"Empty RIR for source {source_idx}")

                rir_int16 = np.int16(rir * 32767)
            else:
                # Multi-channel: FOA (4-ch)
                # Stack all microphone channels into multi-channel array
                rir_channels = []
                for mic_idx in range(num_mics):
                    rir = room.rir[mic_idx][source_idx]

                    # Validate RIR is not empty
                    if rir is None or len(rir) == 0:
                        raise ValueError(f"Empty RIR for microphone {mic_idx}, source {source_idx}")

                    rir_channels.append(rir)

                # Validate we have channels
                if len(rir_channels) == 0:
                    raise ValueError("No RIR channels collected")

                # Find maximum length among all channels (RIRs can have different lengths)
                max_length = max(len(rir) for rir in rir_channels)

                # Pad all channels to the same length with zeros
                padded_channels = []
                for rir in rir_channels:
                    if len(rir) < max_length:
                        # Pad with zeros at the end
                        padded_rir = np.pad(rir, (0, max_length - len(rir)), mode='constant')
                        padded_channels.append(padded_rir)
                    else:
                        padded_channels.append(rir)

                # Convert to shape [n_samples, n_channels] for WAV export
                rir = np.column_stack(padded_channels)
                rir_int16 = np.int16(rir * 32767)

            # Ensure output directory exists
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            # Save as WAV
            wavfile.write(output_path, fs, rir_int16)

            print(f"Exported {num_mics}-channel IR to {output_path}")

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
