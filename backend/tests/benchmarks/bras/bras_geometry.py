"""Scene geometry: OBJ with per-face material labels -> the worker's direct-geometry dict.

Faces are assigned a material through their OBJ label (``usemtl`` or group name) matched against
the scene's material patterns. A hemi-anechoic floor (``GroundPlane``) is added as one rectangle
spanning the padded domain; the empty-domain control run keeps it and replaces the objects by two
tiny corner markers (same bbox, so the same grid).
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from fnmatch import fnmatch
from pathlib import Path
from typing import Optional

import numpy as np

from benchmarks.bras.bras_constants import (CONTROL_MARKER_EDGE_M, GA_BOX_JOIN_M, GA_PANEL_MAX_M, GROUND_INSET_CELLS,
                                            GROUND_TOL_M, MATERIAL_MODES, PRA_CLOSED_ROOM, PRA_FLOOR_KEY, PRA_SHELL_KEY,
                                            PRA_SHELL_MARGIN_M)
from benchmarks.bras.scenes import RIGID, GeometryInput, MaterialInput, Scene

BBOX_TOL_M = 1e-3
DEFAULT_PATTERN = "*"
CONSTANT_ALPHA_BANDS_HZ = [125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0]
LABEL_KEYS = ("usemtl", "group")


@dataclass
class SceneMesh:
    vertices: np.ndarray       # (V, 3) metres, Z up (SOFA frame)
    faces: np.ndarray          # (F, 3); may be empty (a scene with the floor only)
    labels: list               # source label per face (OBJ usemtl / group, SKP material)
    materials: list            # scene material key per face
    bmin: np.ndarray           # object bbox (no ground); ``GeometryInput.empty_bbox`` without faces
    bmax: np.ndarray
    dropped: dict = field(default_factory=dict)   # SKP: material -> {"tris", "area_m2"} not mapped by the scene
    skp: object = None         # the SkpModel (labels with positions / orientations), when read from .skp

    @property
    def empty(self) -> bool:
        return len(self.faces) == 0


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


def triangle_areas(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    t = np.asarray(vertices, np.float64)[np.asarray(faces, np.int64).reshape(-1, 3)]
    return 0.5 * np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)


def extrude(vertices: np.ndarray, faces: np.ndarray, vector) -> tuple[np.ndarray, np.ndarray]:
    """Closed slab from an open sheet: the faces, their copy moved by ``vector`` and the side walls
    along the sheet's boundary edges (a material drawn as one face, e.g. an absorber layer)."""
    faces = np.asarray(faces, np.int64).reshape(-1, 3)
    used, inv = np.unique(faces, return_inverse=True)
    f = inv.reshape(-1, 3)
    v = np.asarray(vertices, np.float64)[used]
    n = len(v)
    edges = np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    key, counts = np.unique(np.sort(edges, axis=1), axis=0, return_counts=True)
    walls = [t for a, b in key[counts == 1] for t in ([a, b, b + n], [a, b + n, a + n])]
    return np.vstack([v, v + np.asarray(vector, np.float64)]), np.vstack([f, f[:, ::-1] + n, np.array(walls, np.int64).reshape(-1, 3)])


