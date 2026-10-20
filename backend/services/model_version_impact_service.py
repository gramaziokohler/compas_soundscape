# backend/services/model_version_impact_service.py
# What changed between two versions of a Speckle model, and what it impacts.
#
# Objects are matched across versions by their stable key (applicationId, else
# the raw Speckle hash). An identical hash is unchanged; otherwise the object's
# centroid, axis-aligned extents, surface area and (for planar objects) dominant
# normal are compared against user tolerances, so re-exports and float noise
# never count as a change. The result is scoped to the acoustic region and also
# checks where listeners / free sounds now sit relative to the new geometry.

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from config.constants import (
    MODEL_VERSION_ENCLOSED_RAY_SHARE,
    MODEL_VERSION_PLACEMENT_OUTSIDE_FRACTION,
    MODEL_VERSION_PLACEMENT_RAYS,
    MODEL_VERSION_PLACEMENT_SEED,
    MODEL_VERSION_PLANAR_EIGEN_SHARE,
    MODEL_VERSION_SOLID_MAX_THICKNESS_M,
    MODEL_VERSION_STATS_CACHE_SIZE,
)
from utils.mesh_raycast import TriangleSet, first_hits, ray_triangle_t, uniform_sphere_directions
from utils.geometry import canonical_object_id

logger = logging.getLogger(__name__)

STATUS_CHANGED = "changed"
STATUS_ADDED = "added"
STATUS_REMOVED = "removed"
STATUS_BELOW_TOLERANCE = "below_tolerance"

PLACEMENT_OUTSIDE = "outside"
PLACEMENT_INSIDE_OBJECT = "inside_object"


@dataclass
class ObjectStats:
    key: str
    name: str
    layer: Optional[str]
    app_id: Optional[str]
    raw_ids: set = field(default_factory=set)
    aliases: set = field(default_factory=set)
    face_indices: List[int] = field(default_factory=list)
    area: float = 0.0
    centroid: np.ndarray = field(default_factory=lambda: np.zeros(3))
    bbox_min: np.ndarray = field(default_factory=lambda: np.full(3, np.inf))
    bbox_max: np.ndarray = field(default_factory=lambda: np.full(3, -np.inf))
    principal_normal: Optional[np.ndarray] = None

    @property
    def extents(self) -> np.ndarray:
        return np.maximum(self.bbox_max - self.bbox_min, 0.0)


@dataclass
class VersionStats:
    vertices: np.ndarray
    faces: np.ndarray
    objects: Dict[str, ObjectStats]


@dataclass
class Tolerance:
    distance_m: float
    angle_deg: float
    area_ratio: float


@dataclass
class Region:
    whole_model: bool
    ids: set
    layers: List[str]

    def contains(self, obj: ObjectStats) -> bool:
        if self.whole_model:
            return True
        if obj.aliases & self.ids:
            return True
        layer = obj.layer or ""
        segments = layer.split("::") if layer else []
        return any(
            layer == name or layer.startswith(f"{name}::") or name in segments
            for name in self.layers
        )


def _accumulate(obj: ObjectStats, verts: np.ndarray, faces: np.ndarray) -> None:
    """Area, area-weighted centroid, bounds and normal tensor of an object's faces."""
    if len(faces) == 0:
        return
    tri = verts[faces]  # (F, 3, 3)
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    doubled = np.linalg.norm(cross, axis=1)
    area = float(doubled.sum() / 2.0)
    centroids = tri.mean(axis=1)
    if area > 0:
        obj.centroid = (centroids * doubled[:, None]).sum(axis=0) / doubled.sum()
    else:
        obj.centroid = centroids.mean(axis=0)
    obj.area = area
    pts = tri.reshape(-1, 3)
    obj.bbox_min = pts.min(axis=0)
    obj.bbox_max = pts.max(axis=0)

    # Area-weighted normal tensor: its dominant eigenvector is the plane normal of
    # a planar object (wall, slab, panel). Sign-free, so face winding is irrelevant.
    ok = doubled > 0
    if ok.any():
        n = cross[ok] / doubled[ok, None]
        tensor = (n[:, :, None] * n[:, None, :] * doubled[ok, None, None]).sum(axis=0)
        values, vectors = np.linalg.eigh(tensor)
        if values.sum() > 0 and values[-1] / values.sum() >= MODEL_VERSION_PLANAR_EIGEN_SHARE:
            obj.principal_normal = vectors[:, -1]


def _angle_deg(a: np.ndarray, b: np.ndarray) -> float:
    cos = abs(float(np.dot(a, b)) / (np.linalg.norm(a) * np.linalg.norm(b) or 1.0))
    return float(np.degrees(np.arccos(min(1.0, cos))))


