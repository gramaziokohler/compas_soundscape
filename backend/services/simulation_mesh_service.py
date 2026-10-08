# backend/services/simulation_mesh_service.py
# Shared simulation-mesh preparation for pyroomacoustics, Choras and the
# geometry preflight.
#
# Invariant: the preflight preview and the simulation both call
# ``SimulationMeshService.prepare`` with the same inputs, so what the user
# inspects is exactly what is simulated (it is deterministic: fixed RNG seed).

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

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
from utils.air_visibility import AirVisibility, rays_for_budget, walk_from_seeds
from utils.mesh_coplanar import MergedWall, merge_coplanar
from utils.mesh_orientation import OrientationInputs, decide_orientation
from utils.mesh_raycast import TriangleSet, first_hits
from utils.mesh_topology import (
    BoundaryLoop,
    boundary_loops,
    build_edges,
    component_closed,
    connected_face_components,
    dedupe_faces,
    face_normals_and_areas,
    orient_consistently,
    signed_volume,
    weld_vertices,
)

# Face classes (mirrored in frontend/src/types/simulationPreflight.ts).
# Double-sidedness is orthogonal to the class (SimulationMesh.two_sided): a
# thin surface is shell when sound escapes the model from one of its sides,
# interior otherwise.
FACE_CLASS_SHELL = 0      # air-facing, backed by the exterior / solid mass
FACE_CLASS_INTERIOR = 1   # air-facing face of an object / partition inside the room
FACE_CLASS_SKIPPED = 2    # never reached from the air (kept, no acoustic effect)

# Mean-free-path volume needs enough chords to be meaningful.
_MIN_CHORDS_FOR_VOLUME = 100


@dataclass
class MeshPrepOptions:
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


@dataclass
class SimulationMesh:
    vertices: np.ndarray            # (V, 3) welded, metres
    faces: np.ndarray               # (F, 3) final (simulated) winding
    normals: np.ndarray             # (F, 3) final normals, pointing away from the air
    areas: np.ndarray               # (F,)
    objects: list[str]              # object ids; faces index into this list
    face_object: np.ndarray         # (F,) object index (-1 = none)
    face_material: list[Any]        # (F,) material id / coeff dict
    face_scattering: np.ndarray     # (F,) scattering (nan = default)
    two_sided: np.ndarray           # (F,)
    flipped: np.ndarray             # (F,) winding reversed vs. the model
    face_class: np.ndarray          # (F,) FACE_CLASS_*
    air_hits: np.ndarray            # (F,) hits on the reflecting (air) side
    other_hits: np.ndarray          # (F,) hits on the other side
    component: np.ndarray           # (F,) welded component id
    component_closed: np.ndarray    # (C,)
    component_manifold: np.ndarray  # (C,)
    loops: list[BoundaryLoop]
    non_manifold_edges: np.ndarray  # (K, 2) vertex pairs
    walls: list[MergedWall]         # simulated walls (merged polygons / triangles)
    visibility: AirVisibility
    seeds: np.ndarray               # (S, 3) seed positions, in input order
    enclosing_objects: list[int]
    air_volume_m3: float
    air_volume_method: str
    stats: dict = field(default_factory=dict)


