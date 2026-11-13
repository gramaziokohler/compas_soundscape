"""Sound paths for the 3D view: specular reflections, billiard rays and diffraction edges.

Runs in a CPU-worker child process on the same inputs as the simulation (Speckle geometry,
materials, pairs, mesh settings -> ``SimulationMeshService.prepare`` -> compas_acoustics room),
and writes one JSON document to ``<payload_dir>/paths_<id>.json``:

* ``reflections`` — the image-source paths of every pair up to ``max_order``
  (``compas_acoustics.SpecularReflections``), with order, delay and level;
* ``rays``        — rays traced from each source (``compas_acoustics.RayField``); the frontend
  moves a particle along each one in time (a "billiard" view);
* ``diffraction`` — every diffracting edge of the room (``hybrid.diffraction.diffraction_edges``)
  with the user's excluded ones flagged, and the first-order diffracted paths of every pair
  over the edges left on.

compas_acoustics builds the display paths from ``RoomGeometry.from_scene(scene)``; the app's room
comes from its own prepared mesh instead, so ``scene_geometry`` swaps that constructor while the
paths are computed. Coordinates in the document are model coordinates (metres, not recentred).
"""

from __future__ import annotations

import json
import os
import traceback
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import numpy as np

from config.constants import (
    ACOUSTIC_PATHS_DECIMALS,
    ACOUSTIC_PATHS_KINDS,
    ACOUSTIC_PATHS_MAX_REFLECTION_PATHS,
)
from models.schemas import MeshPrepSettings
from services.pyroomacoustics_room_builder import room_offset
from services.pyroomacoustics_worker import _write_progress, _write_result
from services.simulation_geometry_loader import load_speckle_simulation_geometry
from services.simulation_mesh_service import MeshPrepOptions, SimulationMesh, SimulationMeshService
from utils.geometry import seeds_from_pairs


def paths_payload_path(payload_dir: str, paths_id: str) -> Path:
    return Path(payload_dir) / f"paths_{paths_id}.json"


@contextmanager
def scene_geometry(geometry):
    """While in the block, ``RoomGeometry.from_scene(scene)`` gives ``geometry`` (the prepared room)."""
    from compas_acoustics.room.geometry import RoomGeometry

    original = RoomGeometry.__dict__["from_scene"]
    RoomGeometry.from_scene = classmethod(lambda cls, scene, *args, **kwargs: geometry)
    try:
        yield
    finally:
        RoomGeometry.from_scene = original


def _flat(points, offset: np.ndarray) -> list[float]:
    arr = np.asarray([list(p) for p in points], dtype=np.float64).reshape(-1, 3) + offset
    return np.round(arr, ACOUSTIC_PATHS_DECIMALS).reshape(-1).tolist()


def _level_db(band_gain) -> Optional[float]:
    """Level of a path from its band pressures at 1/(4 pi r): dB re the direct sound at 1 m."""
    g = np.asarray(band_gain if band_gain is not None else [], dtype=np.float64)
    if g.size == 0:
        return None
    rms = float(np.sqrt(np.mean((g * 4.0 * np.pi) ** 2)))
    return round(20.0 * np.log10(rms), 2) if rms > 0 else None


def room_diffraction_edges(mesh: SimulationMesh, excluded_edges: Optional[list] = None,
                           notes: Optional[list] = None, geometry=None) -> list[dict]:
    """Every diffracting edge of the prepared room (model coordinates), the excluded ones flagged.
    ``geometry``: the room's ``room_geometry(mesh, room_offset(mesh))`` when already built."""
    from compas_acoustics.hybrid.diffraction import diffraction_edges

    from services.compas_acoustics_engine import edge_excluded, edge_warnings, room_geometry

    offset = room_offset(mesh)
    rows = np.asarray(excluded_edges or [], dtype=np.float64).reshape(-1, 6)
    local = rows - np.concatenate([offset, offset]) if len(rows) else rows
    with edge_warnings(notes if notes is not None else []):
        found = diffraction_edges(geometry if geometry is not None else room_geometry(mesh, offset))
    return [
        {
            "id": k,
            "segment": _flat([e.start, e.end], offset),
            "length": round(float(e.length), 3),
            # the wedge's solid angle seen from the air: 90 deg = a box corner, 0 = a thin panel's rim
            "wedge_deg": round(float(np.degrees(2.0 * np.pi - e.theta_w)), 1),
            "kind": "obstacle" if e.component >= 0 else "boundary",
            "excluded": bool(edge_excluded(e.start, e.end, local)),
        }
        for k, e in enumerate(found)
    ]


