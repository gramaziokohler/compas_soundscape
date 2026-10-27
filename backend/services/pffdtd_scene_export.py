"""SimulationMesh -> PFFDTD scene (model-JSON ``mats_hash``) + material coefficients.

Faces are wound so (b-a) x (c-a) points away from the air (= SimulationMesh.normals);
PFFDTD 'sides' then says which side is lossy: 1 = back (the air side) for ordinary walls,
3 = both for two-sided (zero-thickness) surfaces.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from config.constants import PYROOMACOUSTICS_CUSTOM_MATERIALS
from services.pyroomacoustics_service import PyroomacousticsService
from services.simulation_mesh_service import SimulationMesh

PFFDTD_SIDE_BACK = 1
PFFDTD_SIDE_BOTH = 3
MATERIAL_PREFIXES = ("pyroom_",)
DEFAULT_CENTER_FREQS = [125, 250, 500, 1000, 2000, 4000, 8000]
EXPORT_COLOR = [128, 128, 128]


def resolve_material(value: Any) -> dict:
    """Material id / coefficient dict -> {"coeffs": [...], "center_freqs": [...]}."""
    if isinstance(value, dict) and "coeffs" in value:
        return {"coeffs": list(value["coeffs"]), "center_freqs": list(value.get("center_freqs", DEFAULT_CENTER_FREQS))}
    if isinstance(value, (int, float)):
        return {"coeffs": [float(value)], "center_freqs": [1000]}
    material_id = str(value)
    for prefix in MATERIAL_PREFIXES:
        if material_id.startswith(prefix):
            material_id = material_id[len(prefix):]
    if material_id in PYROOMACOUSTICS_CUSTOM_MATERIALS:
        custom = PYROOMACOUSTICS_CUSTOM_MATERIALS[material_id]
        return {"coeffs": list(custom["coeffs"]), "center_freqs": list(custom["center_freqs"])}
    resolved = PyroomacousticsService.get_material_by_id(material_id)
    if resolved is None or not resolved["coeffs"]:
        raise ValueError(f"Unknown material '{value}'")
    n = len(resolved["coeffs"])
    return {"coeffs": list(resolved["coeffs"]), "center_freqs": list(resolved["center_freqs"])[:n]}


def scene_material_ids(mesh: SimulationMesh) -> dict[str, str]:
    """PFFDTD material name (m000, ...) -> the assigned material id, in build_scene's naming order."""
    keys: dict[str, str] = {}
    for value in mesh.face_material:
        key = json.dumps(value, sort_keys=True, default=str)
        if key not in keys:
            # Inlined user materials carry their id so the legend can name them.
            keys[key] = str(value) if not isinstance(value, dict) else str(value.get("id", key))
    return {f"m{i:03d}": material_id for i, material_id in enumerate(keys.values())}


def build_scene(mesh: SimulationMesh) -> tuple[dict, dict]:
    """Return (mats_hash, materials) for the PFFDTD pipeline job."""
    keys: dict[str, str] = {}
    materials: dict[str, dict] = {}
    mats_hash: dict[str, dict] = {}
    V = mesh.vertices
    for fi, face in enumerate(mesh.faces):
        key = json.dumps(mesh.face_material[fi], sort_keys=True, default=str)
        name = keys.get(key)
        if name is None:
            name = f"m{len(keys):03d}"
            keys[key] = name
            materials[name] = resolve_material(mesh.face_material[fi])
            mats_hash[name] = {"pts": [], "tris": [], "sides": [], "color": EXPORT_COLOR}
        a, b, c = V[face[0]], V[face[1]], V[face[2]]
        if np.dot(np.cross(b - a, c - a), mesh.normals[fi]) < 0:
            b, c = c, b
        entry = mats_hash[name]
        base = len(entry["pts"])
        entry["pts"].extend([a.tolist(), b.tolist(), c.tolist()])
        entry["tris"].append([base, base + 1, base + 2])
        entry["sides"].append(PFFDTD_SIDE_BOTH if mesh.two_sided[fi] else PFFDTD_SIDE_BACK)
    return mats_hash, materials


def bounding_box(mesh: SimulationMesh) -> tuple[np.ndarray, np.ndarray]:
    return mesh.vertices[mesh.faces.ravel()].min(axis=0), mesh.vertices[mesh.faces.ravel()].max(axis=0)
