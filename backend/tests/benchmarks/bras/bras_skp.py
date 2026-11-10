"""Read a SketchUp ``.skp`` scene description directly (geometry, materials, text labels).

Uses the official SketchUp C API (``SketchUpAPI.dll``), which Rhino ships with its SKP importer
(``<Rhino>/Plug-ins``); set ``SKETCHUP_API_DLL`` to use another copy. Windows only.

A BRAS model holds the acoustic objects, the chamber floor, the supporting structure, loudspeaker
and microphone icons, and text labels with every position and loudspeaker orientation. This module
returns all visible faces in metres (SketchUp is Z-up, inches internally) with their material
name, and the parsed labels; ``bras_geometry`` keeps the faces whose material a scene maps.
"""
from __future__ import annotations

import ctypes as C
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

DLL_ENV = "SKETCHUP_API_DLL"
DLL_NAME = "SketchUpAPI.dll"
RHINO_PLUGIN_DIRS = [r"C:\Program Files\Rhino 8\Plug-ins", r"C:\Program Files\Rhino 7\Plug-ins"]
INCH_M = 0.0254
NO_MATERIAL = ""
# "LS01_Genelec8020c | pos= (2902,2985,1520) mm; (phi,theta)=(0deg,-30deg)"; a closing bracket may be missing
LABEL_RE = re.compile(
    r"(LS|MP)0*(\d+)_(\w+)[^=]*?pos\s*=\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)?\s*mm"
    r"(?:\s*;?\s*\([^)]*\)\s*=\s*\(\s*([-\d.]+)\s*°\s*,\s*([-\d.]+)\s*°\s*\))?"
)
POINT_RE = re.compile(r"(Reflection point)[^=]*?pos\s*=\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)", re.I)


class _Ref(C.Structure):
    _fields_ = [("ptr", C.c_void_p)]


class _Point(C.Structure):
    _fields_ = [("x", C.c_double), ("y", C.c_double), ("z", C.c_double)]


class _Transform(C.Structure):
    _fields_ = [("v", C.c_double * 16)]


@dataclass
class SkpLabel:
    kind: str                          # "LS" | "MP"
    id: str                            # "LS1"
    device: str                        # "Genelec8020c", "GRAS40AF", "FABIAN"
    position: np.ndarray               # metres
    orientation: Optional[tuple] = None  # (phi, theta) deg, BRAS convention; loudspeakers only


@dataclass
class SkpModel:
    vertices: np.ndarray               # (V, 3) metres, Z up
    faces: np.ndarray                  # (F, 3)
    materials: list                    # material name per triangle ("" = none)
    texts: list = field(default_factory=list)
    labels: dict = field(default_factory=dict)       # "LS1" / "MP1" -> SkpLabel
    reflection_point: Optional[np.ndarray] = None
    hidden_faces: int = 0              # triangles skipped because hidden


def find_dll() -> Optional[Path]:
    env = os.environ.get(DLL_ENV)
    candidates = ([Path(env)] if env else []) + [Path(d) / DLL_NAME for d in RHINO_PLUGIN_DIRS]
    return next((p for p in candidates if p.exists()), None)


def skp_available() -> Optional[str]:
    """None if .skp files can be read here, else the reason."""
    if os.name != "nt":
        return "reading .skp needs the SketchUp C API (Windows)"
    if find_dll() is None:
        return f"{DLL_NAME} not found (install Rhino 7/8 or set {DLL_ENV})"
    return None


_LIB = None


def _lib():
    global _LIB
    if _LIB is None:
        reason = skp_available()
        if reason:
            raise RuntimeError(reason)
        dll = find_dll()
        os.add_dll_directory(str(dll.parent))
        lib = C.CDLL(str(dll))
        for name in ("SUGroupToDrawingElement", "SUComponentInstanceToDrawingElement", "SUFaceToDrawingElement"):
            getattr(lib, name).restype = _Ref
        lib.SUInitialize()
        _LIB = lib
    return _LIB


def _check(code: int, what: str) -> None:
    if code != 0:
        raise RuntimeError(f"SketchUp API error {code} in {what}")


def _string(getter, obj) -> str:
    su = _lib()
    s = _Ref()
    _check(su.SUStringCreate(C.byref(s)), "SUStringCreate")
    out = ""
    if getter(obj, C.byref(s)) == 0:
        n = C.c_size_t()
        su.SUStringGetUTF8Length(s, C.byref(n))
        buf = C.create_string_buffer(n.value + 1)
        su.SUStringGetUTF8(s, n.value + 1, buf, C.byref(n))
        out = buf.value.decode("utf-8", "replace")
    su.SUStringRelease(C.byref(s))
    return out


def _children(count_fn, get_fn, parent) -> list:
    n = C.c_size_t()
    _check(count_fn(parent, C.byref(n)), count_fn.__name__)
    if not n.value:
        return []
    arr = (_Ref * n.value)()
    got = C.c_size_t()
    _check(get_fn(parent, n.value, arr, C.byref(got)), get_fn.__name__)
    return list(arr[: got.value])


def _material_name(getter, obj) -> str:
    m = _Ref()
    return _string(_lib().SUMaterialGetName, m).strip() if getter(obj, C.byref(m)) == 0 else NO_MATERIAL


def _hidden(element) -> bool:
    su = _lib()
    hidden = C.c_bool(False)
    su.SUDrawingElementGetHidden(element, C.byref(hidden))
    layer, visible = _Ref(), C.c_bool(True)
    if su.SUDrawingElementGetLayer(element, C.byref(layer)) == 0:
        su.SULayerGetVisibility(layer, C.byref(visible))
    return hidden.value or not visible.value