def compute_paths(
    mesh: SimulationMesh,
    pairs: list[dict],
    kinds: list[str],
    max_order: int = 2,
    n_rays: int = 200,
    ray_order: int = 8,
    excluded_edges: Optional[list] = None,
    progress=lambda value, text: None,
) -> dict:
    """The paths document (see the module docstring) for a prepared mesh and the app's pairs."""
    import compas_acoustics as ca
    from compas_acoustics.defaults import Defaults
    from compas_acoustics.rays import diffracted_paths

    from services.compas_acoustics_engine import build_scene, diffraction_edge_filter, edge_warnings, room_geometry

    unknown = [k for k in kinds if k not in ACOUSTIC_PATHS_KINDS]
    if unknown:
        raise ValueError(f"Unknown path kind(s) {unknown}; one of {list(ACOUSTIC_PATHS_KINDS)}")
    offset = room_offset(mesh)
    geometry = room_geometry(mesh, offset)
    scene, source_of, receiver_of = build_scene(pairs, list(range(len(pairs))), offset)
    source_ids, receiver_ids = list(source_of), list(receiver_of)
    wanted = {(str(p["source_id"]), str(p["receiver_id"])) for p in pairs}
    speed = float(Defaults().DEFAULT_SPEED_OF_SOUND)
    doc: dict = {
        "speed_of_sound": speed,
        "sources": [{"id": s, "position": _flat([source_of[s].position], offset)} for s in source_ids],
        "receivers": [{"id": r, "position": _flat([receiver_of[r].position], offset)} for r in receiver_ids],
        "notes": [],
    }

    if "reflections" in kinds:
        progress(40, f"Tracing image-source paths (order {max_order})...")
        with scene_geometry(geometry):
            field = ca.SpecularReflections.from_scene(scene, max_order=int(max_order))
        paths = []
        for path in field.paths:
            s_id, r_id = source_ids[path.source_index], receiver_ids[path.receiver_index]
            if (s_id, r_id) not in wanted:
                continue
            distance = float(path.total_distance)
            paths.append({
                "s": path.source_index, "r": path.receiver_index, "order": int(path.order),
                "points": _flat(path.points, offset),
                "distance": round(distance, 3), "delay_ms": round(1000.0 * distance / speed, 3),
                "level_db": _level_db(path.band_gain),
            })
        paths.sort(key=lambda p: p["delay_ms"])
        truncated = len(paths) > ACOUSTIC_PATHS_MAX_REFLECTION_PATHS
        if truncated:
            doc["notes"].append(
                f"{len(paths)} reflection paths found; the earliest {ACOUSTIC_PATHS_MAX_REFLECTION_PATHS} are shown."
            )
            paths = paths[:ACOUSTIC_PATHS_MAX_REFLECTION_PATHS]
        doc["reflections"] = {"max_order": int(max_order), "paths": paths, "truncated": truncated}

    if "rays" in kinds:
        progress(60, f"Tracing {n_rays} rays per source...")
        with scene_geometry(geometry):
            field = ca.RayField.from_scene(scene, n_rays=int(n_rays), max_reflection_order=int(ray_order))
        rays = [{"s": int(ray.source_index), "points": _flat(ray.points, offset)} for ray in field.rays if len(ray.points) >= 2]
        doc["rays"] = {"n_rays": int(n_rays), "max_order": int(ray_order), "rays": rays,
                       "duration_ms": round(float(field.duration_ms), 2) if rays else 0.0}

    if "diffraction" in kinds:
        progress(75, "Finding diffracting edges...")
        edges = room_diffraction_edges(mesh, excluded_edges, doc["notes"], geometry)
        active_index = {}
        for edge in edges:
            if not edge["excluded"]:
                active_index[len(active_index)] = edge["id"]
        progress(85, f"Tracing diffracted paths over {len(active_index)} edge(s)...")
        with edge_warnings(doc["notes"]), diffraction_edge_filter(excluded_edges, offset, geometry):
            found = diffracted_paths(scene, max_order=1, geometry=geometry)
        paths = []
        for path in found:
            s_id, r_id = source_ids[path.source_index], receiver_ids[path.receiver_index]
            if (s_id, r_id) not in wanted:
                continue
            paths.append({
                "s": path.source_index, "r": path.receiver_index, "edge": active_index.get(path.edge, path.edge),
                "zone": path.zone, "order": int(path.order), "points": _flat(path.points, offset),
                "distance": round(float(path.distance), 3), "delay_ms": round(1000.0 * float(path.delay), 3),
                "level_db": _level_db(path.band_gain),
            })
        used = {p["edge"] for p in paths}
        for edge in edges:
            edge["used"] = edge["id"] in used
        doc["diffraction"] = {"edges": edges, "paths": paths}
    return doc


