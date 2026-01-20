# backend/services/pyroomacoustics_service.py
# Pyroomacoustics Acoustic Simulation Service

import numpy as np
import pyroomacoustics as pra
from scipy.io import wavfile
from pathlib import Path
from fastapi import HTTPException

from config.constants import (
    PYROOMACOUSTICS_SIMULATION_MODE_MONO,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA_RAYTRACING,
    PYROOMACOUSTICS_MAX_ORDER_MAX,
    PYROOMACOUSTICS_DEFAULT_ABSORPTION
)


class PyroomacousticsService:
    """Service for acoustic simulation using pyroomacoustics library"""

    @staticmethod
    def add_receiver_to_room(
        room,  # pra.Room
        receiver_position: list[float],
        simulation_mode: str = None,
        array_radius: float = None
    ):
        """
        Add receiver microphone(s) to room based on simulation mode.

        Args:
            room: Room object (pra.Room)
            receiver_position: [x, y, z] coordinates in meters
            simulation_mode: "mono", "foa", or "foa_raytracing"
                           If None, defaults to "mono"
            array_radius: Radius of tetrahedral array in meters (only for foa_raytracing)

        Returns:
            Room with added microphone(s)

        Raises:
            ValueError: If positions are invalid or microphone setup fails

        Note:
            - Mono mode: Single omnidirectional microphone
            - FOA mode: 4 coincident microphones with proper B-format directivity (W=omni, X/Y/Z=fig-8)
            - FOA directivity requires ISM and is not supported with ray tracing
            - FOA Raytracing mode: 4 omnidirectional mics in tetrahedral arrangement (for ray tracing)
        """

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
                    orientation=DirectionVector(azimuth=0, colatitude=90, degrees=True),
                    p=0.0,  # p=0.0 for figure-of-8
                    gain=1.0
                )
                # Y channel: Figure-of-8 along +Y axis
                # azimuth=90° points at +Y (left in ambisonic coordinates)
                y_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=90, colatitude=90, degrees=True),
                    p=0.0,  # p=0.0 for figure-of-8
                    gain=1.0
                )
                # Z channel: Figure-of-8 along +Z axis
                z_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=90, colatitude=0, degrees=True),
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

            elif simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA_RAYTRACING:
                # FOA with ray tracing: Use tetrahedral A-format array
                # This uses 4 omnidirectional mics that work with ray tracing
                # A-format to B-format conversion is done post-simulation
                PyroomacousticsService.add_tetrahedral_array_to_room(
                    room,
                    center_position=receiver_position,
                    radius=array_radius
                )
                print("NOTE: A-format to B-format conversion required after simulation.")

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
        max_order: int = PYROOMACOUSTICS_MAX_ORDER_MAX,
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
            from config.constants import PYROOMACOUSTICS_DEFAULT_SCATTERING, AUDIO_SAMPLE_RATE, PYROOMACOUSTICS_BASE_FREQUENCY

            # Use default sample rate if not provided
            if fs is None:
                fs = AUDIO_SAMPLE_RATE

            # Define Frequency bands for absorption/scattering
            pra.constants.set("octave_bands_base_freq", PYROOMACOUSTICS_BASE_FREQUENCY)
            factory = pra.acoustics.OctaveBandsFactory(fs=fs, base_frequency=PYROOMACOUSTICS_BASE_FREQUENCY)
            print(f"  Number of frequency bands: {factory.n_bands}")

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
                        face_materials[face_idx] = entity_materials.get(entity_idx, PYROOMACOUSTICS_DEFAULT_ABSORPTION)

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
                # Get absorption coefficient for this face
                # Use 1.0 (full absorption) for faces without assigned materials
                absorption = face_materials.get(face_idx, PYROOMACOUSTICS_DEFAULT_ABSORPTION)

                # # Validate absorption
                # if not (0 <= absorption <= 1):
                #     raise ValueError(f"Absorption for face {face_idx} must be between 0 and 1, got {absorption}")

                # Get scattering coefficient for this face (only used if ray_tracing=True)
                scattering = None
                if ray_tracing:
                    if face_scattering is None:
                        scattering = PYROOMACOUSTICS_DEFAULT_SCATTERING
                    else:
                        scattering = face_scattering.get(face_idx, PYROOMACOUSTICS_DEFAULT_SCATTERING)

                    # Validate scattering
                    # if not (0 <= scattering <= 1):
                    #     raise ValueError(f"Scattering for face {face_idx} must be between 0 and 1, got {scattering}")

                # Extract face vertices (corners of the wall)
                # pyroomacoustics expects corners for walls in 3D form [3, n_corners]
                face_vertices = vertices_np[face]  # Shape: [n_corners, 3]

                # Create wall from corners
                # Note: pra.Wall expects:
                # - corners as array [3, n_walls]
                # - absorption as numpy array [m, n_walls] where m is number of frequency bands
                # - scattering as numpy array [m, n_walls] (optional, for ray tracing)

                absorption_array = np.array(absorption, dtype=np.float32).reshape(-1, 1)
                # absorption_array = np.array([absorption], dtype=np.float32).T.astype(np.float32)

                # Create wall parameters
                wall_params = {
                    "corners": face_vertices.T.astype(np.float32),  # Transpose to [3, n_corners]
                    "absorption": absorption_array,
                    "name": f"face_{face_idx}"
                }

                # Add scattering if ray tracing is enabled
                # if ray_tracing and scattering is not None:
                    # scattering_array = np.array(scattering, dtype=np.float32).reshape(-1, 1)
                scattering_array = np.full(factory.n_bands, scattering)
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
            simulation_mode: Simulation mode - "mono", "foa", or "foa_raytracing"
                           If None, defaults to "mono"

        Returns:
            Room with computed RIR (for foa_raytracing, use simulate_foa_with_ray_tracing instead)

        Raises:
            HTTPException: If positions are invalid or simulation fails

        Note:
            - Ray tracing is automatically configured if the room was created with ray_tracing=True
            - To disable automatic ray tracing setup, set enable_ray_tracing=False
            - FOA mode adds four microphones for W, X, Y, Z ambisonics components (ISM only)
            - FOA Raytracing mode uses tetrahedral array; requires A-to-B conversion post-simulation
        """
        try:
            # Import constants
            from config.constants import (
                PYROOMACOUSTICS_SIMULATION_MODE_MONO,
                PYROOMACOUSTICS_SIMULATION_MODE_FOA,
                PYROOMACOUSTICS_SIMULATION_MODE_FOA_RAYTRACING
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
            # Note: foa_raytracing mode uses tetrahedral array and DOES support ray tracing
            if simulation_mode == PYROOMACOUSTICS_SIMULATION_MODE_FOA:
                enable_ray_tracing = False
                print("Ray tracing disabled for FOA mode (directivity requires ISM only)")
                print("TIP: Use 'foa_raytracing' mode for FOA with ray tracing via A-format array")

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

                # For FOA (4-channel): Transform from Three.js to Ambisonic coordinates
                # Three.js: +X=Right, +Y=Up, +Z=Backward
                # Ambisonic: +X=Front, +Y=Left, +Z=Up
                # Channel order after stacking: [W, X_threejs, Y_threejs, Z_threejs]
                # Target: [W, X_ambisonic, Y_ambisonic, Z_ambisonic]
                # Mapping:
                #   X_ambisonic (Front-Back) = -Z_threejs (Forward = -Backward)
                #   Y_ambisonic (Left-Right) = -X_threejs (Left = -Right)
                #   Z_ambisonic (Up-Down) = Y_threejs (same)
                if num_mics == 4:
                    rir_transformed = np.zeros_like(rir)
                    rir_transformed[:, 0] = rir[:, 0]    # W unchanged
                    rir_transformed[:, 1] = -rir[:, 3]   # Ambisonic X = -Three.js Z
                    rir_transformed[:, 2] = -rir[:, 1]   # Ambisonic Y = -Three.js X
                    rir_transformed[:, 3] = rir[:, 2]    # Ambisonic Z = Three.js Y
                    rir = rir_transformed
                    print("Applied Three.js → Ambisonic coordinate transformation for FOA IR")

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
        from config.constants import PYROOMACOUSTICS_DATASET

        return PYROOMACOUSTICS_DATASET

    @staticmethod
    def create_tetrahedral_array(
        center: list[float],
        radius: float = None
    ) -> np.ndarray:
        """
        Create A-format microphone array coordinates in a tetrahedral arrangement.

        This simulates a physical Ambisonics microphone (like Sennheiser Ambeo or
        Røde NT-SF1) with 4 omnidirectional capsules arranged in a tetrahedron.

        Args:
            center: [x, y, z] coordinates of array center in meters
            radius: Radius of tetrahedron in meters (default: from constants, ~2cm)

        Returns:
            np.ndarray: Microphone positions as [3, 4] array (x/y/z rows, 4 mic columns)
                       Format: [[x0,x1,x2,x3], [y0,y1,y2,y3], [z0,z1,z2,z3]]

        Note:
            The 4 microphones are arranged as:
            - Mic 0: FLU (Front Left Up)   → +X +Y +Z
            - Mic 1: BRU (Back Right Up)   → -X -Y +Z
            - Mic 2: FRD (Front Right Down) → -X +Y -Z
            - Mic 3: BLD (Back Left Down)  → +X -Y -Z
        """
        from config.constants import (
            PYROOMACOUSTICS_A_FORMAT_ARRAY_RADIUS,
            PYROOMACOUSTICS_TETRAHEDRAL_COORDS
        )

        # Use default radius if not provided
        if radius is None:
            radius = PYROOMACOUSTICS_A_FORMAT_ARRAY_RADIUS

        # Tetrahedral vertices normalized to unit sphere
        coords = np.array(PYROOMACOUSTICS_TETRAHEDRAL_COORDS) / np.sqrt(3)

        # Scale by radius and translate to center position
        # Result shape: [4, 3] (4 mics, xyz coords)
        mic_positions = (coords * radius) + np.array(center)

        # Transpose to [3, 4] format expected by pyroomacoustics
        # Format: [[x0,x1,x2,x3], [y0,y1,y2,y3], [z0,z1,z2,z3]]
        return mic_positions.T

    @staticmethod
    def convert_a_format_to_b_format(a_format_irs: np.ndarray) -> np.ndarray:
        """
        Convert A-format impulse responses to B-format (W, X, Y, Z).

        A-format is the raw output from a tetrahedral microphone array.
        B-format is the standard Ambisonics representation with:
        - W: Omnidirectional (pressure)
        - X: Front-Back dipole (velocity X)
        - Y: Left-Right dipole (velocity Y)
        - Z: Up-Down dipole (velocity Z)

        Args:
            a_format_irs: A-format IRs as [4, n_samples] array
                         Order: [FLU, BRU, FRD, BLD]

        Returns:
            np.ndarray: B-format IRs as [4, n_samples] array
                       Order: [W, X, Y, Z] (FuMa channel ordering)

        Note:
            The conversion matrix is derived from the tetrahedral geometry:
            - Mic 0 (FLU): +X +Y +Z
            - Mic 1 (BRU): -X -Y +Z
            - Mic 2 (FRD): -X +Y -Z
            - Mic 3 (BLD): +X -Y -Z

            Encoding equations:
            W = FLU + BRU + FRD + BLD (sum = omnidirectional)
            X = (FLU + BLD) - (BRU + FRD) (front - back)
            Y = (FLU + FRD) - (BRU + BLD) (left - right)
            Z = (FLU + BRU) - (FRD + BLD) (up - down)
        """
        if a_format_irs.shape[0] != 4:
            raise ValueError(f"A-format must have 4 channels, got {a_format_irs.shape[0]}")

        # Extract individual channels
        flu = a_format_irs[0]  # Front Left Up
        bru = a_format_irs[1]  # Back Right Up
        frd = a_format_irs[2]  # Front Right Down
        bld = a_format_irs[3]  # Back Left Down

        # Convert to B-format
        # W: Omnidirectional (pressure) - sum of all mics
        W = flu + bru + frd + bld

        # X: Front-Back (velocity X) - based on mic X positions
        # Mics with +X: FLU, FRD | Mics with -X: BRU, BLD
        X = (flu + frd) - (bru + bld)

        # Y: Left-Right (velocity Y) - based on mic Y positions
        # Mics with +Y: FLU, BLD | Mics with -Y: BRU, FRD
        Y = (flu + bld) - (bru + frd)

        # Z: Up-Down (velocity Z) - based on mic Z positions
        # Mics with +Z: FLU, BRU | Mics with -Z: FRD, BLD
        Z = (flu + bru) - (frd + bld)

        # Normalize: W by 1/4 (sum), XYZ by 1/2 (difference pairs)
        # This ensures proper gain structure for Ambisonics
        W = W * 0.5 * 0.7071  # 0.5 averages pairs, 0.7071 is FuMa W-attenuation
        X = X * 0.5   # 1/2 for figure-8
        Y = Y * 0.5
        Z = Z * 0.5

        # Transform from Three.js to Ambisonic coordinates
        # The tetrahedral array is placed in Three.js mesh coordinates:
        #   Three.js: +X=Right, +Y=Up, +Z=Backward
        # But B-format expects Ambisonic coordinates:
        #   Ambisonic: +X=Front, +Y=Left, +Z=Up
        #
        # The X, Y, Z computed above capture sounds along Three.js axes:
        #   X (computed) = Right-Left (Three.js ±X)
        #   Y (computed) = Up-Down (Three.js ±Y)
        #   Z (computed) = Backward-Forward (Three.js ±Z)
        #
        # Transform to Ambisonic:
        #   X_ambisonic (Front-Back) = -Z (Forward = -Backward)
        #   Y_ambisonic (Left-Right) = -X (Left = -Right)
        #   Z_ambisonic (Up-Down) = Y (same)
        X_ambisonic = -Z
        Y_ambisonic = -X
        Z_ambisonic = Y

        # Stack into B-format array [4, n_samples] in Ambisonic coordinates
        b_format_ir = np.array([W, X_ambisonic, Y_ambisonic, Z_ambisonic])

        return b_format_ir

    @staticmethod
    def add_tetrahedral_array_to_room(
        room,  # pra.Room
        center_position: list[float],
        radius: float = None
    ):
        """
        Add a tetrahedral A-format microphone array to a room.

        This is used for FOA simulation with ray tracing, where directivity
        patterns are not supported. Instead, we use 4 omnidirectional mics
        in a tight tetrahedron and convert to B-format post-simulation.

        Args:
            room: Room object (pra.Room)
            center_position: [x, y, z] center of the array in meters
            radius: Tetrahedron radius in meters (default: from constants)

        Returns:
            Room with added tetrahedral microphone array

        Raises:
            ValueError: If position is invalid or outside room geometry
        """
        from config.constants import PYROOMACOUSTICS_A_FORMAT_ARRAY_RADIUS

        if radius is None:
            radius = PYROOMACOUSTICS_A_FORMAT_ARRAY_RADIUS

        # Validate position
        if len(center_position) != 3:
            raise ValueError("Center position must be [x, y, z] coordinates")

        try:
            # Create tetrahedral array positions
            mic_locs = PyroomacousticsService.create_tetrahedral_array(
                center=center_position,
                radius=radius
            )

            # Add microphone array to room
            # mic_locs is [3, 4] array: [[x0,x1,x2,x3], [y0,y1,y2,y3], [z0,z1,z2,z3]]
            room.add_microphone_array(mic_locs)

            print(f"Added tetrahedral A-format array at {center_position} (radius={radius*100:.1f}cm)")
            print(f"  Mic positions: FLU, BRU, FRD, BLD")

            return room

        except (ValueError, AssertionError) as e:
            error_msg = str(e)
            if "inside" in error_msg.lower() or "outside" in error_msg.lower():
                raise ValueError(
                    f"Tetrahedral array center {center_position} results in mics outside room. "
                    f"Please ensure the receiver is placed well within the model bounds."
                )
            raise ValueError(f"Failed to add tetrahedral array at {center_position}: {error_msg}")

    @staticmethod
    def simulate_foa_with_ray_tracing(
        room,  # pra.Room
        source_position: list[float],
        receiver_position: list[float],
        array_radius: float = None,
        ray_tracing_params: dict = None
    ) -> tuple:
        """
        Simulate FOA using a virtual A-format tetrahedral array with ray tracing.

        This method enables FOA ambisonics simulation with ray tracing by:
        1. Creating a tetrahedral array of 4 omnidirectional microphones
        2. Running hybrid ISM + ray tracing simulation
        3. Converting A-format output to B-format (W, X, Y, Z)

        This approach works around the limitation that pyroomacoustics directivity
        patterns (required for direct B-format capture) don't work with ray tracing.

        Args:
            room: Room object (pra.Room) created with ray_tracing=True
            source_position: [x, y, z] coordinates of sound source in meters
            receiver_position: [x, y, z] center of tetrahedral array in meters
            array_radius: Tetrahedron radius in meters (default: 2cm from constants)
            ray_tracing_params: Optional dict with ray tracing parameters

        Returns:
            tuple: (room, b_format_ir)
                - room: Room with computed RIRs
                - b_format_ir: B-format IR as [4, n_samples] array [W, X, Y, Z]

        Raises:
            HTTPException: If simulation fails

        Note:
            The room must be created with ray_tracing=True for this to work properly.
            Use max_order=3 for optimal hybrid ISM/ray tracing results.
        """
        try:
            # Validate positions
            if len(source_position) != 3 or len(receiver_position) != 3:
                raise ValueError("Positions must be [x, y, z] coordinates")

            # Add source
            try:
                room.add_source(source_position)
                print(f"Added source at {source_position}")
            except (ValueError, AssertionError) as e:
                error_msg = str(e)
                if "inside" in error_msg.lower() or "outside" in error_msg.lower():
                    raise ValueError(
                        f"Source position {source_position} is not inside the room geometry."
                    )
                raise ValueError(f"Failed to add source at {source_position}: {error_msg}")

            # Add tetrahedral microphone array
            PyroomacousticsService.add_tetrahedral_array_to_room(
                room,
                center_position=receiver_position,
                radius=array_radius
            )

            # Enable ray tracing
            try:
                if ray_tracing_params:
                    PyroomacousticsService.enable_ray_tracing(room, **ray_tracing_params)
                else:
                    PyroomacousticsService.enable_ray_tracing(room)
                print("Ray tracing enabled for hybrid ISM/ray tracing simulation")
            except Exception as e:
                print(f"Warning: Ray tracing setup issue: {e}")

            # Compute room impulse responses
            print("Computing RIRs for tetrahedral array...")
            room.compute_rir()

            # Extract A-format IRs from room
            # room.rir[mic_idx][source_idx] - we have 4 mics and 1 source
            num_mics = len(room.rir)
            if num_mics != 4:
                raise ValueError(f"Expected 4 microphones for A-format, got {num_mics}")

            # Get IRs for each microphone (source index 0)
            a_format_irs = []
            for mic_idx in range(4):
                ir = room.rir[mic_idx][0]
                if ir is None or len(ir) == 0:
                    raise ValueError(f"Empty RIR for microphone {mic_idx}")
                a_format_irs.append(ir)

            # Ensure all IRs have the same length (pad shorter ones)
            max_length = max(len(ir) for ir in a_format_irs)
            padded_irs = []
            for ir in a_format_irs:
                if len(ir) < max_length:
                    padded_ir = np.pad(ir, (0, max_length - len(ir)), mode='constant')
                    padded_irs.append(padded_ir)
                else:
                    padded_irs.append(ir)

            # Stack into A-format array [4, n_samples]
            a_format = np.array(padded_irs)
            print(f"A-format IRs shape: {a_format.shape}")

            # Convert A-format to B-format
            b_format_ir = PyroomacousticsService.convert_a_format_to_b_format(a_format)
            print(f"B-format IRs shape: {b_format_ir.shape}")

            return room, b_format_ir

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to simulate FOA with ray tracing: {str(e)}"
            )

    @staticmethod
    def export_b_format_ir(
        b_format_ir: np.ndarray,
        output_path: str,
        fs: int = None
    ) -> str:
        """
        Export B-format impulse response to WAV file.

        Args:
            b_format_ir: B-format IR as [4, n_samples] array [W, X, Y, Z]
            output_path: Path to save WAV file
            fs: Sample rate in Hz (default: from constants)

        Returns:
            str: Path to saved file

        Raises:
            HTTPException: If export fails
        """
        try:
            from config.constants import AUDIO_SAMPLE_RATE

            if fs is None:
                fs = AUDIO_SAMPLE_RATE

            # Validate B-format shape
            if b_format_ir.shape[0] != 4:
                raise ValueError(f"B-format must have 4 channels, got {b_format_ir.shape[0]}")

            # Convert to [n_samples, 4] for WAV export
            rir = b_format_ir.T  # Transpose from [4, n_samples] to [n_samples, 4]

            # Normalize to prevent clipping
            max_val = np.max(np.abs(rir))
            if max_val > 0:
                rir = rir / max_val * 0.95  # Leave some headroom

            # Convert to int16
            rir_int16 = np.int16(rir * 32767)

            # Ensure output directory exists
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            # Save as WAV
            wavfile.write(output_path, fs, rir_int16)

            print(f"Exported B-format (4-channel) IR to {output_path}")

            return output_path

        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to export B-format IR: {str(e)}"
            )
