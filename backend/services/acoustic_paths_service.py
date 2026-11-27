"""Sound paths stored with a compas_acoustics run, drawn in the 3D view for the hovered / selected IR.

The run keeps the paths of its own searches: ``_simulate_group`` (services/compas_acoustics_engine.py)
simulates inside ``compas_acoustics.record_paths``, so the image sources and diffracted paths the run
found come out with its responses, and ``paths_from_recorder`` turns them into the document the run
writes into its results JSON under ``"paths"`` (``utils.acoustic_paths.merge_paths_docs`` joins the
documents of the run's groups and processes):

* ``reflections`` — the image-source paths of every pair up to ``ACOUSTIC_PATHS_MAX_ORDER``
  (capped at the run's own image-source order; order 0 = the direct sound), with delay and level;
* ``diffraction`` — when the card asks for it and the run diffracts: the first-order diffracted
  paths of every pair over the edges left on.

``compute_paths`` searches them again instead: the fallback for a compas_acoustics without
``record_paths``. compas_acoustics builds those display paths from ``RoomGeometry.from_scene(scene)``;
the app's room comes from its own prepared mesh instead, so ``scene_geometry`` swaps that constructor
while they are computed. Coordinates in the document are model coordinates (metres, not recentred).
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Callable, Optional

import numpy as np

from config.constants import ACOUSTIC_PATHS_DECIMALS, ACOUSTIC_PATHS_MAX_PATHS_PER_PAIR
from services.pyroomacoustics_room_builder import room_offset
from services.simulation_mesh_service import SimulationMesh


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


def _earliest_per_pair(paths: list[dict], notes: list[str], what: str) -> list[dict]:
    """``paths`` by arrival time, at most ``ACOUSTIC_PATHS_MAX_PATHS_PER_PAIR`` per pair."""
    paths.sort(key=lambda p: p["delay_ms"])
    kept, count, cut = [], {}, False
    for p in paths:
        key = (p["s"], p["r"])
        count[key] = count.get(key, 0) + 1
        if count[key] <= ACOUSTIC_PATHS_MAX_PATHS_PER_PAIR:
            kept.append(p)
        else:
            cut = True
    if cut:
        notes.append(f"Some pairs have more than {ACOUSTIC_PATHS_MAX_PATHS_PER_PAIR} {what}: the earliest are kept.")
    return kept


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


def _doc(source_ids: list, receiver_ids: list, source_of: dict, receiver_of: dict, offset: np.ndarray,
         speed: float, max_order: int, reflections, diffracted: Optional[list], wanted: set, notes: list) -> dict:
    """The paths document of one scene: ``reflections`` a ``SpecularReflections``, ``diffracted`` a list of
    ``DiffractedPath`` (None: not stored), both indexed like ``source_ids`` / ``receiver_ids``."""
    doc: dict = {
        "speed_of_sound": speed,
        "sources": [{"id": s, "position": _flat([source_of[s].position], offset)} for s in source_ids],
        "receivers": [{"id": r, "position": _flat([receiver_of[r].position], offset)} for r in receiver_ids],
        "notes": notes,
    }
    rows = []
    for path in reflections.paths:
        if (source_ids[path.source_index], receiver_ids[path.receiver_index]) not in wanted:
            continue
        distance = float(path.total_distance)
        rows.append({
            "s": path.source_index, "r": path.receiver_index, "order": int(path.order),
            "points": _flat(path.points, offset),
            "distance": round(distance, 3), "delay_ms": round(1000.0 * distance / speed, 3),
            "level_db": _level_db(path.band_gain),
        })
    doc["reflections"] = {"max_order": int(max_order), "paths": _earliest_per_pair(rows, notes, "reflection paths")}
    if diffracted is not None:
        rows = [
            {
                "s": path.source_index, "r": path.receiver_index, "zone": path.zone, "order": int(path.order),
                "points": _flat(path.points, offset),
                "distance": round(float(path.distance), 3), "delay_ms": round(1000.0 * float(path.delay), 3),
                "level_db": _level_db(path.band_gain),
            }
            for path in diffracted
            if (source_ids[path.source_index], receiver_ids[path.receiver_index]) in wanted
        ]
        doc["diffraction"] = {"paths": _earliest_per_pair(rows, notes, "diffracted paths")}
    return doc


def _wanted(pairs: list[dict], indices: Optional[list[int]] = None) -> set:
    chosen = pairs if indices is None else [pairs[i] for i in indices]
    return {(str(p["source_id"]), str(p["receiver_id"])) for p in chosen}


def recording_available() -> bool:
    """Whether the installed compas_acoustics keeps a run's own paths (``record_paths``)."""
    try:
        from compas_acoustics.path_recorder import record_paths  # noqa: F401
    except ImportError:
        return False
    return True


def paths_from_recorder(
    recorded,
    scene,
    source_of: dict,
    receiver_of: dict,
    pairs: list[dict],
    indices: list[int],
    offset: np.ndarray,
    geometry,
    air,
    max_order: int,
    diffraction: bool,
    speed_of_sound: float,
) -> dict:
    """The paths document of the pairs ``indices`` of a run's group, from the ``compas_acoustics.PathRecorder`` its
    simulation filled (``scene`` / ``source_of`` / ``receiver_of`` as ``build_scene`` gave them)."""
    notes: list[str] = []
    return _doc(
        list(source_of), list(receiver_of), source_of, receiver_of, offset, float(speed_of_sound), max_order,
        recorded.reflections(scene, geometry, air), recorded.diffracted(scene) if diffraction else None,
        _wanted(pairs, indices), notes,
    )


def compute_paths(
    pairs: list[dict],
    offset: np.ndarray,
    geometry,
    max_order: int,
    diffraction: bool = False,
    excluded_edges: Optional[list] = None,
    speed_of_sound: Optional[float] = None,
    progress: Callable[[str], None] = lambda text: None,
) -> dict:
    """The paths document of the app's pairs, searched again in a prepared room (a compas_acoustics without
    ``record_paths``; the run's own paths are kept otherwise).

    ``geometry``: the run's ``room_geometry(mesh, offset)``; ``excluded_edges``: the card's switched-off edges
    (model coordinates), left out of the diffracted paths as in the run.
    """
    import compas_acoustics as ca
    from compas_acoustics.defaults import Defaults
    from compas_acoustics.rays import diffracted_paths

    from services.compas_acoustics_engine import build_scene, diffraction_edge_filter, edge_warnings

    scene, source_of, receiver_of = build_scene(pairs, list(range(len(pairs))), offset)
    speed = float(speed_of_sound or Defaults().DEFAULT_SPEED_OF_SOUND)
    notes: list[str] = []
    progress(f"Storing image-source paths (order {max_order})…")
    with scene_geometry(geometry):
        reflections = ca.SpecularReflections.from_scene(scene, max_order=int(max_order))
    found = None
    if diffraction:
        progress("Storing diffracted paths…")
        with edge_warnings(notes), diffraction_edge_filter(excluded_edges, offset, geometry):
            found = diffracted_paths(scene, max_order=1, geometry=geometry)
    return _doc(list(source_of), list(receiver_of), source_of, receiver_of, offset, speed, max_order,
                reflections, found, _wanted(pairs), notes)
