"""Scene geometry: OBJ with per-face material labels -> the worker's direct-geometry dict.

Faces are assigned a material through their OBJ label (``usemtl`` or group name) matched against
the scene's material patterns. A hemi-anechoic floor (``GroundPlane``) is added as one rectangle
spanning the padded domain; the empty-domain control run keeps it and replaces the objects by two
tiny corner markers (same bbox, so the same grid).
"""
from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path

import numpy as np

from benchmarks.bras.bras_constants import CONTROL_MARKER_EDGE_M, GROUND_INSET_CELLS, MATERIAL_MODES
from benchmarks.bras.scenes import RIGID, GeometryInput, MaterialInput, Scene

BBOX_TOL_M = 1e-3
DEFAULT_PATTERN = "*"
CONSTANT_ALPHA_BANDS_HZ = [125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0]
LABEL_KEYS = ("usemtl", "group")


@dataclass
class SceneMesh:
    vertices: np.ndarray       # (V, 3) metres, Z up (SOFA frame)
    faces: np.ndarray          # (F, 3)
    labels: list               # OBJ label per face (as read)
    materials: list            # scene material key per face
    bmin: np.ndarray           # object bbox (no ground)
    bmax: np.ndarray


def read_obj(path: Path | str) -> tuple[np.ndarray, np.ndarray, dict]:
    """Vertices, fan-triangulated faces and per-face labels ``{"usemtl": [...], "group": [...]}``."""
    verts: list[list[float]] = []
    faces: list[list[int]] = []
    tags: dict[str, list[str]] = {k: [] for k in LABEL_KEYS}
    current = {"usemtl": "", "group": ""}
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            parts = raw.split()
            if not parts:
                continue
            head = parts[0]
            if head == "v":
                verts.append([float(x) for x in parts[1:4]])
            elif head == "usemtl":
                current["usemtl"] = " ".join(parts[1:])
            elif head in ("g", "o"):
                current["group"] = " ".join(parts[1:])
            elif head == "f":
                idx = [int(tok.split("/")[0]) for tok in parts[1:]]
                idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
                for k in range(1, len(idx) - 1):
                    faces.append([idx[0], idx[k], idx[k + 1]])
                    for key in LABEL_KEYS:
                        tags[key].append(current[key])
    return np.asarray(verts, np.float64), np.asarray(faces, np.int64).reshape(-1, 3), tags


def to_zup(vertices: np.ndarray, up_axis: str) -> np.ndarray:
    v = np.asarray(vertices, np.float64)
    if up_axis == "z":
        return v.copy()
    if up_axis == "y":  # +90 deg about x: (x, y, z)_obj -> (x, -z, y)
        return np.column_stack([v[:, 0], -v[:, 2], v[:, 1]])
    raise ValueError(f"up_axis must be 'y' or 'z', not {up_axis!r}")


def ordered_patterns(patterns) -> list[str]:
    """Scene material patterns, the catch-all ``*`` last."""
    pats = list(patterns)
    return [p for p in pats if p != DEFAULT_PATTERN] + ([DEFAULT_PATTERN] if DEFAULT_PATTERN in pats else [])


def resolve_material(label: str, patterns) -> str | None:
    for pat in ordered_patterns(patterns):
        if fnmatch(label, pat) or fnmatch(label.lower(), pat.lower()):
            return pat
    return None


def check_bbox(bmin: np.ndarray, bmax: np.ndarray, expected) -> None:
    exp_min, exp_max = (np.asarray(b, np.float64) for b in expected)
    if np.abs(bmin - exp_min).max() > BBOX_TOL_M or np.abs(bmax - exp_max).max() > BBOX_TOL_M:
        raise ValueError(f"Geometry bbox {bmin.round(4).tolist()}..{bmax.round(4).tolist()} != expected "
                         f"{expected}: check up_axis / scale")


def load_scene_mesh(geom: GeometryInput, materials: dict) -> SceneMesh:
    v, f, tags = read_obj(geom.obj)
    v = to_zup(v, geom.up_axis) * float(geom.scale)
    labels = tags.get(geom.material_key, tags["usemtl"])
    if not any(labels):  # no label of that kind: try the other one
        labels = next((tags[k] for k in LABEL_KEYS if any(tags[k])), labels)
    keys = [resolve_material(lab, materials) for lab in labels]
    missing = sorted({lab for lab, k in zip(labels, keys) if k is None})
    if missing:
        raise ValueError(f"{geom.obj}: no material pattern matches the labels {missing}; add them to the "
                         f"scene's materials (or a '*' default)")
    bmin, bmax = v[np.unique(f)].min(axis=0), v[np.unique(f)].max(axis=0)
    if geom.expected_bbox is not None:
        check_bbox(bmin, bmax, geom.expected_bbox)
    return SceneMesh(v, f, list(labels), keys, bmin, bmax)


