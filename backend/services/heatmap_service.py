"""Sound level heatmap for the Heatmap listener card (compas_acoustics ``EnergyMap``).

Runs in a CPU-worker child process on the same inputs as the simulation (Speckle geometry,
materials, pairs, mesh settings -> ``SimulationMeshService.prepare`` -> compas_acoustics room),
and writes one JSON document to ``<payload_dir>/heatmap_<id>.json``:

* ``bands``   — the octave band centres (Hz);
* ``inside``  — per point, whether it is in the air of the room;
* ``points``  — the points, model coordinates;
* ``sources`` — per source: its id, position and ``spl_bands`` (per point, the level per band in
  dB with the source at **0 dB** at 1 m in every band; null outside the room).

Each source is mapped on its own at 0 dB, so the frontend weights it by the sound card's level
(energy sum of ``spl_bands + level``) and reacts to mute / solo without rerunning the job.
"""

from __future__ import annotations

import dataclasses
import json
import os
import traceback
import warnings
from pathlib import Path

import numpy as np

from config.constants import HEATMAP_DECIMALS
from models.schemas import MeshPrepSettings
from services.acoustic_paths_service import scene_geometry
from services.pyroomacoustics_room_builder import room_offset
from services.pyroomacoustics_worker import _write_progress, _write_result
from services.simulation_geometry_loader import load_speckle_simulation_geometry
from services.simulation_mesh_service import MeshPrepOptions, SimulationMesh, SimulationMeshService
from utils.geometry import seeds_from_pairs


def heatmap_payload_path(payload_dir: str, heatmap_id: str) -> Path:
    return Path(payload_dir) / f"heatmap_{heatmap_id}.json"


def _rounded(values, offset=None) -> list:
    """Coordinates rounded to HEATMAP_DECIMALS (plus ``offset``, back to model coordinates)."""
    arr = np.asarray(values, dtype=np.float64)
    if offset is not None:
        arr = arr + offset
    return np.round(arr, HEATMAP_DECIMALS).tolist()


def _spl_rows(spl: np.ndarray, inside: np.ndarray) -> list:
    """Per point the band levels (rounded; -inf / NaN -> None), or None outside the room."""
    rows = []
    for level, ok in zip(np.round(spl, HEATMAP_DECIMALS), inside):
        rows.append([float(v) if np.isfinite(v) else None for v in level] if ok else None)
    return rows


def heatmap_geometry(mesh: SimulationMesh, offset: np.ndarray):
    """The prepared room with ``is_inside`` on: the simulation's ``room_geometry`` takes every point as in the
    air, a heatmap leaves points outside the room or inside a closed obstacle out (null)."""
    from services.compas_acoustics_engine import room_geometry

    return dataclasses.replace(room_geometry(mesh, offset), check_inside=True)


def unique_source_pairs(pairs: list[dict]) -> list[dict]:
    """The first pair of every source id, in order (the card sends each source with a dummy receiver)."""
    seen, out = set(), []
    for p in pairs:
        s_id = str(p["source_id"])
        if s_id not in seen:
            seen.add(s_id)
            out.append(p)
    return out


def compute_heatmap(mesh: SimulationMesh, pairs: list[dict], points: list, progress=lambda value, text: None) -> dict:
    """The heatmap document (see the module docstring) for a prepared mesh, the pairs and model-space points."""
    import compas_acoustics as ca
    from compas_acoustics.defaults import Defaults

    from services.compas_acoustics_engine import build_scene

    offset = room_offset(mesh)
    geometry = heatmap_geometry(mesh, offset)
    source_pairs = unique_source_pairs(pairs)
    scene, source_of, _ = build_scene(source_pairs, list(range(len(source_pairs))), offset)
    n_bands = len(Defaults().DEFAULT_FREQUENCY_BANDS)
    for source in scene.sources:
        source.spl = [0.0] * n_bands
    model_points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    local_points = model_points - offset

    notes: list[str] = []
    sources: list[dict] = []
    bands: list[float] = []
    inside = np.ones(len(model_points), dtype=bool)
    n_rays = 0
    source_ids = list(source_of)
    for i, s_id in enumerate(source_ids):
        progress(25 + int(70 * i / max(len(source_ids), 1)), f"Mapping source {i + 1} of {len(source_ids)}...")
        with warnings.catch_warnings(record=True) as caught, scene_geometry(geometry):
            warnings.simplefilter("always", UserWarning)
            energy_map = ca.EnergyMap.from_scene(scene, local_points, source_index=i, seed=True)
        for w in caught:
            if issubclass(w.category, UserWarning) and str(w.message) not in notes:
                notes.append(str(w.message))
        inside = energy_map.inside
        bands = [float(b) for b in energy_map.bands]
        n_rays = int(getattr(energy_map, "n_rays", 0))
        sources.append({
            "id": s_id,
            "position": _rounded(np.asarray(list(source_of[s_id].position), dtype=np.float64), offset),
            "spl_bands": _spl_rows(energy_map.spl(), inside),
        })
    return {
        "bands": bands,
        "inside": [bool(v) for v in inside],
        "points": _rounded(model_points),
        "sources": sources,
        "n_rays": n_rays,
        "warnings": notes,
    }


def run_heatmap(
    heatmap_id: str,
    speckle_project_id: str,
    speckle_version_id: str,
    layer_name: str,
    object_ids_filter,
    object_materials_dict: dict,
    object_scattering_dict: dict,
    pairs_data: list,
    points: list,
    mesh_settings: dict,
    payload_dir: str,
    progress_file: str,
    result_file: str,
) -> None:
    """Job entry (variant ``heatmap``): Speckle geometry -> prepared mesh -> per-source energy maps."""
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
        doc = {"heatmap_id": heatmap_id, **compute_heatmap(
            mesh, pairs_data, points, progress=lambda v, s: _write_progress(progress_file, v, s),
        )}
        _write_progress(progress_file, 96, "Writing heatmap...")
        os.makedirs(payload_dir, exist_ok=True)
        path = heatmap_payload_path(payload_dir, heatmap_id)
        tmp = str(path) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(doc, f, separators=(",", ":"), allow_nan=False)
        os.replace(tmp, path)
        print(f"[heatmap {heatmap_id[:8]}] {len(doc['points'])} points x {len(doc['sources'])} sources")
        _write_result(result_file, {"type": "done", "result": {"heatmap_id": heatmap_id, "payload_file": path.name}})
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"Heatmap error [{heatmap_id}]:\n{tb}")
        _write_result(result_file, {"type": "error", "message": str(exc), "traceback": tb})
