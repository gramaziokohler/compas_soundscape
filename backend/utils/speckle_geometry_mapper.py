"""
Speckle Geometry Mapper Utility

Translates Speckle mesh data (vertices, faces, object_ids, object_face_ranges)
into Gmsh .geo files and Choras JSON input payloads.

This module is intentionally free of FastAPI/DB dependencies so it can be
called from any backend service (Choras2, future methods, etc.).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from config.constants import (
    CHORAS_TEMP_DIR,
    CHORAS_ABSORPTION_MATERIALS,
    CHORAS_DEFAULT_FREQUENCIES,
)

logger = logging.getLogger(__name__)


# ─── Mesh orientation helper ──────────────────────────────────────────────────

def _orient_manifold_bfs(face_pids_list: list[list[int]]) -> list[list[int]]:
    """
    Re-orient triangle faces consistently using BFS so that every pair of
    adjacent faces traverses their shared edge in *opposite* directions.

    Gmsh's Surface Loop requires this consistency to form a valid closed
    manifold from which it can generate interior tetrahedral elements.

    Args:
        face_pids_list: List of [pid0, pid1, pid2] triplets (deduplicated
            point IDs).

    Returns:
        New list where each face may have had vertices 1 and 2 swapped to
        achieve consistent winding.
    """
    from collections import deque

    n = len(face_pids_list)
    if n == 0:
        return []

    result: list[list[int]] = [list(f) for f in face_pids_list]

    # Undirected edge → list of (face_idx, edge_slot)
    # We only need to find adjacency; the current direction is read from result[fi].
    edge_adj: dict[tuple[int, int], list[int]] = {}
    for fi, pids in enumerate(result):
        for j in range(3):
            a, b = pids[j], pids[(j + 1) % 3]
            key = (min(a, b), max(a, b))
            edge_adj.setdefault(key, []).append(fi)

    visited = [False] * n

    for start in range(n):
        if visited[start]:
            continue
        visited[start] = True
        queue: deque[int] = deque([start])

        while queue:
            fi = queue.popleft()
            pids_fi = result[fi]

            for j in range(3):
                p, q = pids_fi[j], pids_fi[(j + 1) % 3]
                key = (min(p, q), max(p, q))
                my_fwd = p < q  # True if I traverse this edge in ascending PID order

                for neighbor_fi in edge_adj.get(key, []):
                    if neighbor_fi == fi or visited[neighbor_fi]:
                        continue

                    # Find the neighbour's current traversal direction for this edge
                    nb_pids = result[neighbor_fi]
                    nb_fwd: bool | None = None
                    for jj in range(3):
                        pp, qq = nb_pids[jj], nb_pids[(jj + 1) % 3]
                        if (min(pp, qq), max(pp, qq)) == key:
                            nb_fwd = pp < qq
                            break

                    if nb_fwd is None:
                        continue

                    if my_fwd == nb_fwd:
                        # Same traversal direction → flip neighbour
                        x, y, z = nb_pids
                        result[neighbor_fi] = [x, z, y]

                    visited[neighbor_fi] = True
                    queue.append(neighbor_fi)

    return result


# ─── Directory helpers ────────────────────────────────────────────────────────

def build_choras_temp_dir(simulation_id: str) -> Path:
    """
    Create and return a unique temp directory for one simulation run.
    All GEO, MSH, JSON, and CSV files for this run live here.
    """
    sim_dir = Path(CHORAS_TEMP_DIR) / simulation_id
    sim_dir.mkdir(parents=True, exist_ok=True)
    return sim_dir


# ─── GEO file writer ──────────────────────────────────────────────────────────

def write_geo_from_mesh(
    vertices: list[list[float]],
    faces: list[list[int]],
    object_ids: list[str],
    object_face_ranges: dict[str, list[int]],
    geo_file_path: str,
    volume_name: str = "RoomVolume",
) -> None:
    """
    Write a Gmsh .geo file directly from Speckle mesh data.

    Physical Surface groups are named after Speckle object IDs so that the
    ``absorption_coefficients`` dict keys (also object IDs) match the surface
    group names in the mesh file.

    The algorithm mirrors ``geometry_service.convert_3dm_to_geo()``:
      1. Deduplicate vertices (tolerance 1e-6)
      2. For each triangular face, collect directed edges (a→b)
      3. Collect unique undirected edges → assign global Line IDs
      4. Write Points, Lines, Line Loops, Plane Surfaces
      5. Group surfaces per object → Physical Surface("obj_id")
      6. Write Surface Loop, Volume, Physical Volume
      7. Append Gmsh mesh algorithm settings

    Args:
        vertices: List of [x, y, z] coordinates (0-based indexing).
        faces: List of [v0, v1, v2] face triplets (0-based vertex indices).
        object_ids: Ordered list of Speckle object IDs present in the mesh.
        object_face_ranges: ``{object_id: [start_face_idx, end_face_idx]}``
            where both indices are *inclusive* and 0-based.
        geo_file_path: Output path for the .geo file.
        volume_name: Name for the Physical Volume group (default: ``"RoomVolume"``).
    """
    COORD_TOL = 6  # decimal places for vertex deduplication

    # ── 1. Deduplicate vertices ──────────────────────────────────────────────
    coord_to_point_id: dict[tuple, int] = {}
    points: dict[int, str] = {}  # point_id → geo string
    point_id = 1

    # vertex_remap[original_idx] → deduplicated_point_id
    vertex_remap: list[int] = []
    for v in vertices:
        key = (round(v[0], COORD_TOL), round(v[1], COORD_TOL), round(v[2], COORD_TOL))
        if key not in coord_to_point_id:
            coord_to_point_id[key] = point_id
            points[point_id] = (
                f"Point({point_id}) = {{ {key[0]:.6f}, {key[1]:.6f}, {key[2]:.6f}, 1.0 }};\n"
            )
            point_id += 1
        vertex_remap.append(coord_to_point_id[key])

    # ── 2. Build valid face list (skip degenerate), tracking original indices ─
    valid_face_pids: list[list[int]] = []      # [pid0, pid1, pid2]
    face_idx_to_valid: dict[int, int] = {}     # original face_idx → index in valid_face_pids

    for fi, face in enumerate(faces):
        if len(face) < 3:
            continue
        pids = [vertex_remap[vi] for vi in face[:3]]
        if len(set(pids)) < 3:
            continue
        face_idx_to_valid[fi] = len(valid_face_pids)
        valid_face_pids.append(pids)

    # ── 3. BFS re-orient faces for consistent winding ─────────────────────────
    # Adjacent faces MUST traverse their shared edge in opposite directions for
    # Gmsh's Surface Loop to form a valid closed manifold (prerequisite for 3D
    # volume meshing). Without this, Gmsh skips volume generation → no tetrahedra.
    oriented_pids = _orient_manifold_bfs(valid_face_pids)
    total_surfaces = len(oriented_pids)

    # ── 4. Build unique undirected edges from oriented faces ─────────────────
    unique_edges: dict[tuple[int, int], int] = {}  # (min,max) → line_id
    line_id = 1
    for pids in oriented_pids:
        for j in range(3):
            a, b = pids[j], pids[(j + 1) % 3]
            key = (min(a, b), max(a, b))
            if key not in unique_edges:
                unique_edges[key] = line_id
                line_id += 1

    # ── 5. Build signed line loops per oriented face ─────────────────────────
    def _signed(a: int, b: int) -> int:
        key = (min(a, b), max(a, b))
        lid = unique_edges[key]
        return lid if a < b else -lid

    line_loops: dict[int, list[int]] = {}   # surface_id (1-based) → signed line IDs
    for s_id, pids in enumerate(oriented_pids, 1):
        line_loops[s_id] = [_signed(pids[j], pids[(j + 1) % 3]) for j in range(3)]

    # ── 6. Map object_ids to their surface IDs ───────────────────────────────
    # valid_face index (0-based) + 1 = surface_id in line_loops
    obj_surfaces: dict[str, list[int]] = {}
    for obj_id in object_ids:
        if obj_id not in object_face_ranges:
            obj_surfaces[obj_id] = []
            continue
        rng = object_face_ranges[obj_id]
        start_fi, end_fi = int(rng[0]), int(rng[1])
        sids = []
        for fi in range(start_fi, end_fi + 1):
            valid_idx = face_idx_to_valid.get(fi)
            if valid_idx is not None:
                sids.append(valid_idx + 1)   # 1-based surface ID
        obj_surfaces[obj_id] = sids

    # ── 7. Write the .geo file ───────────────────────────────────────────────
    lines_geo: list[str] = []

    # Points
    for pid in sorted(points):
        lines_geo.append(points[pid])
    lines_geo.append("\n")

    # Lines
    for (a, b), lid in sorted(unique_edges.items(), key=lambda x: x[1]):
        lines_geo.append(f"Line({lid}) = {{ {a}, {b} }};\n")
    lines_geo.append("\n")

    # Line Loops + Plane Surfaces
    for s_id in range(1, total_surfaces + 1):
        if s_id not in line_loops:
            continue
        loop_str = ", ".join(str(x) for x in line_loops[s_id])
        lines_geo.append(f"Line Loop({s_id}) = {{ {loop_str} }};\n")
        lines_geo.append(f"Plane Surface({s_id}) = {{ {s_id} }};\n")
    lines_geo.append("\n")

    # Physical Surfaces (one per Speckle object)
    for obj_id in object_ids:
        sids = obj_surfaces.get(obj_id, [])
        if not sids:
            logger.warning(f"[write_geo_from_mesh] Object {obj_id!r} has no surfaces – skipping Physical Surface.")
            continue
        surfaces_str = ", ".join(str(s) for s in sids)
        lines_geo.append(f'Physical Surface("{obj_id}") = {{ {surfaces_str} }};\n')
    lines_geo.append("\n")

    # Physical Line (needed by some Gmsh/FVM versions)
    all_lids = ", ".join(str(lid) for lid in range(1, len(unique_edges) + 1))
    lines_geo.append(f'Physical Line("boundary") = {{ {all_lids} }};\n')
    lines_geo.append("\n")

    # Surface Loop + Volume + Physical Volume
    all_sids = ", ".join(str(s) for s in range(1, total_surfaces + 1))
    lines_geo.append(f"Surface Loop(1) = {{ {all_sids} }};\n")
    lines_geo.append("Volume(1) = { 1 };\n")
    lines_geo.append(f'Physical Volume("{volume_name}") = {{ 1 }};\n')
    lines_geo.append("\n")

    # Mesh algorithm settings (mirrors MeasurementRoom.geo)
    lines_geo.append("Mesh.Algorithm = 6;\n")          # 2D: Frontal-Delaunay
    lines_geo.append("Mesh.Algorithm3D = 4;\n")        # 3D: Frontal (more robust than Delaunay3D for complex surfaces)
    lines_geo.append("Mesh.Optimize = 1;\n")
    lines_geo.append("Mesh.CharacteristicLengthFromPoints = 1;\n")

    Path(geo_file_path).write_text("".join(lines_geo))
    logger.info(f"[write_geo_from_mesh] Wrote {total_surfaces} surfaces to {geo_file_path}")


# ─── Absorption coefficient builder ──────────────────────────────────────────

def build_material_absorption_dict(
    object_ids: list[str],
    object_material_names: dict[str, str],
    frequencies: list[int],
    material_database: Optional[dict] = None,
) -> dict[str, str]:
    """
    Build the ``absorption_coefficients`` dict for a Choras JSON input.

    Each entry maps a Speckle object ID (used as the Physical Surface name in
    the GEO file) to a comma-separated string of absorption coefficients at
    the requested frequency bands.

    Args:
        object_ids: List of Speckle object IDs present in the geometry.
        object_material_names: ``{object_id: material_id}`` from the frontend.
            Material IDs may carry a "choras2_" prefix which is stripped.
        frequencies: List of octave-band centre frequencies (e.g. [125, 250, 500, 1000, 2000]).
        material_database: Override for ``CHORAS_ABSORPTION_MATERIALS``.

    Returns:
        ``{object_id: "0.6, 0.69, 0.71, 0.70, 0.63", ...}``
    """
    if material_database is None:
        material_database = CHORAS_ABSORPTION_MATERIALS

    result: dict[str, str] = {}
    n = len(frequencies)
    fallback_key = "medium_absorber"

    for obj_id in object_ids:
        raw_mat = object_material_names.get(obj_id, fallback_key)
        # Strip any frontend prefix (e.g. "choras2_carpet_thick" → "carpet_thick")
        mat_name = raw_mat
        for prefix in ("choras2_", "choras_", "pyroom_"):
            if mat_name.startswith(prefix):
                mat_name = mat_name[len(prefix):]
                break

        material = material_database.get(mat_name, material_database.get(fallback_key, {}))
        coeffs: list[float] = list(material.get("coeffs", [0.5] * n))

        # Pad or trim to match requested number of frequencies
        if len(coeffs) < n:
            coeffs = coeffs + [coeffs[-1]] * (n - len(coeffs))
        else:
            coeffs = coeffs[:n]

        result[obj_id] = ", ".join(str(c) for c in coeffs)

    return result


# ─── DE JSON input builder ────────────────────────────────────────────────────

def build_de_json_input(
    sim_dir: Path,
    source_pos: list[float],
    receiver_pos: list[float],
    absorption_coefficients: dict[str, str],
    settings: dict,
) -> Path:
    """
    Write the Choras DE JSON input file for one source-receiver pair.

    The GEO and MSH paths are resolved relative to ``sim_dir``.
    ``de_method()`` will regenerate the MSH inside ``sim_dir``.

    Returns:
        Path to the written JSON file.
    """
    frequencies: list[int] = settings.get("frequencies", CHORAS_DEFAULT_FREQUENCIES)
    geo_path = str(sim_dir / "room.geo")
    msh_path = str(sim_dir / "room.msh")
    json_path = sim_dir / "input_de.json"

    payload = {
        "absorption_coefficients": absorption_coefficients,
        "msh_path": msh_path,
        "geo_path": geo_path,
        "simulationSettings": {
            "sim_len_type": settings.get("sim_len_type", "edt"),
            "edt": settings.get("edt", 35),
            "de_ir_length": settings.get("de_ir_length", 0.5),
            "de_c0": settings.get("de_c0", 343),
            "de_lc": settings.get("de_lc", 1.5),
        },
        "results": [
            {
                "sourceX": source_pos[0],
                "sourceY": source_pos[1],
                "sourceZ": source_pos[2],
                "resultType": "DE",
                "frequencies": frequencies,
                "responses": [
                    {
                        "x": receiver_pos[0],
                        "y": receiver_pos[1],
                        "z": receiver_pos[2],
                        "parameters": {
                            "edt": [], "t20": [], "t30": [],
                            "c80": [], "d50": [], "ts": [], "spl_t0_freq": [],
                        },
                        "receiverResults": [],
                    }
                ],
            }
        ],
    }

    with open(json_path, "w") as f:
        json.dump(payload, f, indent=4)

    return json_path


# ─── DG JSON input builder ────────────────────────────────────────────────────

def build_dg_json_input(
    sim_dir: Path,
    source_pos: list[float],
    receiver_positions: list[list[float]],
    absorption_coefficients: dict[str, str],
    settings: dict,
) -> Path:
    """
    Write the Choras DG JSON input file for one source with multiple receivers.

    Returns:
        Path to the written JSON file.
    """
    frequencies: list[int] = settings.get("frequencies", CHORAS_DEFAULT_FREQUENCIES)
    geo_path = str(sim_dir / "room.geo")
    msh_path = str(sim_dir / "room.msh")
    json_path = sim_dir / "input_dg.json"

    responses = [
        {
            "x": pos[0], "y": pos[1], "z": pos[2],
            "receiverResults": [],
            "receiverResultsUncorrected": [],
        }
        for pos in receiver_positions
    ]

    payload = {
        "absorption_coefficients": absorption_coefficients,
        "msh_path": msh_path,
        "geo_path": geo_path,
        "simulationSettings": {
            "dg_freq_upper_limit": settings.get("dg_freq_upper_limit", 200),
            "dg_c0": settings.get("dg_c0", 343),
            "dg_rho0": settings.get("dg_rho0", 1.213),
            "dg_ir_length": settings.get("dg_ir_length", 0.1),
            "dg_poly_order": settings.get("dg_poly_order", 4),
            "dg_ppw": settings.get("dg_ppw", 2),
            "dg_cfl": settings.get("dg_cfl", 1),
        },
        "results": [
            {
                "sourceX": source_pos[0],
                "sourceY": source_pos[1],
                "sourceZ": source_pos[2],
                "resultType": "DG",
                "frequencies": frequencies,
                "responses": responses,
            }
        ],
    }

    with open(json_path, "w") as f:
        json.dump(payload, f, indent=4)

    return json_path
