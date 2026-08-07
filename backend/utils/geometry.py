# backend/utils/geometry.py
# Stateless geometry helpers for the acoustic simulation pipeline.

import numpy as np


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
