# backend/services/simulation_geometry_loader.py
# Fetch Speckle geometry and expand per-object materials / scattering to
# per-face maps. Shared by the pyroomacoustics worker, the Choras job and the
# geometry preflight so all three see exactly the same inputs.

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from services.speckle_service import SpeckleService
from utils.geometry import map_object_values_to_faces


@dataclass
class SimulationGeometryInputs:
    vertices: list
    faces: list
    object_ids: list[str]
    object_face_ranges: dict[str, list[int]]
    face_materials: dict[int, Any]
    face_scattering: dict[int, float]
    units: str
    n_material_matched: int
    n_material_skipped: int


def load_speckle_simulation_geometry(
    project_id: str,
    version_id: str,
    layer_name: str,
    object_ids_filter: Optional[list],
    object_materials: dict,
    object_scattering: Optional[dict] = None,
    progress: Optional[Callable[[int, str], None]] = None,
) -> SimulationGeometryInputs:
    """
    Authenticate, fetch the acoustic layer and build the face maps.

    Raises:
        RuntimeError: authentication failure or no usable geometry.
    """
    report = progress or (lambda _v, _s: None)
    report(2, "Authenticating with Speckle...")
    speckle = SpeckleService()
    if not speckle.authenticate():
        raise RuntimeError("Failed to authenticate with Speckle")

    report(5, "Fetching Speckle geometry...")
    data = speckle.get_model_geometry(
        project_id=project_id,
        version_id_or_object_id=version_id,
        layer_name=layer_name,
        object_ids_filter=object_ids_filter,
    )
    if not data:
        raise RuntimeError("Failed to retrieve geometry from Speckle")

    vertices = data.get("vertices", [])
    faces = data.get("faces", [])
    ranges: dict = data.get("object_face_ranges", {})
    if not vertices or not faces:
        if object_ids_filter:
            raise RuntimeError(
                f"No geometry found for the {len(object_ids_filter)} object IDs sent from the frontend. "
                "Ensure the objects have mesh display values in Speckle."
            )
        raise RuntimeError(
            f"No valid geometry found in Speckle layer '{layer_name}'. "
            "Ensure the layer contains mesh objects with display values."
        )

    report(12, "Processing materials...")
    face_materials, matched, skipped = map_object_values_to_faces(object_materials, ranges)
    face_scattering, _, _ = map_object_values_to_faces(object_scattering or {}, ranges, cast=float)
    return SimulationGeometryInputs(
        vertices=vertices,
        faces=faces,
        object_ids=list(data.get("object_ids", list(ranges.keys()))),
        object_face_ranges=ranges,
        face_materials=face_materials,
        face_scattering=face_scattering,
        units=data.get("units", "m"),
        n_material_matched=matched,
        n_material_skipped=skipped,
    )
