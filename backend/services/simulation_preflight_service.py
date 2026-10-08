# backend/services/simulation_preflight_service.py
# Turn a prepared SimulationMesh into user-facing preflight issues.
#
# Severities depend on the engine: pyroomacoustics tolerates open edges and
# thin surfaces (rays/ISM handle them, two-sided walls are supported), while
# Choras meshes a watertight air volume with gmsh, so any opening, non-manifold
# edge or zero-thickness surface is fatal there.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from config.constants import (
    PREFLIGHT_HOLE_LEAK_MATCH_DISTANCE_M,
    PREFLIGHT_ISM_PATHS_ERROR,
    PREFLIGHT_ISM_PATHS_WARNING,
    PREFLIGHT_LEAK_ERROR_FRACTION,
    PREFLIGHT_LEAK_WARNING_FRACTION,
    PREFLIGHT_MAX_ISSUE_FACE_IDS,
    PREFLIGHT_MAX_LISTED_ITEMS,
    PREFLIGHT_MODEL_DIAGONAL_MAX_M,
    PREFLIGHT_MODEL_DIAGONAL_MIN_M,
    PREFLIGHT_SURFACE_ERROR_DISTANCE_M,
    PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS,
    SIM_MESH_INTERIOR_OBJECT_MAX_DEPTH_M,
)
from models.schemas import PreflightIssue
from services.simulation_mesh_service import (
    FACE_CLASS_SKIPPED,
    FACE_CLASS_INTERIOR,
    SimulationMesh,
)
from utils.air_visibility import SEED_LEAKY, SEED_OUTSIDE
from utils.mesh_raycast import TriangleSet, point_triangle_distances, segment_crossings

ENGINE_PYROOMACOUSTICS = "pyroomacoustics"
ENGINE_CHORAS = "choras"


@dataclass
class SeedMeta:
    id: str
    kind: str        # "source" | "receiver"
    position: list[float]


@dataclass
class PreflightContext:
    engine: str
    seeds: list[SeedMeta]             # aligned with SimulationMesh.seeds
    pairs: list[tuple[str, str]]      # (source_id, receiver_id)
    max_order: int = 0
    ray_tracing: bool = False
    two_sided_supported: bool = True


@dataclass
class PreflightAnalysis:
    issues: list[PreflightIssue]
    enclosure: list[int]                       # enclosure id per seed
    loop_leaking: list[bool]                   # per boundary loop
    blocked_paths: list[dict] = field(default_factory=list)
    seed_surface_distance: list[float] = field(default_factory=list)
    ism_paths_estimate: float = 0.0


class _Issues:
    def __init__(self):
        self.items: list[PreflightIssue] = []

    def add(self, severity: str, code: str, title: str, detail: str, **kw) -> None:
        if "face_ids" in kw:
            kw["face_ids"] = list(kw["face_ids"])[:PREFLIGHT_MAX_ISSUE_FACE_IDS]
        if "object_ids" in kw:
            kw["object_ids"] = list(kw["object_ids"])[:PREFLIGHT_MAX_LISTED_ITEMS]
        self.items.append(PreflightIssue(
            id=f"{code}:{len(self.items)}", severity=severity, code=code,
            title=title, detail=detail, **kw,
        ))