def run_acoustic_paths(
    paths_id: str,
    progress_file: str,
    result_file: str,
    speckle_project_id: str,
    speckle_version_id: str,
    layer_name: str,
    object_ids_filter,
    object_materials_dict: dict,
    object_scattering_dict: dict,
    pairs_data: list,
    mesh_settings: dict,
    payload_dir: str,
    kinds: list,
    max_order: int = 2,
    n_rays: int = 200,
    ray_order: int = 8,
    excluded_edges: Optional[list] = None,
) -> None:
    """Job entry (variant ``acoustic_paths``): Speckle geometry -> prepared mesh -> paths document."""
    try:
        inputs = load_speckle_simulation_geometry(
            speckle_project_id, speckle_version_id, layer_name, object_ids_filter,
            object_materials_dict, object_scattering_dict,
            progress=lambda v, s: _write_progress(progress_file, min(int(v * 0.25), 20), s),
        )
        _write_progress(progress_file, 22, "Preparing the simulation mesh...")
        seed_meta = seeds_from_pairs(pairs_data)
        mesh = SimulationMeshService.prepare(
            inputs.vertices, inputs.faces, inputs.object_face_ranges,
            inputs.face_materials, inputs.face_scattering,
            [s["position"] for s in seed_meta],
            MeshPrepOptions.from_settings(MeshPrepSettings(**(mesh_settings or {}))),
        )
        doc = compute_paths(
            mesh, pairs_data, list(kinds), max_order=max_order, n_rays=n_rays, ray_order=ray_order,
            excluded_edges=excluded_edges, progress=lambda v, s: _write_progress(progress_file, v, s),
        )
        doc["paths_id"] = paths_id
        _write_progress(progress_file, 95, "Writing paths...")
        os.makedirs(payload_dir, exist_ok=True)
        path = paths_payload_path(payload_dir, paths_id)
        tmp = str(path) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        os.replace(tmp, path)
        counts = {
            "n_reflections": len(doc.get("reflections", {}).get("paths", [])),
            "n_rays": len(doc.get("rays", {}).get("rays", [])),
            "n_edges": len(doc.get("diffraction", {}).get("edges", [])),
            "n_diffracted": len(doc.get("diffraction", {}).get("paths", [])),
        }
        print(f"[paths {paths_id[:8]}] {counts}")
        _write_result(result_file, {"type": "done", "result": {"paths_id": paths_id, **counts, "payload_file": path.name}})
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"Acoustic paths error [{paths_id}]:\n{tb}")
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
