# backend/services/pyroomacoustics_service.py
# Pyroomacoustics Acoustic Simulation Service

import ast
import numpy as np
import pyroomacoustics as pra
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for server-side rendering
import matplotlib.pyplot as plt
from scipy.io import wavfile
from pathlib import Path
from fastapi import HTTPException

from config.constants import (
    PYROOMACOUSTICS_SIMULATION_MODE_MONO,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
    PYROOMACOUSTICS_MAX_ORDER_MAX,
    PYROOMACOUSTICS_DEFAULT_ABSORPTION,
    PYROOMACOUSTICS_CUSTOM_MATERIALS,
    PYROOMACOUSTICS_GRID_RECEIVER_POINTS_FILE,
    PYROOMACOUSTICS_GRID_PLOT_DPI,
    PYROOMACOUSTICS_GRID_PLOT_FIGSIZE,
    PYROOMACOUSTICS_GRID_PLOT_COLORMAP,
    PYROOMACOUSTICS_GRID_PLOT_CONTOUR_LEVELS
)


class PyroomacousticsService:
    """Service for acoustic simulation using pyroomacoustics library"""

    @staticmethod
    def add_receiver_to_room(
        room,  # pra.Room
        receiver_position: list[float],
        simulation_mode: str = None,
    ):
        """
        Add receiver microphone(s) to room based on simulation mode.

        Coordinate systems:
        - Room/Mesh (Z-up): +X=Right, +Y=Forward, +Z=Up
        - AmbiX B-format:   +X=Front, +Y=Left, +Z=Up

        Args:
            room: Room object (pra.Room)
            receiver_position: [x, y, z] coordinates in meters (Z-up)
            simulation_mode: "mono" or "foa". If None, defaults to "mono"

        Returns:
            Room with added microphone(s)

        Raises:
            ValueError: If positions are invalid or microphone setup fails

        Note:
            - Mono mode: Single omnidirectional microphone
            - FOA mode: MicrophoneArray with 4 coincident directivity mics (W=omni, Y/Z/X=fig-8)
                       AmbiX format: ACN channel ordering (W, Y, Z, X) with SN3D normalization.
                       Mic orientations aligned to Speckle Z-UP convention (-Y=Forward, -X=Left, +Z=Up).
                       Directivity is applied to ISM; ray tracing uses omnidirectional fallback.
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
                # B-format First Order Ambisonics using directivity patterns via MicrophoneArray.
                # ACN Channel Order: W (0), Y (1), Z (2), X (3) with N3D normalization.
                # DirectionVector: azimuth from +X in XY plane, colatitude from +Z.
                from pyroomacoustics.directivities import CardioidFamily, DirectionVector

                # AmbiX output: ACN channel ordering + SN3D normalization
                # SN3D: all channels have unit gain (no sqrt(3) scaling)
                # Speckle Z-UP mesh convention: +X=Right, -Y=Forward, +Z=Up
                # AmbiX convention: +X=Front, +Y=Left, +Z=Up

                directivities = [
                    # ACN 0 - W: Omnidirectional (SN3D gain = 1.0)
                    CardioidFamily(
                        orientation=DirectionVector(azimuth=0, colatitude=0, degrees=True),
                        p=1.0, gain=1.0
                    ),
                    # ACN 1 - Y: Figure-of-8 along mesh -X (Left in Speckle = +Y in AmbiX)
                    CardioidFamily(
                        orientation=DirectionVector(azimuth=180, colatitude=90, degrees=True),
                        p=0.0, gain=1.0
                    ),
                    # ACN 2 - Z: Figure-of-8 along mesh +Z (Up in both Speckle and AmbiX)
                    CardioidFamily(
                        orientation=DirectionVector(azimuth=0, colatitude=0, degrees=True),
                        p=0.0, gain=1.0
                    ),
                    # ACN 3 - X: Figure-of-8 along mesh -Y (Forward in Speckle = +X in AmbiX)
                    # azimuth=270 → direction (0, -1, 0) = -Y = Speckle Forward
                    CardioidFamily(
                        orientation=DirectionVector(azimuth=270, colatitude=90, degrees=True),
                        p=0.0, gain=1.0
                    ),
                ]

                # 4 coincident mics at same position → [3, 4] array
                positions = np.column_stack([receiver_position] * 4)
                mic_array = pra.MicrophoneArray(positions, fs=room.fs, directivity=directivities)
                room.add_microphone_array(mic_array)

                print(f"Added FOA mic_array at {receiver_position} (ACN: W,Y,Z,X with N3D)")

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
    def weld_mesh(
        vertices: list[list[float]],
        faces: list[list[int]],
        face_materials: dict[int, float] = None,
        face_scattering: dict[int, float] = None,
        tolerance: float = None
    ) -> tuple:
        """
        Remove duplicate vertices and merge ("weld") connected meshes.

        When multiple mesh objects are concatenated, shared boundary vertices are
        duplicated with the same 3D position but different indices.  This method
        merges those duplicates so pyroomacoustics sees a single, clean closed
        mesh.  Material and scattering assignments are preserved for every
        surviving face.

        Degenerate faces (where vertex merging causes two or more indices in a
        triangle to collapse) are dropped automatically.

        Args:
            vertices: List of [x, y, z] vertex coordinates.
            faces: List of face vertex index lists (e.g. [[0,1,2], [1,2,3]]).
            face_materials: Optional dict mapping face index → absorption value.
            face_scattering: Optional dict mapping face index → scattering value.
            tolerance: Max distance to consider two vertices identical (metres).
                       Defaults to PYROOMACOUSTICS_MESH_WELD_TOLERANCE.

        Returns:
            tuple: (welded_vertices, welded_faces, welded_face_materials,
                    welded_face_scattering)
                   – vertices and faces are plain Python lists
                   – material/scattering dicts are re-indexed to match new faces
        """
        from config.constants import PYROOMACOUSTICS_MESH_WELD_TOLERANCE

        if tolerance is None:
            tolerance = PYROOMACOUSTICS_MESH_WELD_TOLERANCE

        original_vert_count = len(vertices)
        original_face_count = len(faces)

        # Quantize vertices to a grid defined by the tolerance so that
        # positions within *tolerance* of each other snap to the same value.
        vertices_np = np.array(vertices, dtype=np.float64)
        quantized = np.round(vertices_np / tolerance) * tolerance

        # np.unique with axis=0 returns sorted unique rows and an inverse map
        # inverse_indices[i] gives the index in unique_verts for old vertex i
        unique_verts, inverse_indices = np.unique(
            quantized, axis=0, return_inverse=True
        )

        # Remap faces, drop degenerate triangles, and remove duplicate faces
        # Two meshes sharing a boundary each contribute a face with the same
        # vertices — after vertex welding those faces become identical.
        welded_faces = []
        welded_face_materials = {} if face_materials is not None else None
        welded_face_scattering = {} if face_scattering is not None else None
        seen_faces: set[tuple[int, ...]] = set()
        new_idx = 0
        n_degenerate = 0
        n_duplicate = 0

        for old_idx, face in enumerate(faces):
            remapped = [int(inverse_indices[v]) for v in face]

            # A valid triangle needs at least 3 distinct vertices
            if len(set(remapped)) < 3:
                n_degenerate += 1
                continue

            # Canonical key: sorted vertex indices (order-independent)
            face_key = tuple(sorted(remapped))
            if face_key in seen_faces:
                n_duplicate += 1
                continue
            seen_faces.add(face_key)

            welded_faces.append(remapped)

            if face_materials is not None and old_idx in face_materials:
                welded_face_materials[new_idx] = face_materials[old_idx]
            if face_scattering is not None and old_idx in face_scattering:
                welded_face_scattering[new_idx] = face_scattering[old_idx]

            new_idx += 1

        # ── Fix non-manifold edges ──────────────────────────────────────
        # After welding, boundary faces from different mesh objects may
        # create non-manifold edges (edges shared by 3+ faces).  For a
        # clean closed mesh every edge must be shared by exactly 2 faces.
        # Iteratively remove the face that contributes the most non-manifold
        # edges until none remain.
        n_non_manifold_removed = 0
        while True:
            # Build edge → face index list
            edge_faces: dict[tuple[int, int], list[int]] = {}
            for fi, face in enumerate(welded_faces):
                n = len(face)
                for j in range(n):
                    edge = tuple(sorted([face[j], face[(j + 1) % n]]))
                    edge_faces.setdefault(edge, []).append(fi)

            # Identify non-manifold edges (shared by 3+ faces)
            nm_edges = {e: fis for e, fis in edge_faces.items() if len(fis) > 2}
            if not nm_edges:
                break

            # Count how many non-manifold edges each face is involved in
            face_nm_count: dict[int, int] = {}
            for fis in nm_edges.values():
                for fi in fis:
                    face_nm_count[fi] = face_nm_count.get(fi, 0) + 1

            # Remove the face with the highest non-manifold edge count
            worst_face = max(face_nm_count, key=face_nm_count.get)
            welded_faces.pop(worst_face)

            # Re-index material / scattering dicts after removal
            if welded_face_materials is not None:
                welded_face_materials = {
                    (i if i < worst_face else i - 1): welded_face_materials[i]
                    for i in sorted(welded_face_materials)
                    if i != worst_face
                }
            if welded_face_scattering is not None:
                welded_face_scattering = {
                    (i if i < worst_face else i - 1): welded_face_scattering[i]
                    for i in sorted(welded_face_scattering)
                    if i != worst_face
                }
            n_non_manifold_removed += 1

        removed_verts = original_vert_count - len(unique_verts)
        removed_faces = original_face_count - len(welded_faces)
        print(
            f"Mesh weld: {original_vert_count} → {len(unique_verts)} vertices "
            f"(removed {removed_verts} duplicates), "
            f"{original_face_count} → {len(welded_faces)} faces "
            f"(removed {n_degenerate} degenerate, {n_duplicate} duplicate, "
            f"{n_non_manifold_removed} non-manifold)"
        )

        return (
            unique_verts.tolist(),
            welded_faces,
            welded_face_materials,
            welded_face_scattering,
        )

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

            # Weld mesh: merge duplicate vertices and drop degenerate faces
            vertices, faces, face_materials, face_scattering = (
                PyroomacousticsService.weld_mesh(
                    vertices, faces, face_materials, face_scattering
                )
             )

            # Convert vertices to numpy array for easier indexing
            vertices_np = np.array(vertices)

            # # DEBUG: save welded mesh data for comparison with STL
            # np.savez(
            #     str(Path(__file__).parent.parent / "debug_welded_mesh.npz"),
            #     vertices=vertices_np,
            #     faces=np.array(faces),
            # )
            # print(f"DEBUG: saved welded mesh to debug_welded_mesh.npz "
            #       f"(verts={vertices_np.shape}, faces={np.array(faces).shape})")

            # Create walls from faces
            walls = []
            for face_idx, face in enumerate(faces):
                # Get absorption coefficient for this face
                # Resolve custom materials (not in pra's built-in database) to their coeffs dict
                mat_value = face_materials.get(face_idx, "rough_concrete")
                if isinstance(mat_value, str) and mat_value in PYROOMACOUSTICS_CUSTOM_MATERIALS:
                    custom = PYROOMACOUSTICS_CUSTOM_MATERIALS[mat_value]
                    mat_value = {"coeffs": custom["coeffs"], "center_freqs": custom["center_freqs"]}
                material = pra.Material(energy_absorption=mat_value)
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
                # pyroomacoustics expects corners as [3, n_corners] (float64)
                face_vertices = vertices_np[face]  # Shape: [n_corners, 3]
                corners = face_vertices.T          # Transpose to [3, n_corners]

                # Create wall using wall_factory (positional args matching working reference)
                wall = pra.wall_factory(corners, absorption, scattering, f"face_{face_idx}")
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

        # Add custom materials under a "custom" category
        absoprtion_db["custom"] = PYROOMACOUSTICS_CUSTOM_MATERIALS

        return absoprtion_db

    # ========================================================================
    # Grid Receiver Simulation
    # ========================================================================

    @staticmethod
    def load_receiver_grid(file_path: str = None) -> np.ndarray:
        """
        Load a grid of receiver points from a text file.

        The file should contain a Python-style nested list with 3 sub-lists
        for X, Y, Z coordinates respectively. Comments (lines starting with #)
        are stripped before parsing.

        Args:
            file_path: Path to the receiver points file.
                       Defaults to the path from constants (PYROOMACOUSTICS_GRID_RECEIVER_POINTS_FILE).

        Returns:
            np.ndarray: Shape (3, N) array where each column is [x, y, z] for a receiver.

        Raises:
            HTTPException: If the file cannot be read or parsed.
        """
        if file_path is None:
            file_path = PYROOMACOUSTICS_GRID_RECEIVER_POINTS_FILE

        try:
            content = Path(file_path).read_text()

            # Strip comment lines (lines starting with # after optional whitespace)
            lines = [line for line in content.split('\n') if not line.strip().startswith('#')]
            cleaned = '\n'.join(lines)

            # Parse the nested list literal
            raw = ast.literal_eval(cleaned)
            grid_points = np.array(raw, dtype=float)

            if grid_points.shape[0] != 3:
                raise ValueError(f"Expected 3 rows (X, Y, Z), got {grid_points.shape[0]}")

            print(f"Loaded {grid_points.shape[1]} receiver grid points from {file_path}")
            # grid_points = grid_points[:,:50]
            print(grid_points)
            return grid_points

        except FileNotFoundError:
            raise HTTPException(
                status_code=404,
                detail=f"Receiver points file not found: {file_path}"
            )
        except (ValueError, SyntaxError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse receiver points file: {str(e)}"
            )

    @staticmethod
    def simulate_grid(
        room_factory_args: dict,
        source_positions: list[list[float]],
        grid_points: np.ndarray,
        fs: int = None
    ) -> dict:
        """
        Run a simulation with a grid of receivers and compute acoustic metrics.

        Creates a fresh room from the provided factory arguments, adds sources
        and a grid MicrophoneArray, computes RIRs, then calculates RT60 and
        dB levels for every source-receiver combination.

        Args:
            room_factory_args: Keyword arguments for create_room_from_mesh()
                               (vertices, faces, face_materials, etc.)
            source_positions: List of [x, y, z] source coordinates.
            grid_points: Shape (3, N) array of receiver coordinates.
            fs: Sample rate in Hz (default: from constants).

        Returns:
            dict with keys:
                - 'rt60': np.ndarray shape (n_sources, N) — RT60 per source-receiver
                - 'db_levels': np.ndarray shape (n_sources, N) — dB level per source-receiver
                - 'grid_points': the (3, N) receiver grid
                - 'source_positions': the source position list

        Raises:
            HTTPException: If room creation or simulation fails.
        """
        from config.constants import PYROOMACOUSTICS_SAMPLE_RATE

        if fs is None:
            fs = PYROOMACOUSTICS_SAMPLE_RATE

        try:
            # Build a fresh room for the grid run
            room = PyroomacousticsService.create_room_from_mesh(**room_factory_args)

            # Add sources
            for src_pos in source_positions:
                # src_pos = np.round(np.array(src_pos), 2).tolist()
                # print(src_pos)
                room.add_source(src_pos)

            # Filter grid points to only those inside the room geometry
            total_points = grid_points.shape[1]
            mask = [room.is_inside(grid_points[:, i].tolist()) for i in range(total_points)]
            filtered_points = grid_points[:, mask]

            if filtered_points.shape[1] == 0:
                raise ValueError(
                    f"None of the {total_points} grid receiver points are inside the room geometry. "
                    f"Grid X range: [{grid_points[0].min():.2f}, {grid_points[0].max():.2f}], "
                    f"Y range: [{grid_points[1].min():.2f}, {grid_points[1].max():.2f}], "
                    f"Z range: [{grid_points[2].min():.2f}, {grid_points[2].max():.2f}]"
                )
            
            #Remove points that are too close to sources (e.g. within 0.5m) to avoid singularities in RIRs
            threshold = 0.5
            indices_to_remove = []
            for i, point in enumerate(filtered_points.T):
                for src_pos in source_positions:
                    if np.linalg.norm(np.array(src_pos) - point) < threshold:
                        indices_to_remove.append(i)

            filtered_points = np.delete(filtered_points, indices_to_remove, axis=1)

            print(f"Grid points: {filtered_points.shape[1]}/{total_points} are inside the room")

            # Replace grid_points with filtered set
            grid_points = filtered_points

            print(grid_points)

            # Add grid receivers as MicrophoneArray
            mic_array = pra.MicrophoneArray(grid_points, fs=fs)
            room.add_microphone_array(mic_array)

            print(f"Grid simulation: {len(source_positions)} source(s), {grid_points.shape[1]} receivers")

            # Compute RIRs
            room.image_source_model()
            room.compute_rir()

            n_sources = len(source_positions)
            n_receivers = grid_points.shape[1]

            rt60 = np.zeros((n_sources, n_receivers))
            db_levels = np.zeros((n_sources, n_receivers))

            for src_idx in range(n_sources):
                for rcv_idx in range(n_receivers):
                    rir = room.rir[rcv_idx][src_idx]
                    # RT60
                    try:
                        rt60[src_idx][rcv_idx] = pra.experimental.rt60.measure_rt60(rir, fs=fs)
                    except Exception:
                        rt60[src_idx][rcv_idx] = 0.0

                    # RMS → dB level
                    rms = np.sqrt(np.mean(rir ** 2))
                    if rms > 0:
                        db_levels[src_idx][rcv_idx] = 20 * np.log10(rms)
                    else:
                        db_levels[src_idx][rcv_idx] = -120.0  # floor value

            print(f"Grid simulation complete — RT60 range: [{rt60.min():.3f}, {rt60.max():.3f}]s, "
                  f"dB range: [{db_levels.min():.1f}, {db_levels.max():.1f}]")

            return {
                'rt60': rt60,
                'db_levels': db_levels,
                'grid_points': grid_points,
                'source_positions': source_positions
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Grid simulation failed: {str(e)}"
            )

    @staticmethod
    def plot_grid_results(
        source_pos: list[float],
        receivers_pos: np.ndarray,
        values: np.ndarray,
        title: str,
        output_path: str
    ) -> str:
        """
        Generate a 2D heatmap plot of grid simulation results and save as JPG.

        Args:
            source_pos: [x, y, z] of the sound source.
            receivers_pos: Shape (3, N) receiver coordinates.
            values: Shape (N,) metric values (RT60 or dB) for each receiver.
            title: Colorbar / plot label (e.g. "RT60 (s)" or "dB Level").
            output_path: Full path for the output JPG file.

        Returns:
            str: Path to the saved JPG file.

        Raises:
            HTTPException: If plotting fails.
        """
        try:
            fig, ax = plt.subplots(figsize=PYROOMACOUSTICS_GRID_PLOT_FIGSIZE)

            x = receivers_pos[0, :]
            y = receivers_pos[1, :]
            z = np.array(values).flatten()

            # Filled contour for smooth gradient
            contour = ax.tricontourf(
                x, y, z,
                levels=PYROOMACOUSTICS_GRID_PLOT_CONTOUR_LEVELS,
                cmap=PYROOMACOUSTICS_GRID_PLOT_COLORMAP
            )

            # Source marker
            ax.scatter(
                source_pos[0], source_pos[1],
                c='red', s=60, zorder=5, edgecolors='white', linewidths=0.8,
                label='Source'
            )

            # Receiver markers
            ax.scatter(x, y, c='white', s=12, alpha=0.7, zorder=4, label='Receivers')

            # Colorbar
            cbar = fig.colorbar(contour, ax=ax)
            cbar.set_label(title, rotation=270, labelpad=15)

            ax.set_xlabel('X [m]')
            ax.set_ylabel('Y [m]')
            ax.set_aspect('equal')
            ax.legend(loc='upper right', fontsize=8)

            plt.tight_layout()

            # Ensure parent directory exists
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            fig.savefig(output_path, dpi=PYROOMACOUSTICS_GRID_PLOT_DPI, format='jpg')
            plt.close(fig)

            print(f"Grid plot saved to {output_path}")
            return output_path

        except Exception as e:
            plt.close('all')
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate grid plot: {str(e)}"
            )