class ModelVersionImpactService:
    """Compares two model versions; caches per-version object statistics."""

    def __init__(self, speckle_service):
        self._speckle = speckle_service
        self._cache: "OrderedDict[str, VersionStats]" = OrderedDict()
        self._lock = threading.Lock()

    # ── Per-version statistics ────────────────────────────────────────────────

    def _version_stats(self, project_id: str, version_id: str) -> Optional[VersionStats]:
        cache_key = f"{project_id}:{version_id}"
        with self._lock:
            if cache_key in self._cache:
                self._cache.move_to_end(cache_key)
                return self._cache[cache_key]

        geometry = self._speckle.get_model_geometry(project_id, version_id)
        if not geometry:
            return None

        verts = np.asarray(geometry.get("vertices") or [], dtype=np.float64).reshape(-1, 3)
        faces = np.asarray(geometry.get("faces") or [], dtype=np.int64).reshape(-1, 3)
        ranges = geometry.get("object_face_ranges") or {}
        layers = geometry.get("object_layers") or {}
        names = geometry.get("object_names") or []
        app_ids = geometry.get("object_application_ids") or []

        objects: Dict[str, ObjectStats] = {}
        for i, raw_id in enumerate(geometry.get("object_ids") or []):
            app_id = app_ids[i] if i < len(app_ids) else None
            key = app_id or raw_id
            face_range = ranges.get(raw_id)
            if not face_range:
                continue
            obj = objects.get(key)
            if obj is None:
                obj = ObjectStats(
                    key=key,
                    name=names[i] if i < len(names) else key,
                    layer=layers.get(raw_id),
                    app_id=app_id,
                )
                objects[key] = obj
            obj.raw_ids.add(raw_id)
            obj.aliases.update({raw_id, canonical_object_id(raw_id)})
            if app_id:
                obj.aliases.update({app_id, canonical_object_id(app_id)})
            obj.face_indices.extend(range(face_range[0], face_range[1] + 1))

        for obj in objects.values():
            _accumulate(obj, verts, faces[obj.face_indices])

        stats = VersionStats(vertices=verts, faces=faces, objects=objects)
        with self._lock:
            self._cache[cache_key] = stats
            while len(self._cache) > MODEL_VERSION_STATS_CACHE_SIZE:
                self._cache.popitem(last=False)
        return stats

    # ── Diff ──────────────────────────────────────────────────────────────────

    @staticmethod
    def _compare(old: ObjectStats, new: ObjectStats, tol: Tolerance) -> Dict:
        moved = float(np.linalg.norm(new.centroid - old.centroid))
        extent_change = float(np.abs(new.extents - old.extents).max())
        area_change = abs(new.area / old.area - 1.0) if old.area > 0 else (1.0 if new.area > 0 else 0.0)
        rotation = (
            _angle_deg(old.principal_normal, new.principal_normal)
            if old.principal_normal is not None and new.principal_normal is not None
            else 0.0
        )
        over = (
            moved > tol.distance_m
            or extent_change > tol.distance_m
            or area_change > tol.area_ratio
            or rotation > tol.angle_deg
        )
        if area_change > tol.area_ratio:
            ratios = new.extents / np.where(old.extents > 0, old.extents, np.nan)
            ratios = ratios[np.isfinite(ratios)]
            uniform = len(ratios) > 0 and float(ratios.max() - ratios.min()) <= tol.area_ratio
            kind = "scaled" if uniform else "reshaped"
        elif rotation > tol.angle_deg or extent_change > tol.distance_m:
            kind = "rotated"
        else:
            kind = "moved"
        return {
            "over_tolerance": over,
            "kind": kind,
            "moved_m": moved,
            "extent_change_m": extent_change,
            "area_change_ratio": area_change,
            "scale": float(np.sqrt(new.area / old.area)) if old.area > 0 else None,
            "rotation_deg": rotation,
        }

    @staticmethod
    def _object_entry(obj: ObjectStats, status: str, in_region: bool, change: Optional[Dict]) -> Dict:
        return {
            "key": obj.key,
            "name": obj.name,
            "layer": obj.layer,
            "application_id": obj.app_id,
            "raw_ids": sorted(obj.raw_ids),
            "status": status,
            "in_region": in_region,
            "change": change,
        }

    @staticmethod
    def _region_totals(objects: List[ObjectStats]) -> Dict:
        if not objects:
            return {"object_count": 0, "area_m2": 0.0, "bounding_volume_m3": 0.0}
        lo = np.min([o.bbox_min for o in objects], axis=0)
        hi = np.max([o.bbox_max for o in objects], axis=0)
        return {
            "object_count": len(objects),
            "area_m2": float(sum(o.area for o in objects)),
            "bounding_volume_m3": float(np.prod(np.maximum(hi - lo, 0.0))),
        }

    # ── Placement checks ──────────────────────────────────────────────────────

    @staticmethod
    def _placements(stats: VersionStats, region_objects: List[ObjectStats], points: List[Dict]) -> List[Dict]:
        if not points or not region_objects:
            return []
        face_idx = np.asarray(sorted({f for o in region_objects for f in o.face_indices}), dtype=np.int64)
        if len(face_idx) == 0:
            return []
        tris = TriangleSet(stats.vertices, stats.faces[face_idx])
        rng = np.random.default_rng(MODEL_VERSION_PLACEMENT_SEED)
        dirs = uniform_sphere_directions(MODEL_VERSION_PLACEMENT_RAYS, rng)
        solids = [o for o in region_objects if float(o.extents.min()) <= MODEL_VERSION_SOLID_MAX_THICKNESS_M]

        results: List[Dict] = []
        for point in points:
            p = np.asarray(point.get("position") or [], dtype=np.float64)
            if p.shape != (3,):
                continue
            # Inside a thin solid (wall / slab / column): ray-parity against that object only.
            enclosing = None
            for obj in solids:
                if np.any(p < obj.bbox_min) or np.any(p > obj.bbox_max):
                    continue
                obj_tris = TriangleSet(stats.vertices, stats.faces[obj.face_indices])
                t = ray_triangle_t(obj_tris, np.repeat(p[None, :], len(dirs), axis=0), dirs)
                crossings = (np.isfinite(t) & (t > 0)).sum(axis=1)
                if float((crossings % 2 == 1).mean()) >= MODEL_VERSION_ENCLOSED_RAY_SHARE:
                    enclosing = obj
                    break
            if enclosing is not None:
                results.append({
                    "id": point.get("id"),
                    "status": PLACEMENT_INSIDE_OBJECT,
                    "object_name": enclosing.name,
                    "object_key": enclosing.key,
                })
                continue
            # Outside the room: most rays escape the acoustic region.
            _, hit_face = first_hits(tris, np.repeat(p[None, :], len(dirs), axis=0), dirs, tmin=0.0)
            if float((hit_face < 0).mean()) >= MODEL_VERSION_PLACEMENT_OUTSIDE_FRACTION:
                results.append({"id": point.get("id"), "status": PLACEMENT_OUTSIDE})
        return results

    # ── Public API ────────────────────────────────────────────────────────────

    def compute_impact(
        self,
        project_id: str,
        from_version_id: str,
        to_version_id: str,
        tolerance: Tolerance,
        region: Region,
        points: List[Dict],
    ) -> Optional[Dict]:
        """
        Changes ``from → to`` with their impact. Returns ``None`` when either
        version's geometry cannot be read.
        """
        old = self._version_stats(project_id, from_version_id)
        new = self._version_stats(project_id, to_version_id)
        if old is None or new is None:
            return None

        entries: List[Dict] = []
        counts = {s: 0 for s in (STATUS_CHANGED, STATUS_ADDED, STATUS_REMOVED, STATUS_BELOW_TOLERANCE)}
        region_counts = dict(counts)

        def record(obj: ObjectStats, status: str, in_region: bool, change: Optional[Dict]) -> None:
            counts[status] += 1
            if in_region:
                region_counts[status] += 1
            entries.append(self._object_entry(obj, status, in_region, change))

        for key, new_obj in new.objects.items():
            old_obj = old.objects.get(key)
            in_region = region.contains(new_obj)
            if old_obj is None:
                record(new_obj, STATUS_ADDED, in_region, None)
                continue
            if old_obj.raw_ids == new_obj.raw_ids:
                continue  # identical content hash → unchanged
            change = self._compare(old_obj, new_obj, tolerance)
            status = STATUS_CHANGED if change["over_tolerance"] else STATUS_BELOW_TOLERANCE
            record(new_obj, status, in_region or region.contains(old_obj), change)
        for key, old_obj in old.objects.items():
            if key not in new.objects:
                record(old_obj, STATUS_REMOVED, region.contains(old_obj), None)

        old_region = [o for o in old.objects.values() if region.contains(o)]
        new_region = [o for o in new.objects.values() if region.contains(o)]

        return {
            "from_version_id": from_version_id,
            "to_version_id": to_version_id,
            "tolerance": {
                "distance_m": tolerance.distance_m,
                "angle_deg": tolerance.angle_deg,
                "area_ratio": tolerance.area_ratio,
            },
            "counts": counts,
            "region_counts": region_counts,
            "objects": entries,
            "region": {
                "before": self._region_totals(old_region),
                "after": self._region_totals(new_region),
            },
            "placements": self._placements(new, new_region, points),
        }
