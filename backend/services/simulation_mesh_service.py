# backend/services/simulation_mesh_service.py
# Shared simulation-mesh preparation for the geometric engines, PFFDTD and the
# geometry preflight.
#
# The preparation itself (weld -> orient from the air -> classify -> merge) is
# compas_acoustics' ``geometry.prepare_mesh``; this module only maps the app's
# settings and constants onto its options. ``SimulationMesh`` is its
# ``PreparedMesh``.
#
# Invariant: the preflight preview and the simulation both call
# ``SimulationMeshService.prepare`` with the same inputs, so what the user
# inspects is exactly what is simulated (it is deterministic: fixed RNG seed).

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from compas_acoustics.geometry import (
    FACE_CLASS_INTERIOR,
    FACE_CLASS_SHELL,
    FACE_CLASS_SKIPPED,
    PreparedMesh,
    PrepareOptions,
    material_key,
    prepare_mesh,
)

from config.constants import (
    SIM_MESH_COPLANAR_ANGLE_DEG_DEFAULT,
    SIM_MESH_ENCLOSING_OBJECT_MAX_FACES,
    SIM_MESH_ENCLOSING_OBJECT_MIN_FACES,
    SIM_MESH_ENCLOSING_OBJECT_MIN_SHARE,
    SIM_MESH_INTERIOR_OBJECT_MAX_DEPTH_M,
    SIM_MESH_LEAK_RAYS_MAX,
    SIM_MESH_MIN_TRIANGLE_AREA_M2,
    SIM_MESH_RAY_EPSILON_M,
    SIM_MESH_RAY_SEED,
    SIM_MESH_RAY_TEST_BUDGET,
    SIM_MESH_RAYS_PER_SEED_MAX,
    SIM_MESH_RAYS_PER_SEED_MIN,
    SIM_MESH_SEED_LEAKY_ESCAPE_FRACTION,
    SIM_MESH_SEED_OUTSIDE_ESCAPE_FRACTION,
    SIM_MESH_TWO_SIDED_MIN_FRACTION,
    SIM_MESH_TWO_SIDED_MIN_HITS,
    SIM_MESH_VISIBILITY_QUALITY_FACTORS,
    SIM_MESH_WALK_BOUNCES,
)
from models.schemas import MeshPrepSettings

__all__ = [
    "FACE_CLASS_INTERIOR",   # mirrored in frontend/src/types/simulationPreflight.ts
    "FACE_CLASS_SHELL",
    "FACE_CLASS_SKIPPED",
    "MeshPrepOptions",
    "SimulationMesh",
    "SimulationMeshService",
    "material_key",
]

# The prepared mesh every engine and the preflight read (compas_acoustics' layout).
SimulationMesh = PreparedMesh


@dataclass
class MeshPrepOptions:
    """The user-facing preparation settings, in metres."""

    weld_tolerance_m: float
    merge_coplanar: bool
    coplanar_angle_deg: float
    coplanar_distance_m: float
    detect_two_sided: bool
    quality_factor: float

    @classmethod
    def from_settings(cls, settings: Optional[MeshPrepSettings]) -> "MeshPrepOptions":
        s = settings or MeshPrepSettings()
        return cls(
            weld_tolerance_m=s.weld_tolerance_mm / 1000.0,
            merge_coplanar=s.merge_coplanar,
            coplanar_angle_deg=s.coplanar_angle_deg or SIM_MESH_COPLANAR_ANGLE_DEG_DEFAULT,
            coplanar_distance_m=s.coplanar_distance_mm / 1000.0,
            detect_two_sided=s.detect_two_sided,
            quality_factor=SIM_MESH_VISIBILITY_QUALITY_FACTORS[s.visibility_quality],
        )

    def to_prepare_options(self) -> PrepareOptions:
        """compas_acoustics' options: the user's settings plus the app's tuned internals (config.constants)."""
        return PrepareOptions(
            weld_tolerance=self.weld_tolerance_m,
            merge_coplanar=self.merge_coplanar,
            coplanar_angle_deg=self.coplanar_angle_deg,
            coplanar_distance=self.coplanar_distance_m,
            detect_two_sided=self.detect_two_sided,
            quality=self.quality_factor,
            min_triangle_area=SIM_MESH_MIN_TRIANGLE_AREA_M2,
            ray_seed=SIM_MESH_RAY_SEED,
            ray_test_budget=SIM_MESH_RAY_TEST_BUDGET,
            rays_per_seed_min=SIM_MESH_RAYS_PER_SEED_MIN,
            rays_per_seed_max=SIM_MESH_RAYS_PER_SEED_MAX,
            walk_bounces=SIM_MESH_WALK_BOUNCES,
            ray_epsilon=SIM_MESH_RAY_EPSILON_M,
            two_sided_min_hits=SIM_MESH_TWO_SIDED_MIN_HITS,
            two_sided_min_fraction=SIM_MESH_TWO_SIDED_MIN_FRACTION,
            seed_outside_escape_fraction=SIM_MESH_SEED_OUTSIDE_ESCAPE_FRACTION,
            seed_leaky_escape_fraction=SIM_MESH_SEED_LEAKY_ESCAPE_FRACTION,
            interior_object_max_depth=SIM_MESH_INTERIOR_OBJECT_MAX_DEPTH_M,
            leak_rays_max=SIM_MESH_LEAK_RAYS_MAX,
            enclosing_object_min_faces=SIM_MESH_ENCLOSING_OBJECT_MIN_FACES,
            enclosing_object_max_faces=SIM_MESH_ENCLOSING_OBJECT_MAX_FACES,
            enclosing_object_min_share=SIM_MESH_ENCLOSING_OBJECT_MIN_SHARE,
        )


class SimulationMeshService:
    """Weld → orient from the air → classify → merge, deterministically."""

    @staticmethod
    def prepare(
        vertices,
        faces,
        object_face_ranges: dict[str, Any],
        face_materials: dict[int, Any],
        face_scattering: Optional[dict[int, float]],
        seeds,
        options: MeshPrepOptions,
    ) -> SimulationMesh:
        """Faces without a material are dropped; every other face becomes a wall, reached by the air or not."""
        return prepare_mesh(
            vertices, faces, object_face_ranges, face_materials, face_scattering, seeds,
            options.to_prepare_options(),
        )
