# backend/services/pyroomacoustics_service.py
# Pyroomacoustics Acoustic Simulation Service

import ast
import numpy as np
import pyroomacoustics as pra
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for server-side rendering
import matplotlib.pyplot as plt
from pathlib import Path
from typing import Optional
from fastapi import HTTPException

from config.constants import (
    PYROOMACOUSTICS_SIMULATION_MODE_MONO,
    PYROOMACOUSTICS_SIMULATION_MODE_FOA,
    PYROOMACOUSTICS_CUSTOM_MATERIALS
)


class PyroomacousticsService:
    """Service for acoustic simulation using pyroomacoustics library"""

    @staticmethod
    def get_service_version_info() -> dict:
        import importlib.metadata
        try:
            version = importlib.metadata.version("pyroomacoustics")
        except importlib.metadata.PackageNotFoundError:
            version = getattr(pra, "__version__", "unknown")
        return {"name": "pyroomacoustics", "version": version}

    @staticmethod
    def add_receiver_to_room(
        room,  # pra.Room
        receiver_position: list[float],
        simulation_mode: str = None,
    ):
        """
        Add receiver microphone(s) to room based on simulation mode.

        Coordinate systems:
        - Room/Mesh (Z-up, listener frame): -Y=Forward, +X=Left, +Z=Up
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
                       Mic orientations aligned to the listener frame (-Y=Forward, +X=Left, +Z=Up).
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
                # ACN Channel Order: W (0), Y (1), Z (2), X (3) with SN3D normalization.
                # DirectionVector: azimuth from +X in XY plane, colatitude from +Z.
                from pyroomacoustics.directivities import CardioidFamily, DirectionVector

                # AmbiX output: ACN channel ordering + SN3D normalization
                # SN3D: all channels have unit gain (no sqrt(3) scaling)
                # Listener frame (right-handed, Z-up; yaw=0 faces -Y, see
                # speckle-camera-controller.ts): -Y=Forward, +X=Left, +Z=Up
                # AmbiX convention: +X=Front, +Y=Left, +Z=Up
                #
                # pyroomacoustics evaluates mic directivity at the direction of
                # arrival (image_source - mic), response = p + (1-p)·(orientation·DOA).
                # Each figure-of-8 therefore points TOWARD the direction its
                # channel must be positive for.

                directivities = [
                    # ACN 0 - W: Omnidirectional (SN3D gain = 1.0)
                    CardioidFamily(
                        orientation=DirectionVector(azimuth=0, colatitude=0, degrees=True),
                        p=1.0, gain=1.0
                    ),
                    # ACN 1 - Y: Figure-of-8 toward +X (listener Left) → LEFT source → +Y
                    CardioidFamily(
                        orientation=DirectionVector(azimuth=0, colatitude=90, degrees=True),
                        p=0.0, gain=1.0
                    ),
                    # ACN 2 - Z: Figure-of-8 toward +Z (Up) → UP source → +Z
                    CardioidFamily(
                        orientation=DirectionVector(azimuth=0, colatitude=0, degrees=True),
                        p=0.0, gain=1.0
                    ),
                    # ACN 3 - X: Figure-of-8 toward -Y (listener Forward) → FRONT source → +X
                    CardioidFamily(
                        orientation=DirectionVector(azimuth=-90, colatitude=90, degrees=True),
                        p=0.0, gain=1.0
                    ),
                ]

                # 4 coincident mics at same position → [3, 4] array
                positions = np.column_stack([receiver_position] * 4)
                mic_array = pra.MicrophoneArray(positions, fs=room.fs, directivity=directivities)
                room.add_microphone_array(mic_array)

                print(f"Added FOA mic_array at {receiver_position} (ACN: W,Y,Z,X with SN3D)")

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
        tolerance: float = None,
    ) -> tuple[list, list]:
        """
        Merge coincident vertices and drop degenerate / duplicate triangles.

        Debug helper only (debug_mesh_compare.py). Simulations use
        ``SimulationMeshService.prepare``, which also orients the mesh from the
        air side. Never removes faces because of topology: the former
        non-manifold pruning deleted real walls (e.g. the shared wall of two
        adjoining rooms).
        """
        from config.constants import PYROOMACOUSTICS_MESH_WELD_TOLERANCE
        from utils.mesh_topology import dedupe_faces, weld_vertices

        welded, inv = weld_vertices(vertices, tolerance or PYROOMACOUSTICS_MESH_WELD_TOLERANCE)
        tri = inv[np.asarray(faces, dtype=np.int64).reshape(-1, 3)]
        ok = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
        tri = tri[ok]
        tri = tri[dedupe_faces(tri).kept]
        return welded.tolist(), tri.tolist()

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
    def validate_unit_scale(
        source_positions: list[list[float]],
        receiver_positions: list[list[float]],
    ) -> None:
        """
        Sanity-check that source/receiver coordinates are in meters.

        Computes every source-to-receiver distance and raises an HTTPException
        if any distance falls outside the plausible meter-scale range defined
        in constants.  A very small minimum distance (< 0.05 m) almost always
        means the model was exported in millimeters; a very large one
        (> 1000 m) suggests an unexpected unit or a data error.

        Args:
            source_positions:   List of [x, y, z] source coordinates.
            receiver_positions: List of [x, y, z] receiver coordinates.

        Raises:
            HTTPException 400: If distances are outside the expected meter range.
        """
        from config.constants import (
            PYROOMACOUSTICS_UNIT_CHECK_MIN_DISTANCE_M,
            PYROOMACOUSTICS_UNIT_CHECK_MAX_DISTANCE_M,
        )

        if not source_positions or not receiver_positions:
            return  # Nothing to check

        srcs = np.array(source_positions, dtype=float)   # (n_src, 3)
        rcvs = np.array(receiver_positions, dtype=float)  # (n_rcv, 3)

        # Compute all pairwise distances
        distances = np.linalg.norm(
            srcs[:, np.newaxis, :] - rcvs[np.newaxis, :, :], axis=-1
        )  # shape (n_src, n_rcv)

        min_dist = float(distances.min())
        max_dist = float(distances.max())

        print(
            f"Unit check — source-to-receiver distances: "
            f"min={min_dist:.4f} m, max={max_dist:.4f} m"
        )

        if min_dist < PYROOMACOUSTICS_UNIT_CHECK_MIN_DISTANCE_M:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Smallest source-to-receiver distance is {min_dist:.4f} m "
                    f"({min_dist * 1000:.1f} mm), which is below the minimum expected "
                    f"value of {PYROOMACOUSTICS_UNIT_CHECK_MIN_DISTANCE_M} m. "
                    "The model geometry is likely exported in millimeters instead of meters. "
                    "Please rescale the model to meters before running the simulation."
                ),
            )

        if max_dist > PYROOMACOUSTICS_UNIT_CHECK_MAX_DISTANCE_M:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Largest source-to-receiver distance is {max_dist:.1f} m, "
                    f"which exceeds the maximum expected value of "
                    f"{PYROOMACOUSTICS_UNIT_CHECK_MAX_DISTANCE_M} m. "
                    "The model geometry may not be in meters. "
                    "Please verify the model units before running the simulation."
                ),
            )

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

    @staticmethod
    def get_material_by_id(material_id: str) -> Optional[dict]:
        """
        Resolve a material id (from GET /api/pyroomacoustics/materials) to the
        per-band absorption coefficient dict consumed by pra.Material:

            {"coeffs": [...], "center_freqs": [...]}

        Returns None if the id is not in the database.
        """
        if not material_id:
            return None
        for category in PyroomacousticsService.get_material_database().values():
            props = category.get(material_id)
            if props is None:
                continue
            return {
                "coeffs": props.get("coeffs", []),
                "center_freqs": props.get(
                    "center_freqs", [125, 250, 500, 1000, 2000, 4000, 8000]
                ),
            }
        return None

