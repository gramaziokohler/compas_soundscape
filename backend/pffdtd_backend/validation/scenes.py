"""Scene builders (PFFDTD model-JSON dicts) for the validation suite."""

from __future__ import annotations

from typing import Optional

import numpy as np

RIGID = "_RIGID"

# unit-cube corners and inward-facing triangles (front side = interior)
_CUBE_PTS = np.array(
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], dtype=np.float64
)
# face name -> two triangles, wound so (v1-v0)x(v2-v0) points into the box
_CUBE_FACES = {
    "x0": [[0, 3, 7], [0, 7, 4]],
    "x1": [[1, 5, 6], [1, 6, 2]],
    "y0": [[0, 4, 5], [0, 5, 1]],
    "y1": [[3, 2, 6], [3, 6, 7]],
    "z0": [[0, 1, 2], [0, 2, 3]],
    "z1": [[4, 7, 6], [4, 6, 5]],
}


def rotation_az_el(az_deg: float, el_deg: float) -> np.ndarray:
    """Rotation matrix: elevation about y, then azimuth about z (column-vector convention)."""
    az, el = np.deg2rad(az_deg), np.deg2rad(el_deg)
    Rz = np.array([[np.cos(az), -np.sin(az), 0], [np.sin(az), np.cos(az), 0], [0, 0, 1]])
    Ry = np.array([[np.cos(el), 0, -np.sin(el)], [0, 1, 0], [np.sin(el), 0, np.cos(el)]])
    return Rz @ Ry


def box_scene(
    dims,
    sources,
    receivers,
    face_materials: Optional[dict] = None,
    rotation: Optional[np.ndarray] = None,
    origin=(0.0, 0.0, 0.0),
) -> dict:
    """Shoebox [origin, origin+dims] as a PFFDTD scene dict.

    face_materials maps face names (x0, x1, y0, y1, z0, z1) to material names; missing
    faces are rigid. rotation (3x3) is applied about the box centre to the geometry and to
    sources/receivers alike.
    """
    dims = np.asarray(dims, np.float64)
    origin = np.asarray(origin, np.float64)
    pts = origin + _CUBE_PTS * dims
    centre = origin + dims / 2
    R = np.eye(3) if rotation is None else np.asarray(rotation, np.float64)

    def _xf(p):
        return ((np.atleast_2d(p) - centre) @ R.T + centre).tolist()

    face_materials = face_materials or {}
    mats: dict = {}
    for face, tris in _CUBE_FACES.items():
        mat = face_materials.get(face, RIGID)
        entry = mats.setdefault(mat, {"pts": [], "tris": [], "sides": [], "color": [128, 128, 128]})
        for tri in tris:
            base = len(entry["pts"])
            entry["pts"].extend(_xf(pts[tri]))
            entry["tris"].append([base, base + 1, base + 2])
            entry["sides"].append(0 if mat == RIGID else 2)
    return {
        "mats_hash": mats,
        "sources": [{"xyz": p} for p in _xf(sources)],
        "receivers": [{"xyz": p} for p in _xf(receivers)],
    }