def _enclosures(mesh: SimulationMesh) -> list[int]:
    """Seeds reaching a common (face, side) share the same air volume."""
    sides = [set(s.seen_sides.tolist()) for s in mesh.visibility.seeds]
    parent = list(range(len(sides)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(sides)):
        for j in range(i + 1, len(sides)):
            if sides[i] & sides[j]:
                parent[find(i)] = find(j)
    roots = {r: k for k, r in enumerate(sorted({find(i) for i in range(len(sides))}))}
    return [roots[find(i)] for i in range(len(sides))]


def _object_list(mesh: SimulationMesh, face_ids) -> list[str]:
    objs = sorted({mesh.objects[o] for o in mesh.face_object[np.asarray(face_ids, dtype=np.int64)] if o >= 0})
    return objs[:PREFLIGHT_MAX_LISTED_ITEMS]


def _label(seed: SeedMeta) -> str:
    return f"{seed.kind.capitalize()} '{seed.id}'"


class SimulationPreflightService:
    """Geometry checks shared by the preflight job and the simulation logs."""

    @staticmethod
    def analyze(mesh: SimulationMesh, ctx: PreflightContext) -> PreflightAnalysis:
        out = _Issues()
        choras = ctx.engine == ENGINE_CHORAS
        tris = TriangleSet(mesh.vertices, mesh.faces)
        vis = mesh.visibility
        enclosure = _enclosures(mesh)
        seed_index = {s.id: i for i, s in enumerate(ctx.seeds)}

        # ── Sources / receivers ──────────────────────────────────────────────
        dists: list[float] = []
        for i, (meta, sv) in enumerate(zip(ctx.seeds, vis.seeds)):
            d = float(point_triangle_distances(tris, sv.position).min()) if len(tris) else float("inf")
            dists.append(d)
            pos = [float(x) for x in sv.position]
            if sv.status == SEED_OUTSIDE:
                out.add("error", "seed_outside", f"{_label(meta)} is outside the model",
                        f"{sv.escape_fraction:.0%} of its rays escape without hitting a surface. "
                        "It has no enclosing room, so it will not be simulated correctly "
                        "(outer walls never block it). Move it inside the room.", position=pos)
                continue
            if sv.status == SEED_LEAKY:
                out.add("warning", "seed_leaky", f"{_label(meta)} sees an opening",
                        f"{sv.escape_fraction:.0%} of its direct rays leave the model. "
                        "The room is open in its line of sight (missing wall, ceiling or material).",
                        position=pos)
            alone = all(enclosure[j] != enclosure[i] for j in range(len(ctx.seeds)) if j != i)
            if alone and len(ctx.seeds) > 1 and sv.mean_primary_hit_m < SIM_MESH_INTERIOR_OBJECT_MAX_DEPTH_M:
                out.add("error", "seed_inside_object", f"{_label(meta)} is inside an object",
                        f"It is enclosed by surfaces {sv.mean_primary_hit_m:.2f} m away on average "
                        "and shares no air with the other sources/receivers.", position=pos,
                        object_ids=_object_list(mesh, sv.seen_faces))
            if d < PREFLIGHT_SURFACE_ERROR_DISTANCE_M:
                out.add("error", "seed_on_surface", f"{_label(meta)} touches a surface",
                        f"It is {d * 100:.1f} cm from a surface. Move it at least "
                        f"{PREFLIGHT_SURFACE_ERROR_DISTANCE_M * 100:.0f} cm away.", position=pos)
            elif (ctx.engine == ENGINE_PYROOMACOUSTICS and ctx.ray_tracing and meta.kind == "receiver"
                  and d < PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS):
                out.add("warning", "receiver_near_surface", f"{_label(meta)} is close to a surface",
                        f"It is {d:.2f} m from a surface, inside the {PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS} m "
                        "ray-tracing receiver sphere. The late reverberation may be mis-estimated.",
                        position=pos)

        # ── Source → receiver paths ──────────────────────────────────────────
        blocked: list[dict] = []
        margin = PREFLIGHT_SURFACE_ERROR_DISTANCE_M
        for src_id, rcv_id in ctx.pairs:
            si, ri = seed_index.get(src_id), seed_index.get(rcv_id)
            if si is None or ri is None:
                continue
            a, b = ctx.seeds[si].position, ctx.seeds[ri].position
            crossing = segment_crossings(tris, a, b, margin)
            separated = enclosure[si] != enclosure[ri]
            if len(crossing) == 0 and not separated:
                continue
            seg = [[float(x) for x in a], [float(x) for x in b]]
            blocked.append({"source_id": src_id, "receiver_id": rcv_id, "segment": seg,
                            "face_ids": crossing.tolist(), "separated": separated})
            objs = _object_list(mesh, crossing)
            if separated:
                out.add("error", "no_acoustic_path", f"No sound path from '{src_id}' to '{rcv_id}'",
                        "They are in separate closed volumes. Transmission through walls is not "
                        "simulated, so the impulse response will be empty.",
                        segment=seg, face_ids=crossing.tolist(), object_ids=objs)
            else:
                out.add("warning", "direct_path_blocked", f"Direct sound blocked: '{src_id}' → '{rcv_id}'",
                        f"{len(objs)} object(s) stand between them. Transmission and diffraction are not "
                        "simulated, so only reflections around the obstacle reach the receiver.",
                        segment=seg, face_ids=crossing.tolist(), object_ids=objs)

        # ── Leaks and holes ──────────────────────────────────────────────────
        loop_leaking = SimulationPreflightService._attribute_leaks(mesh)
        leak = vis.leak_fraction
        if leak > 0 and (choras or leak >= PREFLIGHT_LEAK_WARNING_FRACTION):
            severity = "error" if choras or leak >= PREFLIGHT_LEAK_ERROR_FRACTION else "warning"
            out.add(severity, "sound_leak", f"{leak:.1%} of reflected sound escapes the model",
                    "Rays leave through openings: the reverberation will be too short. "
                    "Close the room or assign materials to the missing surfaces.")
        for k, (loop, leaking) in enumerate(zip(mesh.loops, loop_leaking)):
            if leaking:
                out.add("error", "leaking_hole", f"Hole leaks sound ({loop.extent:.2f} m)",
                        f"An opening with a {loop.length:.2f} m perimeter lets sound escape.",
                        position=[float(x) for x in loop.centroid], loop_ids=[k])
        silent = [k for k, l in enumerate(loop_leaking) if not l]
        if silent:
            out.add("error" if choras else "info", "open_edges", f"{len(silent)} open edge loop(s)",
                    ("gmsh needs a watertight volume: every edge must be shared by two faces "
                     "(weld vertices, avoid T-junctions)." if choras else
                     "Edges used by a single face. No sound escapes through them (seams, panel edges)."),
                    loop_ids=silent)

        # ── Topology / auto-fixes ────────────────────────────────────────────
        st = mesh.stats
        if st["non_manifold_edges"]:
            out.add("error" if choras else "info", "non_manifold", f"{st['non_manifold_edges']} non-manifold edge(s)",
                    "Edges shared by three or more faces (T-junctions, touching solids). "
                    + ("Not supported by gmsh." if choras else "Kept as is: no geometry is removed."))
        n2 = int(mesh.two_sided.sum())
        if n2:
            ids = np.flatnonzero(mesh.two_sided).tolist()
            if choras:
                out.add("error", "two_sided_surfaces", f"{n2} zero-thickness surface(s) in the air",
                        "Choras meshes a closed volume and cannot model thin free-standing surfaces. "
                        "Give them a thickness or remove them.", face_ids=ids, object_ids=_object_list(mesh, ids))
            elif not ctx.two_sided_supported:
                out.add("error", "two_sided_unsupported", "pyroomacoustics build lacks two-sided walls",
                        f"{n2} surface(s) need to reflect on both sides. Rebuild the local pyroomacoustics "
                        "fork (python setup.py build_ext --inplace).", face_ids=ids)
            else:
                out.add("info", "two_sided_surfaces", f"Auto-fixed: {n2} face(s) made double-sided",
                        "Thin surfaces with air on both sides reflect sound on both faces.",
                        face_ids=ids, object_ids=_object_list(mesh, ids))
        if st["flipped_faces"]:
            ids = np.flatnonzero(mesh.flipped).tolist()
            out.add("info", "flipped_faces", f"Auto-fixed: {st['flipped_faces']} face(s) flipped",
                    "Their winding pointed into the air; the reflecting side now faces the room.",
                    face_ids=ids, object_ids=_object_list(mesh, ids))
        skipped = np.flatnonzero(mesh.face_class == FACE_CLASS_SKIPPED).tolist()
        if skipped:
            out.add("info", "skipped_faces", f"{len(skipped)} skipped face(s)",
                    "Never reached by sound (inside solids or behind the shell). They are kept "
                    "but do not affect the result.",
                    face_ids=skipped)
        for obj in mesh.enclosing_objects:
            out.add("info", "closed_not_welded", f"'{mesh.objects[obj]}' is closed but not welded",
                    "Its faces do not share vertices. It was treated as a closed solid; raise the "
                    "weld tolerance if the gaps are modelling noise.", object_ids=[mesh.objects[obj]])
        if choras:
            interior = np.flatnonzero(mesh.face_class == FACE_CLASS_INTERIOR).tolist()
            if interior:
                out.add("warning", "interior_objects", f"{len(_object_list(mesh, interior))} object(s) inside the room",
                        "They become extra cavities in the gmsh volume and increase meshing time.",
                        face_ids=interior, object_ids=_object_list(mesh, interior))

        # ── Materials, cost, units ───────────────────────────────────────────
        if st["dropped_unassigned_objects"]:
            objs = st["dropped_unassigned_objects"]
            out.add("warning", "unassigned_material", f"{len(objs)} object(s) without material are excluded",
                    "Objects with no material are not part of the simulation. If they close the room, "
                    "sound will leak through the gap.", object_ids=objs[:PREFLIGHT_MAX_LISTED_ITEMS])
        ism = 0.0
        if ctx.engine == ENGINE_PYROOMACOUSTICS and ctx.max_order > 0:
            n_walls = len(mesh.walls) + n2
            ism = float((max(n_walls, 2) / 2.0) ** ctx.max_order)
            if ism >= PREFLIGHT_ISM_PATHS_WARNING:
                out.add("error" if ism >= PREFLIGHT_ISM_PATHS_ERROR else "warning", "ism_cost",
                        f"Image-source search is very large (~{ism:.1e} paths)",
                        f"{n_walls} walls at order {ctx.max_order}. Enable coplanar merging, simplify the "
                        "model or lower the max order (ray tracing covers the late tail).")
        if len(mesh.vertices):
            diag = float(np.linalg.norm(mesh.vertices.max(axis=0) - mesh.vertices.min(axis=0)))
            if not (PREFLIGHT_MODEL_DIAGONAL_MIN_M <= diag <= PREFLIGHT_MODEL_DIAGONAL_MAX_M):
                out.add("warning", "model_units", f"Unusual model size ({diag:.2f} m)",
                        "Check that the model is in metres.")

        return PreflightAnalysis(
            issues=out.items, enclosure=enclosure, loop_leaking=loop_leaking,
            blocked_paths=blocked, seed_surface_distance=dists, ism_paths_estimate=ism,
        )

    @staticmethod
    def _attribute_leaks(mesh: SimulationMesh) -> list[bool]:
        """A loop leaks when an escaping ray crosses its plane within its extent."""
        vis = mesh.visibility
        flags = [False] * len(mesh.loops)
        if len(vis.leak_origins) == 0:
            return flags
        for k, loop in enumerate(mesh.loops):
            pts = mesh.vertices[loop.vertex_ids]
            if len(pts) < 3:
                continue
            c = loop.centroid
            n = np.linalg.svd(pts - c)[2][-1]
            denom = vis.leak_dirs @ n
            ok = np.abs(denom) > 1e-9
            t = np.where(ok, ((c - vis.leak_origins) @ n) / np.where(ok, denom, 1.0), -1.0)
            p = vis.leak_origins + t[:, None] * vis.leak_dirs
            near = ok & (t > 0) & (
                np.linalg.norm(p - c, axis=1) <= loop.extent / 2.0 + PREFLIGHT_HOLE_LEAK_MATCH_DISTANCE_M
            )
            flags[k] = bool(near.any())
        return flags


def two_sided_supported() -> bool:
    """True when the installed pyroomacoustics exposes ``Wall.two_sided``."""
    try:
        import pyroomacoustics as pra
        return hasattr(pra.libroom.Wall, "two_sided")
    except Exception:  # pragma: no cover - pra always present in the CPU worker
        return False


def summarize(issues: list[PreflightIssue]) -> dict[str, int]:
    return {
        "n_errors": sum(i.severity == "error" for i in issues),
        "n_warnings": sum(i.severity == "warning" for i in issues),
        "n_infos": sum(i.severity == "info" for i in issues),
    }


def issue_codes(issues: list[PreflightIssue], severity: Optional[str] = None) -> list[str]:
    return [i.code for i in issues if severity is None or i.severity == severity]