def _material_key(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


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
        stats: dict[str, Any] = {}
        verts_in = np.asarray(vertices, dtype=np.float64).reshape(-1, 3)
        tri = np.asarray(faces, dtype=np.int64).reshape(-1, 3)
        stats["input_vertices"], stats["input_faces"] = len(verts_in), len(tri)

        objects = list(object_face_ranges.keys())
        face_obj = np.full(len(tri), -1, dtype=np.int64)
        for i, rng_ in enumerate(object_face_ranges.values()):
            start, end = int(rng_[0]), int(rng_[1])
            face_obj[start:end + 1] = i

        # ── Drop faces with no material (identical in every pipeline) ───────
        assigned = np.array([i in face_materials for i in range(len(tri))], dtype=bool)
        unassigned_objs = sorted({objects[o] for o in face_obj[~assigned] if o >= 0})
        stats["dropped_unassigned_faces"] = int((~assigned).sum())
        stats["dropped_unassigned_objects"] = unassigned_objs
        origin = np.flatnonzero(assigned)
        tri = tri[assigned]

        # ── Weld, drop degenerate / sliver faces, dedupe ─────────────────────
        welded, inv = weld_vertices(verts_in, options.weld_tolerance_m)
        tri = inv[tri]
        ok = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
        stats["degenerate_faces"] = int((~ok).sum())
        tri, origin = tri[ok], origin[ok]
        _, areas = face_normals_and_areas(welded, tri)
        ok = areas >= SIM_MESH_MIN_TRIANGLE_AREA_M2
        stats["sliver_faces"] = int((~ok).sum())
        tri, origin = tri[ok], origin[ok]

        dd = dedupe_faces(tri)
        stats["duplicate_faces"], stats["coincident_opposite_faces"] = dd.n_same, dd.n_opposite
        tri, origin = tri[dd.kept], origin[dd.kept]

        used, tri = np.unique(tri, return_inverse=True)
        tri = tri.reshape(-1, 3)
        verts = welded[used]
        stats["welded_vertices"], stats["welded_faces"] = len(verts), len(tri)

        face_object = face_obj[origin]
        face_material = [face_materials[int(o)] for o in origin]
        face_scat = np.array(
            [(face_scattering or {}).get(int(o), np.nan) for o in origin], dtype=np.float64
        )

        # ── Topology ─────────────────────────────────────────────────────────
        table = build_edges(tri)
        n_comp, labels = connected_face_components(table)
        closed, manifold = component_closed(table, labels, n_comp)
        bfs_flip, orientable = orient_consistently(table, labels, n_comp)
        loops = boundary_loops(verts, table)
        normals, areas = face_normals_and_areas(verts, tri)

        # ── Air visibility walk ──────────────────────────────────────────────
        seed_arr = np.asarray(seeds, dtype=np.float64).reshape(-1, 3)
        tris = TriangleSet(verts, tri)
        rays = rays_for_budget(
            len(tri), len(seed_arr), SIM_MESH_WALK_BOUNCES, SIM_MESH_RAY_TEST_BUDGET,
            SIM_MESH_RAYS_PER_SEED_MIN, SIM_MESH_RAYS_PER_SEED_MAX, options.quality_factor,
        )
        vis = walk_from_seeds(
            tris, normals, seed_arr, rays, SIM_MESH_WALK_BOUNCES, SIM_MESH_RAY_EPSILON_M,
            np.random.default_rng(SIM_MESH_RAY_SEED),
            SIM_MESH_SEED_OUTSIDE_ESCAPE_FRACTION, SIM_MESH_SEED_LEAKY_ESCAPE_FRACTION,
            SIM_MESH_LEAK_RAYS_MAX,
        )

        # ── Orientation + two-sidedness ──────────────────────────────────────
        orient = decide_orientation(
            OrientationInputs(
                verts=verts, faces=tri, normals=normals, areas=areas,
                hits_normal=vis.hits_normal, hits_back=vis.hits_back,
                labels=labels, closed=closed, manifold=manifold, orientable=orientable,
                bfs_flip=bfs_flip, face_object=face_object,
            ),
            detect_two_sided=options.detect_two_sided,
            min_hits=SIM_MESH_TWO_SIDED_MIN_HITS,
            min_frac=SIM_MESH_TWO_SIDED_MIN_FRACTION,
            eps=SIM_MESH_RAY_EPSILON_M,
            enclosing_min_faces=SIM_MESH_ENCLOSING_OBJECT_MIN_FACES,
            enclosing_max_faces=SIM_MESH_ENCLOSING_OBJECT_MAX_FACES,
            enclosing_min_share=SIM_MESH_ENCLOSING_OBJECT_MIN_SHARE,
        )
        flip = orient.flip
        tri = np.where(flip[:, None], tri[:, ::-1], tri)
        normals = np.where(flip[:, None], -normals, normals)
        air_hits = np.where(flip, vis.hits_normal, vis.hits_back)
        other_hits = np.where(flip, vis.hits_back, vis.hits_normal)

        face_class = SimulationMeshService._classify(
            tris, tri, verts, normals, air_hits + other_hits, orient.two_sided
        )
        volume, method = SimulationMeshService._air_volume(
            vis, verts, tri, areas, air_hits, other_hits, labels, closed
        )

        # ── Coplanar merge into simulated walls ──────────────────────────────
        if options.merge_coplanar:
            key_index: dict[tuple, int] = {}
            keys = np.array([
                key_index.setdefault(
                    (_material_key(face_material[f]), float(np.nan_to_num(face_scat[f], nan=-1.0)),
                     bool(orient.two_sided[f]), int(face_object[f])),
                    len(key_index),
                )
                for f in range(len(tri))
            ], dtype=np.int64)
            walls = merge_coplanar(
                verts, tri, normals, areas, keys,
                options.coplanar_angle_deg, options.coplanar_distance_m,
            )
        else:
            walls = [MergedWall(verts[t].copy(), np.array([f])) for f, t in enumerate(tri)]

        stats.update({
            "components": int(n_comp),
            "closed_components": int(closed.sum()),
            "non_manifold_edges": int((table.counts > 2).sum()),
            "boundary_edges": int((table.counts == 1).sum()),
            "flipped_faces": int(flip.sum()),
            "two_sided_faces": int(orient.two_sided.sum()),
            "skipped_faces": int((face_class == FACE_CLASS_SKIPPED).sum()),
            "simulated_walls": len(walls),
            "rays_per_seed": int(rays),
            "leak_fraction": float(vis.leak_fraction),
        })
        return SimulationMesh(
            vertices=verts, faces=tri, normals=normals, areas=areas,
            objects=objects, face_object=face_object, face_material=face_material,
            face_scattering=face_scat, two_sided=orient.two_sided, flipped=flip,
            face_class=face_class, air_hits=air_hits, other_hits=other_hits,
            component=labels, component_closed=closed, component_manifold=manifold,
            loops=loops, non_manifold_edges=table.edges[table.counts > 2],
            walls=walls, visibility=vis, seeds=seed_arr,
            enclosing_objects=orient.enclosing_objects,
            air_volume_m3=volume, air_volume_method=method, stats=stats,
        )

    @staticmethod
    def _classify(tris_before: TriangleSet, tri, verts, normals, total_hits, two_sided) -> np.ndarray:
        """
        Shell vs interior.

        One-sided faces: probe from the face away from the air. Crossing the
        back of another air-facing face within the interior depth means the
        face bounds an object standing in the air (column, furniture);
        otherwise it bounds the exterior / solid mass (shell).

        Two-sided faces have air on both sides: probe both directions. If sound
        can leave the model from either side the surface is part of the outer
        shell (e.g. a single-sheet facade); otherwise it stands inside the
        room (panel, partition, ceiling cloud).
        """
        cls = np.full(len(tri), FACE_CLASS_SHELL, dtype=np.int8)
        seen = total_hits > 0
        cls[~seen] = FACE_CLASS_SKIPPED
        centroids = verts[tri].mean(axis=1)

        def probe(ids: np.ndarray, d: np.ndarray):
            t, g = first_hits(tris_before, centroids[ids] + SIM_MESH_RAY_EPSILON_M * d, d, tmin=0.0)
            return t, g

        one = np.flatnonzero(seen & ~two_sided)
        if len(one):
            d = normals[one]
            t, g = probe(one, d)
            hit = g >= 0
            g_safe = np.where(hit, g, 0)
            back_of_seen = hit & (total_hits[g_safe] > 0) & (np.einsum("ij,ij->i", d, normals[g_safe]) < 0)
            cls[one[back_of_seen & (t <= SIM_MESH_INTERIOR_OBJECT_MAX_DEPTH_M)]] = FACE_CLASS_INTERIOR

        two = np.flatnonzero(seen & two_sided)
        if len(two):
            _, g_plus = probe(two, normals[two])
            _, g_minus = probe(two, -normals[two])
            escapes = (g_plus < 0) | (g_minus < 0)
            cls[two[~escapes]] = FACE_CLASS_INTERIOR
        return cls

    @staticmethod
    def _air_volume(vis, verts, tri, areas, air_hits, other_hits, labels, closed) -> tuple[float, str]:
        """Air volume from the mean free path (V = l S / 4), else geometric fallbacks."""
        if vis.n_chords >= _MIN_CHORDS_FOR_VOLUME:
            surface = float(areas[air_hits > 0].sum() + areas[other_hits > 0].sum())
            if surface > 0:
                return vis.mean_free_path * surface / 4.0, "mean_free_path"
        if len(closed) and closed.any():
            biggest = max(np.flatnonzero(closed), key=lambda c: areas[labels == c].sum())
            vol = abs(signed_volume(verts, tri[labels == biggest]))
            if vol > 0:
                return vol, "divergence"
        if len(verts) == 0:
            return 0.0, "none"
        extents = verts.max(axis=0) - verts.min(axis=0)
        return float(np.prod(np.maximum(extents, 0.0))), "bounding_box"
