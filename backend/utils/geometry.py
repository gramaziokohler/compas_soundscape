# backend/utils/geometry.py
# Stateless geometry helpers for the acoustic simulation pipeline.

import numpy as np

from typing import Iterable, Optional


def canonical_object_id(obj_id) -> str:
    """
    Normalize a Speckle object id for cross-layer matching.

    Speckle's viewer WorldTree appends a ``#<n>`` suffix to disambiguate objects
    whose ``applicationId`` is duplicated within a model, so the frontend stores
    material/scattering assignments keyed by e.g. ``<hash>#3`` while the objects
    the backend receives carry the bare ``<hash>``/GUID. Stripping the suffix
    lets an assignment keyed by the viewer id resolve to the geometry object.

    Args:
        obj_id: Any object identifier (str, None, ...).

    Returns:
        The identifier without its ``#<n>`` suffix, stripped, or "" if empty.
    """
    if obj_id is None:
        return ""
    return str(obj_id).strip().split("#", 1)[0]


def resolve_object_id(obj_id, available_ids: Iterable[str]) -> Optional[str]:
    """
    Resolve a (possibly suffixed) object id to a key present in ``available_ids``.

    Tries, in order: exact match, base (``#`` stripped) match, then a
    case-insensitive base match. Returns the matching key from ``available_ids``
    or None when nothing matches.
    """
    if obj_id is None:
        return None
    if obj_id in available_ids:
        return obj_id
    base = canonical_object_id(obj_id)
    if not base:
        return None
    if base in available_ids:
        return base
    low = base.lower()
    for key in available_ids:
        if canonical_object_id(key).lower() == low:
            return key
    return None



def fix_outward_winding(vertices: list, faces: list) -> list:
    """
    Ensure every face's vertex order produces an outward-pointing normal.

    pyroomacoustics wall normals are derived from face corner ordering, so
    inconsistent winding produces inverted reflection planes.  This flips each
    face whose normal points toward the room interior (toward the mesh
    centroid), assuming a roughly convex room volume.

    Args:
        vertices: List of [x, y, z] coordinates (metres).
        faces: List of face vertex index lists, mutated in place.

    Returns:
        The same ``faces`` list, with reversed vertex order where needed.
    """
    if not faces:
        return faces

    verts = np.asarray(vertices, dtype=np.float64)
    if verts.ndim != 2 or verts.shape[0] == 0:
        return faces

    centroid = verts.mean(axis=0)
    n_flipped = 0

    for face in faces:
        if len(face) < 3:
            continue
        pts = verts[face]
        normal = np.cross(pts[1] - pts[0], pts[2] - pts[0])
        to_center = centroid - pts.mean(axis=0)
        if np.dot(normal, to_center) > 0:
            face.reverse()
            n_flipped += 1

    if n_flipped:
        print(f"Winding fix: flipped {n_flipped} face(s) to outward normals")
    return faces
