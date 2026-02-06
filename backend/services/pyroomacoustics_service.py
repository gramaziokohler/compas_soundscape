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

        Coordinate systems:
        - Room/Mesh (Z-up): +X=Right, +Y=Forward, +Z=Up
        - FuMa B-format:    +X=Front, +Y=Left, +Z=Up

        Args:
            room: Room object (pra.Room)
            receiver_position: [x, y, z] coordinates in meters (Z-up)
            simulation_mode: "mono", "foa", or "foa_raytracing"
                           If None, defaults to "mono"
            array_radius: Radius of tetrahedral array in meters (only for foa_raytracing)

        Returns:
            Room with added microphone(s)

        Raises:
            ValueError: If positions are invalid or microphone setup fails

        Note:
            - Mono mode: Single omnidirectional microphone
            - FOA mode: 4 coincident microphones with proper B-format directivity (W=omni, Y/Z/X=fig-8)
                       ACN channel ordering (W, Y, Z, X) with N3D normalization
            - FOA directivity requires ISM and is not supported with ray tracing
            - FOA Raytracing mode: 4 omnidirectional mics in tetrahedral arrangement (for ray tracing)
                       A-format to B-format conversion handles Z-up coord transform with ACN order and N3D normalization
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
                # Uses ACN channel ordering with N3D normalization (AmbiX) and Z-up coordinate system:
                #   Room coords (Z-up): +X=Right, +Y=Forward, +Z=Up
                #   AmbiX B-format:     +X=Front, +Y=Left, +Z=Up
                #
                # ACN Channel Order: W (0), Y (1), Z (2), X (3)
                # N3D Normalization: W=1.0, Y/Z/X=sqrt(3)
                #
                # DirectionVector uses spherical coords: azimuth from +X in XY plane, colatitude from +Z
                from pyroomacoustics.directivities import CardioidFamily, DirectionVector

                N3D_GAIN = np.sqrt(3)  # N3D normalization for first-order channels

                # ACN 0 - W channel: Omnidirectional (p=1.0), N3D gain=1.0
                w_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=0, colatitude=0, degrees=True),
                    p=1.0,  # p=1.0 for omnidirectional
                    gain=1.0  # N3D: W channel has unity gain
                )
                # ACN 1 - Y channel (AmbiX Left): Figure-of-8 along mesh -X axis (Left)
                # azimuth=180° points at mesh -X (Left)
                y_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=180, colatitude=90, degrees=True),
                    p=0.0,  # p=0.0 for figure-of-8
                    gain=N3D_GAIN  # N3D normalization
                )
                # ACN 2 - Z channel (AmbiX Up): Figure-of-8 along mesh +Z axis (Up)
                # colatitude=0° points at +Z
                z_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=0, colatitude=0, degrees=True),
                    p=0.0,  # p=0.0 for figure-of-8
                    gain=N3D_GAIN  # N3D normalization
                )
                # ACN 3 - X channel (AmbiX Front): Figure-of-8 along mesh +Y axis (Forward)
                # azimuth=90° points at mesh +Y (which becomes AmbiX +X = Front)
                x_directivity = CardioidFamily(
                    orientation=DirectionVector(azimuth=90, colatitude=90, degrees=True),
                    p=0.0,  # p=0.0 for figure-of-8
                    gain=N3D_GAIN  # N3D normalization
                )

                # Add coincident B-format microphones in ACN order: W, Y, Z, X
                room.add_microphone(receiver_position, directivity=w_directivity)  # ACN 0: W
                room.add_microphone(receiver_position, directivity=y_directivity)  # ACN 1: Y
                room.add_microphone(receiver_position, directivity=z_directivity)  # ACN 2: Z
                room.add_microphone(receiver_position, directivity=x_directivity)  # ACN 3: X

                print(f"Added AmbiX FOA microphone at {receiver_position} (ACN order: W,Y,Z,X with N3D normalization)")
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
            fs: Sample rate in Hz (default: from constants.PYROOMACOUSTICS_SAMPLE_RATE)
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
            from config.constants import PYROOMACOUSTICS_DEFAULT_SCATTERING, PYROOMACOUSTICS_SAMPLE_RATE, PYROOMACOUSTICS_USE_RAND_ISM

            fs = PYROOMACOUSTICS_SAMPLE_RATE
            # Number of frequency bands for absorption/scattering
            n_bands = 7

            # Define Frequency bands for absorption/scattering
            # factory = pra.acoustics.OctaveBandsFactory(fs=fs, base_frequency=PYROOMACOUSTICS_BASE_FREQUENCY)
            # print(f"  Number of frequency bands: {factory.n_bands}")

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
                material = pra.Material(energy_absorption = face_materials.get(face_idx,"rough_concrete"))
                absorption = material.energy_absorption["coeffs"]
                # print(f"Face {face_idx}: absorption = {absorption}")

                # Get scattering coefficient for this face (only used if ray_tracing=True)
                scattering = material.scattering["coeffs"]  # Default scattering
                if ray_tracing:
                    if len(absorption) != n_bands:
                        absorption = absorption + [absorption[-1]] * (n_bands - len(absorption))
                    if face_scattering is None:
                        scattering = [PYROOMACOUSTICS_DEFAULT_SCATTERING]*n_bands
                    else:
                        scattering = [face_scattering.get(face_idx, PYROOMACOUSTICS_DEFAULT_SCATTERING)]*n_bands
                        # print(f"Face {face_idx}: scattering = {scattering}")

                # Extract face vertices (corners of the wall)
                # pyroomacoustics expects corners for walls in 3D form [3, n_corners]
                face_vertices = vertices_np[face]  # Shape: [n_corners, 3]

                # Create wall from corners
                # Note: pra.Wall expects:
                # - corners as array [3, n_walls]
                # - absorption as numpy array [m, n_walls] where m is number of frequency bands
                # - scattering as numpy array [m, n_walls] (optional, for ray tracing)

                wall_params = {
                    "corners": face_vertices.T.astype(np.float32),  # Transpose to [3, n_corners]
                    "absorption": absorption,
                    "name": f"face_{face_idx}"
                }


                # Add scattering if ray tracing is enabled
                wall_params["scattering"] = scattering

                wall = pra.Wall(**wall_params)
                walls.append(wall)

            # Create room from walls
            # Use Room constructor with walls and ray tracing parameters
            room = pra.Room(
                walls=walls,
                fs=fs,
                max_order=max_order,
                ray_tracing=ray_tracing,
                air_absorption=air_absorption,
                use_rand_ism = PYROOMACOUSTICS_USE_RAND_ISM,
                max_rand_disp = 0.05
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
    def get_material_database() -> dict[str, dict]:
        """
        Get database of material absorption presets.

        Returns:
            Dictionary mapping material names to their properties:
            - coeffs: Absorption coefficient (0-1)
            - description: Human-readable description
        """
        import json
        import pkg_resources

        # Load the materials.json file included in the package
        json_str = pkg_resources.resource_string('pyroomacoustics', 'data/materials.json')
        material_db = json.loads(json_str)

        # Access the 'absorption' dictionary
        absoprtion_db = material_db["absorption"]

        return absoprtion_db

    @staticmethod
    def create_tetrahedral_array(
        center: list[float],
        radius: float = None
    ) -> np.ndarray:
        """
        Create A-format microphone array coordinates in a tetrahedral arrangement.

        This simulates a physical Ambisonics microphone (like Sennheiser Ambeo or
        Røde NT-SF1) with 4 omnidirectional capsules arranged in a tetrahedron.

        Coordinate system: Z-up (room/mesh coordinates)
        - +X = Right
        - +Y = Forward
        - +Z = Up

        Args:
            center: [x, y, z] coordinates of array center in meters
            radius: Radius of tetrahedron in meters (default: from constants, ~2cm)

        Returns:
            np.ndarray: Microphone positions as [3, 4] array (x/y/z rows, 4 mic columns)
                       Format: [[x0,x1,x2,x3], [y0,y1,y2,y3], [z0,z1,z2,z3]]

        Note:
            The 4 microphones are arranged as (Z-up convention):
            - Mic 0: RFU (Right Forward Up)    → [+1, +1, +1]
            - Mic 1: LBU (Left Back Up)        → [-1, -1, +1]
            - Mic 2: RBD (Right Back Down)     → [+1, -1, -1]
            - Mic 3: LFD (Left Forward Down)   → [-1, +1, -1]
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
        Convert A-format impulse responses to B-format in ACN channel order with N3D normalization.

        A-format is the raw output from a tetrahedral microphone array.
        B-format is the standard Ambisonics representation (AmbiX/ACN+N3D) with:
        - Channel 0 (W): Omnidirectional (pressure)
        - Channel 1 (Y): Left-Right dipole (+Y = Left in room coords)
        - Channel 2 (Z): Up-Down dipole (+Z = Up)
        - Channel 3 (X): Front-Back dipole (+X = Front in room coords)

        Coordinate systems:
        - Room/Mesh (Z-up): +X=Right, +Y=Forward, +Z=Up
        - AmbiX B-format (Z-up): +X=Front, +Y=Left, +Z=Up

        Normalization: N3D (full 3D normalization)
        - W: normalized to 1.0
        - X, Y, Z: normalized to sqrt(3) ≈ 1.732

        Args:
            a_format_irs: A-format IRs as [4, n_samples] array
                         Order: [RFU, LBU, RBD, LFD] (see tetrahedral coords)

        Returns:
            np.ndarray: B-format IRs as [4, n_samples] array
                       Order: [W, Y, Z, X] (ACN channel ordering with N3D normalization)

        Note:
            Tetrahedral mic positions in Z-up room coordinates:
            - Mic 0 (RFU): [+1, +1, +1] = Right, Forward, Up
            - Mic 1 (LBU): [-1, -1, +1] = Left, Back, Up
            - Mic 2 (RBD): [+1, -1, -1] = Right, Back, Down
            - Mic 3 (LFD): [-1, +1, -1] = Left, Forward, Down

            B-format encoding (in room coordinates):
            W = sum of all mics (omnidirectional)
            mesh_X = (RFU + RBD) - (LBU + LFD)  [Right-Left axis]
            mesh_Y = (RFU + LFD) - (LBU + RBD)  [Forward-Back axis]
            mesh_Z = (RFU + LBU) - (RBD + LFD)  [Up-Down axis]

            Transform to AmbiX (ACN order, Z-up):
            ACN 0 (W) = W (omnidirectional)
            ACN 1 (Y) = -mesh_X (Left = -Right)
            ACN 2 (Z) = mesh_Z (Up)
            ACN 3 (X) = mesh_Y (Front = Forward)
        """
        if a_format_irs.shape[0] != 4:
            raise ValueError(f"A-format must have 4 channels, got {a_format_irs.shape[0]}")

        # Extract individual channels (Z-up naming convention)
        rfu = a_format_irs[0]  # Right Forward Up   [+1, +1, +1]
        lbu = a_format_irs[1]  # Left Back Up       [-1, -1, +1]
        rbd = a_format_irs[2]  # Right Back Down    [+1, -1, -1]
        lfd = a_format_irs[3]  # Left Forward Down  [-1, +1, -1]

        # Convert to B-format in room coordinates
        # W: Omnidirectional (pressure) - sum of all mics
        W = rfu + lbu + rbd + lfd

        # mesh_X: Right-Left axis (room +X direction)
        # Mics with +X (Right): RFU, RBD | Mics with -X (Left): LBU, LFD
        mesh_X = (rfu + rbd) - (lbu + lfd)

        # mesh_Y: Forward-Back axis (room +Y direction)
        # Mics with +Y (Forward): RFU, LFD | Mics with -Y (Back): LBU, RBD
        mesh_Y = (rfu + lfd) - (lbu + rbd)

        # mesh_Z: Up-Down axis (room +Z direction)
        # Mics with +Z (Up): RFU, LBU | Mics with -Z (Down): RBD, LFD
        mesh_Z = (rfu + lbu) - (rbd + lfd)

        # N3D normalization factors:
        # W (ACN 0): normalized to 1.0
        # Y, Z, X (ACN 1, 2, 3): normalized to sqrt(3) ≈ 1.732
        # The 0.5 factor averages the tetrahedral pairs
        N3D_FACTOR = np.sqrt(3)  # N3D normalization for first-order channels

        W = W * 0.5  # W channel: N3D normalization is 1.0
        mesh_X = mesh_X * 0.5 * N3D_FACTOR  # Apply N3D normalization
        mesh_Y = mesh_Y * 0.5 * N3D_FACTOR
        mesh_Z = mesh_Z * 0.5 * N3D_FACTOR

        # Transform from room coordinates (Z-up) to AmbiX B-format (ACN order, Z-up)
        # Room coords (Z-up): +X=Right, +Y=Forward, +Z=Up
        # AmbiX B-format:     +X=Front, +Y=Left, +Z=Up
        #
        # ACN 0 (W) = W (omnidirectional)
        # ACN 1 (Y) = -mesh_X (Left = -Right)
        # ACN 2 (Z) = mesh_Z (Up)
        # ACN 3 (X) = mesh_Y (Front = Forward)
        Y_ambix = -mesh_X    # Left = -Right
        Z_ambix = mesh_Z     # Up = Up
        X_ambix = mesh_Y     # Front = Forward

        # Stack into B-format array [4, n_samples] in ACN order: W, Y, Z, X
        b_format_ir = np.array([W, Y_ambix, Z_ambix, X_ambix])

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

        Coordinate system: Z-up (+X=Right, +Y=Forward, +Z=Up)

        Args:
            room: Room object (pra.Room)
            center_position: [x, y, z] center of the array in meters (Z-up)
            radius: Tetrahedron radius in meters (default: from constants)

        Returns:
            Room with added tetrahedral microphone array

        Raises:
            ValueError: If position is invalid or outside room geometry

        Note:
            Mic arrangement (Z-up): RFU, LBU, RBD, LFD
            After simulation, use convert_a_format_to_b_format() to get AmbiX B-format (ACN+N3D).
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
            print(f"  Mic positions (Z-up): RFU, LBU, RBD, LFD")

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
        3. Converting A-format output to B-format (W, Y, Z, X) in AmbiX format (ACN+N3D)

        This approach works around the limitation that pyroomacoustics directivity
        patterns (required for direct B-format capture) don't work with ray tracing.

        Coordinate systems:
        - Room/Mesh (Z-up): +X=Right, +Y=Forward, +Z=Up
        - AmbiX B-format output (Z-up): +X=Front, +Y=Left, +Z=Up
        - ACN channel order: W (0), Y (1), Z (2), X (3)
        - N3D normalization: W=1.0, Y/Z/X=sqrt(3)

        Args:
            room: Room object (pra.Room) created with ray_tracing=True
            source_position: [x, y, z] coordinates of sound source in meters (Z-up)
            receiver_position: [x, y, z] center of tetrahedral array in meters (Z-up)
            array_radius: Tetrahedron radius in meters (default from constants)
            ray_tracing_params: Optional dict with ray tracing parameters

        Returns:
            tuple: (room, b_format_ir)
                - room: Room with computed RIRs
                - b_format_ir: B-format IR as [4, n_samples] array [W, Y, Z, X] (ACN order, N3D normalized)

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
            b_format_ir: B-format IR as [4, n_samples] array [W, Y, Z, X] (AmbiX format)
                        AmbiX convention (Z-up): +X=Front, +Y=Left, +Z=Up
                        ACN channel order with N3D normalization
            output_path: Path to save WAV file
            fs: Sample rate in Hz (default: from constants)

        Returns:
            str: Path to saved file

        Raises:
            HTTPException: If export fails

        Note:
            Output is 4-channel WAV in ACN channel order: W, Y, Z, X
            N3D normalization: W=1.0, Y/Z/X=sqrt(3)
        """
        try:
            from config.constants import PYROOMACOUSTICS_SAMPLE_RATE

            if fs is None:
                fs = PYROOMACOUSTICS_SAMPLE_RATE

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