def _matrix(t: _Transform) -> np.ndarray:
    return np.array(t.v[:], np.float64).reshape(4, 4).T   # SUTransformation is column-major


def _face_mesh(face, M: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    su = _lib()
    helper = _Ref()
    _check(su.SUMeshHelperCreate(C.byref(helper), face), "SUMeshHelperCreate")
    nv, nt, got = C.c_size_t(), C.c_size_t(), C.c_size_t()
    su.SUMeshHelperGetNumVertices(helper, C.byref(nv))
    su.SUMeshHelperGetNumTriangles(helper, C.byref(nt))
    pts = (_Point * nv.value)()
    su.SUMeshHelperGetVertices(helper, nv.value, pts, C.byref(got))
    idx = (C.c_size_t * (3 * nt.value))()
    su.SUMeshHelperGetVertexIndices(helper, 3 * nt.value, idx, C.byref(got))
    su.SUMeshHelperRelease(C.byref(helper))
    v = np.array([[p.x, p.y, p.z, 1.0] for p in pts], np.float64) @ M.T
    w = np.where(np.abs(v[:, 3:]) > 1e-12, v[:, 3:], 1.0)
    return v[:, :3] / w * INCH_M, np.array(idx[:], np.int64).reshape(-1, 3)


def _walk(entities, M: np.ndarray, inherited: str, hidden: bool, out: dict) -> None:
    """Faces of ``entities`` and of every nested group / component instance (transforms applied).

    A face without a material shows its parent's (SketchUp's rule); hidden elements, and
    everything on an invisible layer, are counted but not returned.
    """
    su = _lib()
    for face in _children(su.SUEntitiesGetNumFaces, su.SUEntitiesGetFaces, entities):
        v, t = _face_mesh(face, M)
        if hidden or _hidden(su.SUFaceToDrawingElement(face)):
            out["hidden"] += len(t)
            continue
        name = (_material_name(su.SUFaceGetFrontMaterial, face) or _material_name(su.SUFaceGetBackMaterial, face)
                or inherited)
        out["tris"].append(t + out["n"])
        out["verts"].append(v)
        out["mats"] += [name] * len(t)
        out["n"] += len(v)
    for text in _children(su.SUEntitiesGetNumTexts, su.SUEntitiesGetTexts, entities):
        out["texts"].append(_string(su.SUTextGetString, text))
    for group in _children(su.SUEntitiesGetNumGroups, su.SUEntitiesGetGroups, entities):
        t, sub = _Transform(), _Ref()
        _check(su.SUGroupGetTransform(group, C.byref(t)), "SUGroupGetTransform")
        _check(su.SUGroupGetEntities(group, C.byref(sub)), "SUGroupGetEntities")
        el = su.SUGroupToDrawingElement(group)
        _walk(sub, M @ _matrix(t), _material_name(su.SUDrawingElementGetMaterial, el) or inherited,
              hidden or _hidden(el), out)
    for inst in _children(su.SUEntitiesGetNumInstances, su.SUEntitiesGetInstances, entities):
        t, definition, sub = _Transform(), _Ref(), _Ref()
        _check(su.SUComponentInstanceGetTransform(inst, C.byref(t)), "SUComponentInstanceGetTransform")
        _check(su.SUComponentInstanceGetDefinition(inst, C.byref(definition)), "SUComponentInstanceGetDefinition")
        _check(su.SUComponentDefinitionGetEntities(definition, C.byref(sub)), "SUComponentDefinitionGetEntities")
        el = su.SUComponentInstanceToDrawingElement(inst)
        _walk(sub, M @ _matrix(t), _material_name(su.SUDrawingElementGetMaterial, el) or inherited,
              hidden or _hidden(el), out)


def parse_labels(texts: list) -> tuple[dict, Optional[np.ndarray]]:
    """Positions (m) and loudspeaker orientations from the BRAS text labels (one text may hold several)."""
    labels: dict[str, SkpLabel] = {}
    reflection = None
    for raw in texts:
        text = raw.replace("\r", " ").replace("\n", " ")
        for kind, num, device, x, y, z, phi, theta in LABEL_RE.findall(text):
            key = f"{kind}{int(num)}"
            orientation = (float(phi), float(theta)) if phi and kind == "LS" else None
            labels[key] = SkpLabel(kind, key, device, np.array([float(x), float(y), float(z)]) / 1000.0, orientation)
        m = POINT_RE.search(text)
        if m:
            reflection = np.array([float(m.group(2)), float(m.group(3)), float(m.group(4))]) / 1000.0
    return labels, reflection


def read_skp(path: Path | str) -> SkpModel:
    su = _lib()
    model = _Ref()
    _check(su.SUModelCreateFromFile(C.byref(model), str(path).encode("utf-8")), f"opening {path}")
    try:
        entities = _Ref()
        _check(su.SUModelGetEntities(model, C.byref(entities)), "SUModelGetEntities")
        out = {"verts": [], "tris": [], "mats": [], "texts": [], "n": 0, "hidden": 0}
        _walk(entities, np.eye(4), NO_MATERIAL, False, out)
    finally:
        su.SUModelRelease(C.byref(model))
    verts = np.vstack(out["verts"]) if out["verts"] else np.zeros((0, 3))
    tris = np.vstack(out["tris"]) if out["tris"] else np.zeros((0, 3), np.int64)
    labels, reflection = parse_labels(out["texts"])
    return SkpModel(verts, tris, out["mats"], out["texts"], labels, reflection, out["hidden"])