def load_bras_material_csv(path: Path | str) -> dict:
    """BRAS ``_csv`` file: line 1 third-octave centres, line 2 absorption, line 3 scattering."""
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            if raw.strip():
                rows.append([float(x) for x in raw.replace(";", ",").split(",") if x.strip()])
    if len(rows) < 2 or len(rows[0]) != len(rows[1]):
        raise ValueError(f"Unexpected BRAS material CSV layout in {path}")
    return {"center_freqs": rows[0], "absorption": rows[1], "scattering": rows[2] if len(rows) > 2 else None}


def material_coeffs(mi: MaterialInput) -> dict:
    """``{"coeffs", "center_freqs"}`` for the worker."""
    if mi.csv is not None:
        m = load_bras_material_csv(mi.csv)
        return {"coeffs": [float(a) for a in m["absorption"]], "center_freqs": [float(x) for x in m["center_freqs"]]}
    if mi.alpha is None:
        raise ValueError("MaterialInput needs csv or alpha")
    return {"coeffs": [float(mi.alpha)] * len(CONSTANT_ALPHA_BANDS_HZ), "center_freqs": list(CONSTANT_ALPHA_BANDS_HZ)}


def material_table(scene: Scene, mode: str = "csv") -> dict:
    """Scene material key -> worker coefficients (``rigid``: every surface at the minimum absorption)."""
    if mode not in MATERIAL_MODES:
        raise ValueError(f"material mode {mode!r} not in {MATERIAL_MODES}")
    return {key: material_coeffs(RIGID if mode == "rigid" else mi) for key, mi in scene.materials.items()}


def box(lo, hi) -> tuple[np.ndarray, np.ndarray]:
    """Closed axis-aligned box (8 vertices, 12 triangles)."""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    v = np.array([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
                  [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], np.float64)
    quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return v, np.array([t for a, b, c, d in quads for t in ([a, b, c], [a, c, d])])


def control_markers(bmin, bmax, edge: float = CONTROL_MARKER_EDGE_M) -> tuple[np.ndarray, np.ndarray]:
    """Two small boxes at opposite corners of the object bbox (same bbox, far below a wavelength)."""
    lo, hi = np.asarray(bmin, np.float64), np.asarray(bmax, np.float64)
    size = np.minimum(hi - lo, edge)
    va, fa = box(lo, lo + size)
    vb, fb = box(hi - size, hi)
    return np.vstack([va, vb]), np.vstack([fa, fb + len(va)])


def ground_mesh(domain_bmin, domain_bmax, z: float, h: float) -> tuple[np.ndarray, np.ndarray]:
    """Floor rectangle at ``z`` spanning the domain, ``GROUND_INSET_CELLS`` inside its side faces."""
    inset = GROUND_INSET_CELLS * h
    x0, y0 = np.asarray(domain_bmin[:2], np.float64) + inset
    x1, y1 = np.asarray(domain_bmax[:2], np.float64) - inset
    v = np.array([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], np.float64)
    return v, np.array([[0, 1, 2], [0, 2, 3]])


def geometry_dict(parts: list, coeffs: dict) -> dict:
    """Worker geometry from ``[(vertices, faces, [material key per face]), ...]``: one object per material."""
    by_key: dict[str, list] = {}
    verts: list[np.ndarray] = []
    offset = 0
    for v, f, keys in parts:
        verts.append(np.asarray(v, np.float64))
        for tri, key in zip(np.asarray(f, np.int64) + offset, keys):
            by_key.setdefault(key, []).append(tri.tolist())
        offset += len(v)
    faces, ranges, face_materials = [], {}, {}
    for key in sorted(by_key):
        start = len(faces)
        faces += by_key[key]
        ranges[key] = [start, len(faces) - 1]
        face_materials.update({i: coeffs[key] for i in range(start, len(faces))})
    return {"vertices": np.vstack(verts).tolist(), "faces": faces, "object_face_ranges": ranges,
            "face_materials": face_materials}


def scene_geometry(mesh: SceneMesh, coeffs: dict, ground=None, bounds=None, h: float = 0.0) -> dict:
    """The objects (+ the floor) for the measured-scene run."""
    parts = [(mesh.vertices, mesh.faces, mesh.materials)]
    if ground is not None:
        gv, gf = ground_mesh(bounds[0], bounds[1], ground.z, h)
        parts.append((gv, gf, [ground.material] * len(gf)))
    return geometry_dict(parts, coeffs)


def control_scene_geometry(mesh: SceneMesh, coeffs: dict, ground=None, bounds=None, h: float = 0.0) -> dict:
    """The empty-domain control: corner markers (+ the same floor)."""
    mv, mf = control_markers(mesh.bmin, mesh.bmax)
    parts = [(mv, mf, [mesh.materials[0]] * len(mf))]
    if ground is not None:
        gv, gf = ground_mesh(bounds[0], bounds[1], ground.z, h)
        parts.append((gv, gf, [ground.material] * len(gf)))
    return geometry_dict(parts, coeffs)