def _empty_or_bbox(geom: GeometryInput, v: np.ndarray, f: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if len(f):
        used = np.unique(f)
        return v[used].min(axis=0), v[used].max(axis=0)
    if geom.empty_bbox is None:
        raise ValueError(f"{geom.path}: no face is mapped to a material; give GeometryInput.empty_bbox "
                         "if the scene really has no object (floor only)")
    return np.asarray(geom.empty_bbox[0], np.float64), np.asarray(geom.empty_bbox[1], np.float64)


def load_skp_mesh(geom: GeometryInput, materials: dict) -> SceneMesh:
    """Visible faces of the .skp whose material a scene pattern matches; everything else (icons,
    supports, the finite floor patch, unpainted faces) is dropped and summarised in ``dropped``."""
    from benchmarks.bras.bras_skp import read_skp

    model = read_skp(geom.skp)
    keys = [resolve_material(name, materials) if name else None for name in model.materials]
    areas = triangle_areas(model.vertices, model.faces) if len(model.faces) else np.zeros(0)
    dropped: dict = {}
    for name, key, area in zip(model.materials, keys, areas):
        if key is None:
            d = dropped.setdefault(name or "(no material)", {"tris": 0, "area_m2": 0.0})
            d["tris"] += 1
            d["area_m2"] += float(area)
    parts_v, parts_f, labels, mats, offset = [], [], [], [], 0
    for name in sorted({n for n, k in zip(model.materials, keys) if k is not None}):
        sel = np.array([n == name and k is not None for n, k in zip(model.materials, keys)])
        used, inv = np.unique(model.faces[sel], return_inverse=True)
        v, f = model.vertices[used], inv.reshape(-1, 3)
        vec = next((vec for pat, vec in geom.extrude.items() if fnmatch(name, pat)), None)
        if vec is not None:
            v, f = extrude(v, f, vec)
        parts_v.append(v)
        parts_f.append(f + offset)
        offset += len(v)
        labels += [name] * len(f)
        mats += [resolve_material(name, materials)] * len(f)
    v = np.vstack(parts_v) * float(geom.scale) if parts_v else np.zeros((0, 3))
    f = np.vstack(parts_f) if parts_f else np.zeros((0, 3), np.int64)
    bmin, bmax = _empty_or_bbox(geom, v, f)
    if geom.expected_bbox is not None:
        check_bbox(bmin, bmax, geom.expected_bbox)
    return SceneMesh(v, f, labels, mats, bmin, bmax, dropped, model)


def load_scene_mesh(geom: GeometryInput, materials: dict) -> SceneMesh:
    if geom.skp is not None:
        return load_skp_mesh(geom, materials)
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
    bmin, bmax = _empty_or_bbox(geom, v, f)
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
    """The objects (+ the floor) for the measured-scene run; without objects, the control geometry."""
    if mesh.empty:
        return control_scene_geometry(mesh, coeffs, ground, bounds, h)
    parts = [(mesh.vertices, mesh.faces, mesh.materials)]
    if ground is not None:
        gv, gf = ground_mesh(bounds[0], bounds[1], ground.z, h)
        parts.append((gv, gf, [ground.material] * len(gf)))
    return geometry_dict(parts, coeffs)


def enclosed_geometry(geometry: dict, bounds, margin_m: float = PRA_SHELL_MARGIN_M,
                      floor: Optional[tuple] = None) -> dict:
    """``geometry`` inside a fully absorbing box (alpha = 1) ``margin_m`` beyond ``bounds``.

    pyroomacoustics only tests the walls off the convex hull of all walls for obstruction
    (``find_non_convex_walls``), which assumes sources and receivers inside a closed room. In an
    open scene they lie outside that hull, so a hull wall (the top of the RS1 absorber, a plate)
    never blocks a path and the floor reflects through the objects. The shell makes the scene a
    closed room: the hull is the shell, every object face is checked again, and the shell itself
    reflects nothing. ``margin_m`` keeps it off the floor's edges (no coplanar faces).

    ``floor = (z, coeffs)`` (hemi-anechoic chambers): the shell's bottom face is the floor, at ``z``
    with its material, and ``geometry`` must not carry a floor of its own. The boundary then
    closes a volume, which compas_acoustics needs to diffract on the objects standing on the floor
    (they are part of the boundary: with a finite floor plane floating inside the shell, the model
    is open and the boundary's edges are not searched).
    """
    lo = np.asarray(bounds[0], np.float64) - margin_m
    hi = np.asarray(bounds[1], np.float64) + margin_m
    if floor is not None:
        lo[2] = float(floor[0])
    sv, sf = box(lo, hi)
    offset = len(geometry["vertices"])
    start = len(geometry["faces"])
    shell = {"coeffs": [1.0] * len(CONSTANT_ALPHA_BANDS_HZ), "center_freqs": list(CONSTANT_ALPHA_BANDS_HZ)}
    faces = list(geometry["faces"]) + (sf + offset).tolist()
    ranges = dict(geometry["object_face_ranges"])
    materials = {**geometry["face_materials"], **{i: shell for i in range(start, len(faces))}}
    if floor is None:
        ranges[PRA_SHELL_KEY] = [start, len(faces) - 1]
    else:  # box(): the first two triangles are the bottom face
        ranges[PRA_FLOOR_KEY] = [start, start + 1]
        ranges[PRA_SHELL_KEY] = [start + 2, len(faces) - 1]
        materials.update({start: floor[1], start + 1: floor[1]})
    return {"vertices": list(geometry["vertices"]) + sv.tolist(), "faces": faces,
            "object_face_ranges": ranges, "face_materials": materials}


def ga_scene_geometry(mesh: SceneMesh, coeffs: dict, bounds, ground=None) -> dict:
    """The scene for the geometric-acoustics engine: the objects inside the absorbing shell
    (``PRA_CLOSED_ROOM``), whose bottom face is the floor of a hemi-anechoic chamber. Without
    objects (RS1 rigid), the shell alone."""
    parts = [] if mesh.empty else [(mesh.vertices, mesh.faces, mesh.materials)]
    if parts:
        geometry = geometry_dict(parts, coeffs)
    else:
        geometry = {"vertices": [], "faces": [], "object_face_ranges": {}, "face_materials": {}}
    if not PRA_CLOSED_ROOM:
        if ground is not None:
            gv, gf = ground_mesh(bounds[0], bounds[1], ground.z, 0.0)
            geometry = geometry_dict(parts + [(gv, gf, [ground.material] * len(gf))], coeffs)
        return geometry
    floor = (ground.z, coeffs[ground.material]) if ground is not None else None
    return enclosed_geometry(geometry, bounds, floor=floor)


def control_scene_geometry(mesh: SceneMesh, coeffs: dict, ground=None, bounds=None, h: float = 0.0) -> dict:
    """The empty-domain control: corner markers (+ the same floor)."""
    mv, mf = control_markers(mesh.bmin, mesh.bmax)
    marker_key = mesh.materials[0] if mesh.materials else (ground.material if ground is not None else next(iter(coeffs)))
    parts = [(mv, mf, [marker_key] * len(mf))]
    if ground is not None:
        gv, gf = ground_mesh(bounds[0], bounds[1], ground.z, h)
        parts.append((gv, gf, [ground.material] * len(gf)))
    return geometry_dict(parts, coeffs)


# ── Geometric acoustics: each object as one box ───────────────────────────────
BOX_FACE = {(2, 0): 0, (2, 1): 1, (1, 0): 2, (0, 1): 3, (1, 1): 4, (0, 0): 5}   # (axis, +side) -> box() face


@dataclass
class ObjectBox:
    """One object of the scene for the geometric-acoustics engine: an oriented box, 6 walls."""
    material: str
    center: np.ndarray
    axes: np.ndarray             # (3, 3) rows: unit axes, right-handed
    half: np.ndarray             # half extents along ``axes``
    parts: int                   # mesh parts merged into it
    # faces of another material: (axis index, 1 = the +axis side / 0 = the -axis side) -> material
    # (the RS2 plate's front face is its absorber)
    face_materials: dict = field(default_factory=dict)
    panel: bool = False          # drawn as one two-sided rectangle across its thinnest axis (``panel_boxes``)

    def corners(self) -> np.ndarray:
        v, _ = box(-self.half, self.half)
        return self.center + v @ self.axes

    def mesh(self) -> tuple[np.ndarray, np.ndarray, list]:
        """Vertices, triangles (outward) and the material of each triangle; a panel: its rectangle."""
        if self.panel:
            return self.panel_mesh()
        _, f = box(-self.half, self.half)
        mats = [self.material] * len(f)
        for face, key in self.face_materials.items():
            q = BOX_FACE[face]
            mats[2 * q] = mats[2 * q + 1] = key
        return self.corners(), f, mats

    def panel_mesh(self) -> tuple[np.ndarray, np.ndarray, list]:
        """The box as one rectangle across its thinnest axis: in the face that carries a layer (the RS2
        absorber, whose material it takes), else in the mid-plane. One face has one material, so the back
        of a layered plate takes the layer's too (it only sees the shadowed side)."""
        k = int(np.argmin(self.half))
        u, w = (i for i in range(3) if i != k)
        side = next((s for (axis, s), _ in self.face_materials.items() if axis == k), None)
        material = self.face_materials.get((k, side), self.material) if side is not None else self.material
        c = self.center + (0.0 if side is None else (1.0 if side else -1.0) * self.half[k]) * self.axes[k]
        v = np.array([c + su * self.half[u] * self.axes[u] + sw * self.half[w] * self.axes[w]
                      for su, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        return v, np.array([[0, 1, 2], [0, 2, 3]]), [material, material]

    def extend(self, points: np.ndarray) -> None:
        """Grow the box (same axes) to contain ``points``."""
        local = np.vstack([self.corners(), points]) @ self.axes.T
        lo, hi = local.min(axis=0), local.max(axis=0)
        self.center, self.half = ((lo + hi) / 2) @ self.axes, (hi - lo) / 2


def _parts(vertices: np.ndarray, faces: np.ndarray, weld_m: float = 1e-3) -> np.ndarray:
    """Connected part of each face (vertices welded at ``weld_m``)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    _, inv = np.unique(np.round(vertices / weld_m).astype(np.int64), axis=0, return_inverse=True)
    f = inv.ravel()[faces]
    e = np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    n = int(inv.max()) + 1
    _, label = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)), directed=False)
    return label[f[:, 0]]


def _box_axes(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Axes of the box around an object: its dominant face normal (by area), the dominant normal
    across it and their cross product; ordered and signed like the world axes they are closest to."""
    t = vertices[faces]
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    area = np.linalg.norm(n, axis=1)
    keep = area > 1e-12
    n, area = n[keep] / area[keep, None], area[keep]
    axes: list = []
    for _ in range(2):
        if axes:   # normals across the first axis only
            sel = np.abs(n @ axes[0]) < 0.1
            n, area = n[sel], area[sel]
        if not len(n):
            return np.eye(3)
        weights = [float(area[np.abs(n @ c) > 0.99].sum()) for c in n[np.argsort(-area)[:50]]]
        best = n[np.argsort(-area)[:50]][int(np.argmax(weights))]
        if axes:
            best = best - axes[0] * float(best @ axes[0])
        axes.append(best / np.linalg.norm(best))
    a = np.array([axes[0], axes[1], np.cross(axes[0], axes[1])])
    order = np.argmax(np.abs(a), axis=1)
    if len(set(order.tolist())) == 3:
        a = a[np.argsort(order)]
        a *= np.sign(np.diag(a))[:, None]
    if np.linalg.det(a) < 0:
        a[2] = -a[2]
    return a


def object_boxes(mesh: SceneMesh, join_m: float = GA_BOX_JOIN_M, layers: Optional[dict] = None) -> list:
    """The scene's objects as boxes. Parts of one material closer than ``join_m`` are one object (the
    rows and battens of RS7, the pieces of the RS6 body), replaced by its oriented bounding box: every
    coplanar face of the object becomes one wall (and the stand slots of the RS2 / RS3 plates close).
    ``layers`` (``GeometryInput.extrude``: material pattern -> thickness vector) are layers drawn as one
    face, the RS2 absorber: the plate's facing face is duplicated, moved to the layer's front and joined
    to the plate, so plate and layer are one box whose front face has the layer's material (a separate
    sheet would put four more edges 22 mm in front of the plate's, and the mesh preparation's air
    sampling does not always reach the gap behind it). A layer without a box within ``join_m`` stays its
    own box."""
    if mesh.empty:
        return []
    v, f = mesh.vertices, mesh.faces
    part = _parts(v, f)
    mats = np.asarray(mesh.materials, dtype=object)
    labels = np.asarray(mesh.labels, dtype=object)
    out, layer_boxes = [], []
    for key in sorted(set(mesh.materials)):
        ids = sorted(set(part[mats == key].tolist()))
        lo = np.array([v[f[part == i]].reshape(-1, 3).min(axis=0) for i in ids])
        hi = np.array([v[f[part == i]].reshape(-1, 3).max(axis=0) for i in ids])
        root = list(range(len(ids)))

        def find(i: int) -> int:
            while root[i] != i:
                root[i] = root[root[i]]
                i = root[i]
            return i

        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                if np.all(lo[a] <= hi[b] + join_m) and np.all(lo[b] <= hi[a] + join_m):
                    root[find(a)] = find(b)
        groups: dict = {}
        for a, i in enumerate(ids):
            groups.setdefault(find(a), []).append(i)
        for members in groups.values():
            sel = np.isin(part, members)
            axes = _box_axes(v, f[sel])
            pts = v[np.unique(f[sel])] @ axes.T
            lo_l, hi_l = pts.min(axis=0), pts.max(axis=0)
            ob = ObjectBox(key, ((lo_l + hi_l) / 2) @ axes, axes, (hi_l - lo_l) / 2, len(members))
            vec = next((np.asarray(x, np.float64) for pat, x in (layers or {}).items() if fnmatch(labels[sel][0], pat)), None)
            (out if vec is None else layer_boxes).append(ob if vec is None else (ob, vec))
    for layer, vec in layer_boxes:
        host = min(out, key=lambda b: _gap(b, layer), default=None)
        if host is None or _gap(host, layer) > join_m:
            out.append(layer)
            continue
        host.extend(layer.corners())
        host.parts += layer.parts
        k = int(np.argmax(np.abs(host.axes @ vec)))
        host.face_materials[(k, 0 if float(host.axes[k] @ vec) > 0 else 1)] = layer.material
    return out


def _gap(a: ObjectBox, b: ObjectBox) -> float:
    """Largest per-axis gap between the world bounding boxes of two boxes (<= 0: they touch)."""
    ca, cb = a.corners(), b.corners()
    return float(np.max(np.maximum(ca.min(axis=0) - cb.max(axis=0), cb.min(axis=0) - ca.max(axis=0))))


def lift_boxes(boxes: list, floor_z: float, lift_m: float, tol_m: float = GROUND_TOL_M) -> list:
    """The boxes standing on the floor at ``floor_z`` raised by ``lift_m`` (``PraSpec.lift_m``)."""
    if not lift_m:
        return boxes
    return [replace(b, center=b.center + np.array([0.0, 0.0, lift_m]))
            if abs(float(b.corners()[:, 2].min()) - floor_z) <= tol_m else b for b in boxes]


def panel_boxes(boxes: list, max_m: float = GA_PANEL_MAX_M) -> list:
    """``boxes`` with every box at most ``max_m`` thick drawn as a panel (``PraSpec.panels``)."""
    return [replace(b, panel=True) if 2.0 * float(np.min(b.half)) <= max_m + 1e-9 else b for b in boxes]


def box_scene_mesh(mesh: SceneMesh, boxes: list) -> SceneMesh:
    """``mesh`` with its objects replaced by ``boxes`` (labels ``box<n>``)."""
    if not boxes:
        return mesh
    parts_v, parts_f, mats, labels, offset = [], [], [], [], 0
    for n, b in enumerate(boxes):
        bv, bf, bm = b.mesh()
        parts_v.append(bv)
        parts_f.append(bf + offset)
        offset += len(bv)
        mats += bm
        labels += [f"box{n}"] * len(bf)
    v, f = np.vstack(parts_v), np.vstack(parts_f)
    used = np.unique(f)
    return SceneMesh(v, f, labels, mats, v[used].min(axis=0), v[used].max(axis=0))


AXES = {"x": 0, "y": 1}


def _strips(mesh: SceneMesh, faces_sel: np.ndarray, part: np.ndarray, cross: int) -> list[dict]:
    """Parts overlapping across ``cross`` are one strip: its extent across, along and in height."""
    v, f = mesh.vertices, mesh.faces
    boxes = []
    for i in sorted(set(part[faces_sel].tolist())):
        p = v[f[part == i]].reshape(-1, 3)
        boxes.append([p.min(axis=0), p.max(axis=0)])
    boxes.sort(key=lambda b: b[0][cross])
    strips: list = []
    for lo, hi in boxes:   # sorted by their start across: a part overlapping the last strip joins it
        if strips and lo[cross] < strips[-1]["hi"][cross] - 1e-4:
            strips[-1]["lo"] = np.minimum(strips[-1]["lo"], lo)
            strips[-1]["hi"] = np.maximum(strips[-1]["hi"], hi)
        else:
            strips.append({"lo": lo.copy(), "hi": hi.copy()})
    return strips


def strip_scene_mesh(mesh: SceneMesh, along: str, join_m: float = GA_BOX_JOIN_M) -> SceneMesh:
    """``mesh`` (battens lying side by side, e.g. the RS1 diffusor) as the union of longitudinal boxes.

    Parts of one material that overlap across the ``along`` axis are one batten, its bounding box.
    Battens closer than ``join_m`` touch (the gap split in the middle) and form one closed solid: the
    castellated profile extruded along ``along``. Its faces between battens are gone, and each top,
    each step between two heights, the sides, the bottom and the two end caps are one plane each (the
    mesh preparation merges their triangles into one wall)."""
    if mesh.empty:
        return mesh
    a = AXES[along]
    c = 1 - a
    part = _parts(mesh.vertices, mesh.faces)
    mats = np.asarray(mesh.materials, dtype=object)
    tris, tri_mats, labels = [], [], []
    for key in sorted(set(mesh.materials)):
        strips = _strips(mesh, mats == key, part, c)
        runs: list = [[strips[0]]]
        for s in strips[1:]:
            if s["lo"][c] - runs[-1][-1]["hi"][c] > join_m:
                runs.append([])
            runs[-1].append(s)
        for n, run in enumerate(runs):
            new = _extruded_profile(run, a, c)
            tris += new
            tri_mats += [key] * len(new)
            labels += [f"strips{n}"] * len(new)
    t = np.asarray(tris, np.float64)
    verts, inv = np.unique(np.round(t.reshape(-1, 3), 9), axis=0, return_inverse=True)
    faces = inv.reshape(-1, 3)
    return SceneMesh(verts, faces, labels, tri_mats, verts.min(axis=0), verts.max(axis=0))


def _extruded_profile(run: list, a: int, c: int) -> list:
    """Outward triangles of the solid of a run of battens side by side (across ``c``, along ``a``)."""
    n = len(run)
    b = [float(run[0]["lo"][c])] + [(float(run[i - 1]["hi"][c]) + float(run[i]["lo"][c])) / 2 for i in range(1, n)] \
        + [float(run[-1]["hi"][c])]
    h = [float(s["hi"][2]) for s in run]
    z0 = min(float(s["lo"][2]) for s in run)
    l0, l1 = min(float(s["lo"][a]) for s in run), max(float(s["hi"][a]) for s in run)

    def P(u, ll, z):   # profile coordinates (across, along, height) -> world
        p = [0.0, 0.0, z]
        p[c], p[a] = u, ll
        return np.array(p)

    def axis(k, sign):
        e = np.zeros(3)
        e[k] = sign
        return e

    out: list = []

    def poly(pts, outward):   # convex polygon (collinear points allowed): fan from its centroid
        pts = [np.asarray(p) for p in pts]
        if len(pts) == 4 and not any(np.linalg.norm(np.cross(pts[(i + 1) % 4] - pts[i], pts[(i + 2) % 4] - pts[(i + 1) % 4])) < 1e-12
                                     for i in range(4)):
            fan = [(pts[0], pts[1], pts[2]), (pts[0], pts[2], pts[3])]
        else:
            m = np.mean(pts, axis=0)
            fan = [(m, pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
        for t in fan:
            nrm = np.cross(t[1] - t[0], t[2] - t[0])
            if np.linalg.norm(nrm) < 1e-12:
                continue
            out.append(t if nrm @ outward > 0 else (t[0], t[2], t[1]))

    for i in range(n):
        # top and bottom of batten i
        poly([P(b[i], l0, h[i]), P(b[i + 1], l0, h[i]), P(b[i + 1], l1, h[i]), P(b[i], l1, h[i])], np.array([0, 0, 1.0]))
        poly([P(b[i], l0, z0), P(b[i + 1], l0, z0), P(b[i + 1], l1, z0), P(b[i], l1, z0)], np.array([0, 0, -1.0]))
        # its end caps: the batten's rectangle, with the neighbours' heights on its sides (no T-junction)
        left = [P(b[i], 0, h[i - 1])] if i > 0 and h[i - 1] < h[i] else []
        right = [P(b[i + 1], 0, h[i + 1])] if i < n - 1 and h[i + 1] < h[i] else []
        ring = [P(b[i], 0, z0), P(b[i + 1], 0, z0), *right, P(b[i + 1], 0, h[i]), P(b[i], 0, h[i]), *left[::-1]]
        for ll, sign in ((l0, -1.0), (l1, 1.0)):
            poly([p + axis(a, ll) for p in ring], axis(a, sign))
    # sides of the run and the steps between two heights
    poly([P(b[0], l0, z0), P(b[0], l1, z0), P(b[0], l1, h[0]), P(b[0], l0, h[0])], axis(c, -1.0))
    poly([P(b[n], l0, z0), P(b[n], l1, z0), P(b[n], l1, h[-1]), P(b[n], l0, h[-1])], axis(c, 1.0))
    for i in range(1, n):
        if abs(h[i] - h[i - 1]) > 1e-9:
            lo_h, hi_h = sorted((h[i - 1], h[i]))
            poly([P(b[i], l0, lo_h), P(b[i], l1, lo_h), P(b[i], l1, hi_h), P(b[i], l0, hi_h)],
                 axis(c, 1.0 if h[i - 1] > h[i] else -1.0))
    return out


def ga_bounds(mesh: SceneMesh, positions) -> tuple[np.ndarray, np.ndarray]:
    """What the geometric-acoustics shell encloses: the objects and every measured position. Not the
    PFFDTD domain, which grows with the fmax stage: the geometric scene must be the same at every stage."""
    pts = np.vstack([np.asarray(mesh.bmin, np.float64), np.asarray(mesh.bmax, np.float64)]
                    + [np.asarray(p, np.float64).reshape(1, 3) for p in positions])
    return pts.min(axis=0), pts.max(axis=0)
