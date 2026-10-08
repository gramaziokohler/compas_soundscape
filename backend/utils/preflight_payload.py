# backend/utils/preflight_payload.py
# Serialize a prepared SimulationMesh + preflight analysis for the frontend
# preview (frontend/src/types/simulationPreflight.ts mirrors this shape).
#
# Arrays are flat and per-face so the viewer can build one BufferGeometry and
# recolour it without re-fetching when the view mode / filters change.

from __future__ import annotations

import numpy as np

from config.constants import (
    PREFLIGHT_PAYLOAD_DECIMALS,
    SIM_MESH_LEAK_RAY_DISPLAY_LENGTH_M,
)
from utils.mesh_coplanar import walls_off_hull

# Hull tolerance shared with the patched pyroomacoustics find_non_convex_walls.
_HULL_REL_TOL = 1e-5


def _flat(arr, decimals: int | None = None) -> list:
    a = np.asarray(arr)
    if decimals is not None:
        a = np.round(a.astype(np.float64), decimals)
    return a.reshape(-1).tolist()


def build_preflight_payload(preflight_id: str, engine: str, mesh, analysis, ctx, settings: dict) -> dict:
    """Assemble the JSON document served by GET /api/simulation/preflight/{id}."""
    n_faces = len(mesh.faces)
    wall_of_face = np.full(n_faces, -1, dtype=np.int64)
    for w, wall in enumerate(mesh.walls):
        wall_of_face[wall.faces] = w
    off_hull = walls_off_hull(mesh.walls, _HULL_REL_TOL)
    obstructing = off_hull[wall_of_face] if len(off_hull) else np.zeros(n_faces, dtype=bool)
    closed_face = mesh.component_closed[mesh.component] if n_faces else np.zeros(0, dtype=bool)

    loops = []
    for k, loop in enumerate(mesh.loops):
        edges = mesh.vertices[loop.edges]
        loops.append({
            "id": k,
            "segments": _flat(edges, PREFLIGHT_PAYLOAD_DECIMALS),
            "length": round(loop.length, 3),
            "extent": round(loop.extent, 3),
            "centroid": _flat(loop.centroid, PREFLIGHT_PAYLOAD_DECIMALS),
            "leaking": bool(analysis.loop_leaking[k]),
        })

    vis = mesh.visibility
    bbox_diag = float(np.linalg.norm(np.ptp(mesh.vertices, axis=0))) if len(mesh.vertices) else 0.0
    leaks = [
        {
            "origin": _flat(o, PREFLIGHT_PAYLOAD_DECIMALS),
            "end": _flat(o + d * (bbox_diag + SIM_MESH_LEAK_RAY_DISPLAY_LENGTH_M), PREFLIGHT_PAYLOAD_DECIMALS),
        }
        for o, d in zip(vis.leak_origins, vis.leak_dirs)
    ]

    seeds = []
    for i, (meta, sv) in enumerate(zip(ctx.seeds, vis.seeds)):
        seeds.append({
            "id": meta.id,
            "kind": meta.kind,
            "position": [float(x) for x in meta.position],
            "status": sv.status,
            "escape_fraction": round(sv.escape_fraction, 4),
            "surface_distance_m": round(analysis.seed_surface_distance[i], 4),
            "enclosure": analysis.enclosure[i],
        })

    stats = dict(mesh.stats)
    stats.update({
        "air_volume_m3": round(mesh.air_volume_m3, 3),
        "air_volume_method": mesh.air_volume_method,
        "ism_paths_estimate": analysis.ism_paths_estimate,
        "obstructing_walls": int(off_hull.sum()),
        "leak_fraction": round(vis.leak_fraction, 5),
    })

    return {
        "preflight_id": preflight_id,
        "engine": engine,
        "settings": settings,
        "stats": stats,
        "objects": mesh.objects,
        "vertices": _flat(mesh.vertices, PREFLIGHT_PAYLOAD_DECIMALS),
        "faces": _flat(mesh.faces),
        "face_class": _flat(mesh.face_class),
        "face_object": _flat(mesh.face_object),
        "face_wall": _flat(wall_of_face),
        "two_sided": _flat(mesh.two_sided.astype(np.int8)),
        "flipped": _flat(mesh.flipped.astype(np.int8)),
        "closed": _flat(closed_face.astype(np.int8)),
        "obstructing": _flat(np.asarray(obstructing, dtype=np.int8)),
        "air_hits": _flat(mesh.air_hits),
        "loops": loops,
        "leaks": leaks,
        "seeds": seeds,
        "blocked_paths": analysis.blocked_paths,
        "issues": [i.model_dump() for i in analysis.issues],
    }

