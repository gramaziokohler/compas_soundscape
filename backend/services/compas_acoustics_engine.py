"""compas_acoustics as the geometric-acoustics engine of /api/pyroomacoustics/*.

The app keeps its own front end of the pipeline (Speckle / JSON geometry, units, materials,
``SimulationMeshService.prepare`` + preflight, the job contract and the results file); this
module hands the prepared mesh to compas_acoustics and gives back one response per pair:

* geometry  — ``SimulationMesh`` -> ``compas_acoustics.geometry.PreparedMesh`` (same layout: the
  preparation was ported to compas_acoustics verbatim) -> ``RoomGeometry.from_prepared``:
  one-sided walls are the boundary, two-sided walls obstacles, orientation trusted, the
  mean-free-path air volume used when the model does not close. Recentred (float32 walls).
* materials — every face material (pyroomacoustics id, app custom id, inlined user material,
  bare absorption) becomes a compas_acoustics material on its 125 Hz–8 kHz bands; a per-object
  scattering overrides the material's in every band.
* methods   — mono: ``Mono`` (image sources + ray tracing, optional UDFA diffraction, emitter /
  ray processes, reciprocity); FOA/HOA: ``Ambisonics`` (hybrid: image sources + directional
  FDN tail shaped by a ``Mono`` reference, optional UDFA/BTMS diffraction), AmbiX ACN/SN3D in
  the listener frame (forward -Y, left +X, up +Z), like the legacy FOA output.
* level     — responses are returned at the app's 1/r level (``CA_TO_APP_LEVEL_SCALE``).

compas_acoustics is imported lazily: the legacy engine and the rest of the backend never load it.
"""

from __future__ import annotations

import math
import re
from contextlib import contextmanager
from dataclasses import dataclass, field, fields
from typing import Any, Callable, Optional

import numpy as np

from config.constants import (
    CA_AIR_HUMIDITY_DEFAULT,
    CA_AIR_TEMPERATURE_RANGE_C,
    CA_AMBISONIC_NORMALIZATION,
    CA_BAND_METRICS,
    CA_DIFFRACTION_OFF,
    CA_HYBRID_SCATTERING_SPLIT,
    CA_TO_APP_LEVEL_SCALE,
    PYROOMACOUSTICS_CUSTOM_MATERIALS,
    PYROOMACOUSTICS_DEFAULT_SCATTERING,
    PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS,
    PYROOMACOUSTICS_SAMPLE_RATE,
)
from services.pyroomacoustics_directivity import build_pra_directivity
from services.simulation_mesh_service import SimulationMesh, _material_key

# Listener frame of the app's ambisonic IRs (see PyroomacousticsService.add_receiver_to_room).
LISTENER_FORWARD = (0.0, -1.0, 0.0)
LISTENER_UP = (0.0, 0.0, 1.0)


@dataclass
class EngineSettings:
    """What the app's simulation settings mean for compas_acoustics."""

    ambisonic_order: int = 0            # 0 = mono, 1 = FOA, 2-3 = HOA
    max_order: int = 3                  # image-source order
    ray_tracing: bool = True
    air_absorption: bool = True
    n_rays: int = 10000
    sound_speed: float = 343.0          # app setting; becomes the air temperature
    air_temperature: Optional[float] = None  # deg C, overrides the sound speed
    air_humidity: float = CA_AIR_HUMIDITY_DEFAULT
    diffraction: str = CA_DIFFRACTION_OFF
    n_jobs: int = 1
    reciprocity: bool = True
    seed: int = 42
    scattering_split: bool = CA_HYBRID_SCATTERING_SPLIT
    # Ambisonic late field: "auto" (ray-traced reference when ray tracing is on, else Eyring),
    # "reference" (the request's ray-traced mono run), "ray_tracing" (compas_acoustics' own
    # reference run), "eyring" or "sabine" (statistical decay of the room, no rays).
    tail: str = "auto"
    n_slopes: int = 1                   # decay slopes of the late field (2 = coupled volumes)
    # Diffraction edges switched off by the user: [x1, y1, z1, x2, y2, z2] in model coordinates
    excluded_edges: list = field(default_factory=list)


@dataclass
class PairResponse:
    """One pair's response at the app's level, (samples,) or (samples, channels)."""

    pair_index: int
    rir: np.ndarray
    generation: dict
    band_metrics: Optional[dict] = None


@dataclass
class EngineRun:
    responses: list[PairResponse]
    notes: list[str] = field(default_factory=list)
    generation: dict = field(default_factory=dict)


# ─── Air ──────────────────────────────────────────────────────────────────────

def temperature_for_sound_speed(c: float) -> float:
    """Air temperature (deg C) whose speed of sound is ``c`` (dry air, c = 331.3 sqrt(1 + T/273.15))."""
    return 273.15 * ((float(c) / 331.3) ** 2 - 1.0)


def air_conditions(settings: EngineSettings):
    """``(AirConditions, note or None)``; a temperature outside Cramer's range is clamped and reported."""
    from compas_acoustics.room.air import AirConditions

    explicit = settings.air_temperature is not None
    t = float(settings.air_temperature) if explicit else temperature_for_sound_speed(settings.sound_speed)
    lo, hi = CA_AIR_TEMPERATURE_RANGE_C
    note = None
    if not lo <= t <= hi:
        clamped = min(max(t, lo), hi)
        what = f"air temperature {t:.1f} deg C" if explicit else f"sound speed {settings.sound_speed:g} m/s ({t:.1f} deg C)"
        note = f"The {what} is outside compas_acoustics' {lo:g}-{hi:g} deg C; simulated at {clamped:g} deg C."
        t = clamped
    return AirConditions(temperature=t, humidity=float(settings.air_humidity)), note


# ─── Materials ────────────────────────────────────────────────────────────────

def _on_bands(coeffs, center_freqs, bands) -> list[float]:
    """Coefficients at ``center_freqs`` on octave ``bands``: the mean of the inputs centred in each
    octave, else log-frequency interpolation held constant beyond the given range."""
    f = np.asarray(center_freqs, np.float64)
    c = np.asarray(coeffs, np.float64)
    order = np.argsort(f)
    f, c = f[order], c[order]
    out = []
    for fc in bands:
        inside = (f >= fc / math.sqrt(2.0)) & (f < fc * math.sqrt(2.0))
        value = c[inside].mean() if inside.any() else np.interp(math.log2(fc), np.log2(f), c)
        out.append(float(np.clip(value, 0.0, 1.0)))
    return out


def to_ca_material(name: str, value: Any):
    """A compas_acoustics ``AcousticMaterial`` for one of the app's face materials."""
    from compas_acoustics import AcousticMaterial
    from compas_acoustics.defaults import Defaults

    bands = Defaults().DEFAULT_FREQUENCY_BANDS
    if isinstance(value, str) and value in PYROOMACOUSTICS_CUSTOM_MATERIALS:
        value = PYROOMACOUSTICS_CUSTOM_MATERIALS[value]
    if isinstance(value, str):
        material = AcousticMaterial.from_pyroomacoustics(value)
        material.name = name
        return material
    if isinstance(value, dict):
        coeffs = value["coeffs"]
        freqs = value.get("center_freqs") or [125, 250, 500, 1000, 2000, 4000, 8000][: len(coeffs)]
        absorption = _on_bands(coeffs, freqs, bands)
        scattering = None
        if isinstance(value.get("scattering"), dict) and value["scattering"].get("coeffs"):
            s = value["scattering"]
            scattering = _on_bands(s["coeffs"], s.get("center_freqs") or freqs, bands)
        return AcousticMaterial(name, absorption, scattering, description=value.get("description"), data_origin="compas_soundscape")
    alpha = float(np.clip(float(value), 0.0, 1.0))
    return AcousticMaterial(name, [alpha] * len(bands), None, data_origin="compas_soundscape")


def _material_names(mesh: SimulationMesh) -> tuple[list[str], dict]:
    """Per-face material names and ``name -> AcousticMaterial`` (every material with a scattering)."""
    from compas_acoustics.defaults import Defaults

    n_bands = len(Defaults().DEFAULT_FREQUENCY_BANDS)
    by_key: dict[str, str] = {}
    materials: dict = {}
    names: list[str] = []
    for value in mesh.face_material:
        key = _material_key(value)
        if key not in by_key:
            name = f"m{len(by_key)}"
            material = to_ca_material(name, value)
            if material.scattering_coefficients is None:
                material.scattering_coefficients = [PYROOMACOUSTICS_DEFAULT_SCATTERING] * n_bands
            by_key[key] = name
            materials[name] = material
        names.append(by_key[key])
    return names, materials


# ─── Geometry ─────────────────────────────────────────────────────────────────

def to_prepared(mesh: SimulationMesh, offset: np.ndarray, face_material_names: list[str]):
    """The app's prepared mesh as compas_acoustics' ``PreparedMesh``, shifted by ``-offset``."""
    from compas_acoustics.geometry.coplanar import MergedWall
    from compas_acoustics.geometry.prepare import PreparedMesh

    offset = np.asarray(offset, dtype=np.float64)
    names = {f.name for f in fields(PreparedMesh)}
    values = {k: getattr(mesh, k) for k in names if hasattr(mesh, k)}
    values.update(
        vertices=np.asarray(mesh.vertices, np.float64) - offset,
        seeds=np.asarray(mesh.seeds, np.float64).reshape(-1, 3) - offset,
        walls=[MergedWall(corners=np.asarray(w.corners, np.float64) - offset, faces=np.asarray(w.faces)) for w in mesh.walls],
        face_material=list(face_material_names),
        visibility=None,
        air_volume=float(mesh.air_volume_m3),
        origin=np.arange(len(mesh.faces), dtype=np.int64),
        stats=dict(mesh.stats),
    )
    return PreparedMesh(**values)


def room_geometry(mesh: SimulationMesh, offset: np.ndarray):
    """``RoomGeometry.from_prepared`` of the app's prepared mesh (points are never rejected as outside)."""
    from compas_acoustics import RoomGeometry

    names, materials = _material_names(mesh)
    prepared = to_prepared(mesh, offset, names)
    return RoomGeometry.from_prepared(prepared, materials, check_inside=False)


# ─── Methods ──────────────────────────────────────────────────────────────────

def _mono(settings: EngineSettings, air, diffraction: bool):
    from compas_acoustics import Mono

    kwargs: dict = dict(
        image_source_order=settings.max_order,
        ray_tracing=settings.ray_tracing,
        air_absorption=settings.air_absorption,
        normalize=False,
        air=air,
        n_jobs=settings.n_jobs,
        reciprocity=settings.reciprocity,
        diffraction=diffraction,
    )
    if settings.ray_tracing:
        kwargs.update(n_rays=int(settings.n_rays), seed=int(settings.seed), receiver_radius=PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS)
    return Mono(**kwargs)


def build_method(settings: EngineSettings):
    """``(method, notes)`` for the settings."""
    notes: list[str] = []
    air, note = air_conditions(settings)
    if note:
        notes.append(note)
    model = settings.diffraction or CA_DIFFRACTION_OFF
    if settings.ambisonic_order == 0:
        if model == "btms":
            raise ValueError("BTMS diffraction needs an ambisonic output (FOA/HOA); use UDFA for mono.")
        return _mono(settings, air, model != CA_DIFFRACTION_OFF), notes

    from compas_acoustics import Ambisonics

    kwargs: dict = dict(
        sh_order=int(settings.ambisonic_order),
        normalization=CA_AMBISONIC_NORMALIZATION,
        image_source_order=settings.max_order,
        diffraction=False if model == CA_DIFFRACTION_OFF else model,
        seed=int(settings.seed),
        normalize=False,
        air=air,
        scattering=bool(settings.scattering_split),
        n_jobs=settings.n_jobs,
    )
    tail = settings.tail or "auto"
    if tail == "auto":
        tail = "reference" if settings.ray_tracing else "eyring"
        if not settings.ray_tracing:
            notes.append("Ray tracing is off: the ambisonic late field follows Eyring's decay of the room.")
    if tail == "reference":
        # The late field follows a ray-traced mono run with the app's ray settings (also its W level reference).
        reference = EngineSettings(**{**settings.__dict__, "ray_tracing": True})
        kwargs["reference"] = _mono(reference, air, False)
        kwargs["n_slopes"] = int(settings.n_slopes)
    elif tail == "ray_tracing":
        kwargs["tail"] = "ray_tracing"
        kwargs["air_absorption"] = settings.air_absorption
        kwargs["n_slopes"] = int(settings.n_slopes)
    elif tail in ("eyring", "sabine"):
        kwargs["tail"] = tail
        kwargs["air_absorption"] = settings.air_absorption
        if settings.n_slopes != 1:
            notes.append(f"A {tail} tail has one decay slope; the {settings.n_slopes}-slope setting is ignored.")
    else:
        raise ValueError(f"Unknown tail '{tail}'; one of auto, reference, ray_tracing, eyring, sabine")
    return Ambisonics(**kwargs), notes


@contextmanager
def edge_warnings(notes: list):
    """Collect compas_acoustics' warnings about the edges it skips into ``notes`` (plain sentences).

    It searches the room's own corners only when the boundary closes, and skips obstacle edges it
    cannot render; both only warn. Other warnings are passed on.
    """
    import warnings

    from compas_acoustics.hybrid.diffraction import ObstacleEdgeWarning, ShellEdgeWarning

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        yield
    for w in caught:
        if issubclass(w.category, ShellEdgeWarning) and "does not close" in str(w.message):
            note = ("The model does not close, so the room's own corners do not diffract: only the edges of "
                    "free-standing (two-sided) surfaces do.")
        elif issubclass(w.category, (ShellEdgeWarning, ObstacleEdgeWarning)):
            note = f"Diffraction: {w.message}."
        else:
            warnings.warn_explicit(w.message, w.category, w.filename, w.lineno)
            continue
        if note not in notes:
            notes.append(note)


# ─── Diffraction edge selection ───────────────────────────────────────────────

EDGE_MATCH_TOLERANCE_M = 0.02


def edge_excluded(start, end, excluded: np.ndarray, tolerance: float = EDGE_MATCH_TOLERANCE_M) -> bool:
    """Whether the edge ``start``-``end`` lies on one of the ``excluded`` segments ((K, 6) rows): its
    midpoint within ``tolerance`` of the segment and parallel to it. Matching by position survives a
    re-indexing of the edges (a changed weld or merge) and an edge split in two."""
    if len(excluded) == 0:
        return False
    a, b = np.asarray(start, float), np.asarray(end, float)
    mid, axis = (a + b) / 2.0, (b - a) / max(float(np.linalg.norm(b - a)), 1e-12)
    for row in excluded:
        p, q = row[:3], row[3:]
        d = q - p
        length = float(np.linalg.norm(d))
        if length < 1e-9:
            continue
        d = d / length
        if abs(float(axis @ d)) < 0.999:
            continue
        t = float((mid - p) @ d)
        if -tolerance <= t <= length + tolerance and float(np.linalg.norm(mid - (p + t * d))) <= tolerance:
            return True
    return False


@contextmanager
def diffraction_edge_filter(excluded_edges, offset):
    """While in the block, compas_acoustics diffracts at every edge but the excluded ones.

    compas_acoustics has no edge selection: its diffraction (UDFA and BTMS) asks
    ``hybrid.diffraction.diffraction_edges(geometry)`` for the edges of a room, so the filter wraps
    that function. Diffraction runs in this process (only ray tracing is spread over processes).
    """
    rows = np.asarray(excluded_edges or [], dtype=np.float64).reshape(-1, 6)
    if len(rows) == 0:
        yield
        return
    from compas_acoustics.hybrid import diffraction as module

    local = rows - np.concatenate([offset, offset])
    original = module.diffraction_edges

    def filtered(geometry):
        return [e for e in original(geometry) if not edge_excluded(e.start, e.end, local)]

    module.diffraction_edges = filtered
    try:
        yield
    finally:
        module.diffraction_edges = original


# ─── Run ──────────────────────────────────────────────────────────────────────

_NAME_SAFE = re.compile(r"[^a-z0-9_\-.]")


def _ca_name(prefix: str, index: int, app_id: str) -> str:
    """compas_acoustics names are lowercase without spaces; keep the app id readable in logs."""
    return f"{prefix}{index}_{_NAME_SAFE.sub('_', str(app_id).lower())[:40]}"


def _json_safe(value):
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return _json_safe(value.tolist())
    if isinstance(value, (np.floating, float)):
        v = float(value)
        return v if math.isfinite(v) else None
    if isinstance(value, (np.integer, int, bool, str)) or value is None:
        return value.item() if isinstance(value, np.generic) else value
    return str(value)


def band_metrics(ir) -> Optional[dict]:
    """compas_acoustics ``Analyser`` per-band metrics of a response (W channel), JSON-ready."""
    from compas_acoustics import Analyser

    result = Analyser(ir, channel=0).analyse()
    keep = ("frequency_bands", "EDT", "T20", "T30", "C50", "C80", "D50", "DRR", "Ts", "STI")
    out = {k: result[k] for k in result if k in keep or k.endswith("_overall")}
    from compas_acoustics.defaults import Defaults

    out.setdefault("frequency_bands", list(Defaults().DEFAULT_FREQUENCY_BANDS))
    try:
        out["reliability"] = Analyser(ir, channel=0).reliability()
    except Exception:  # noqa: BLE001 - extras only
        pass
    return _json_safe(out)


def _groups(pairs: list[dict]) -> list[list[int]]:
    """Pair indices simulated together: all of them when they form every source x receiver
    combination, else one group per source."""
    sources = {str(p["source_id"]) for p in pairs}
    receivers = {str(p["receiver_id"]) for p in pairs}
    combos = {(str(p["source_id"]), str(p["receiver_id"])) for p in pairs}
    if len(combos) == len(sources) * len(receivers):
        return [list(range(len(pairs)))]
    by_source: dict[str, list[int]] = {}
    for i, p in enumerate(pairs):
        by_source.setdefault(str(p["source_id"]), []).append(i)
    return list(by_source.values())


def build_scene(pairs: list[dict], indices: list[int], offset: np.ndarray, name: str = "scene"):
    """``(scene, source_of, receiver_of)``: the compas_acoustics scene of some pairs, ids -> objects."""
    import compas_acoustics as ca
    from compas.geometry import Vector

    scene = ca.Scene(name=name, sampling_rate=PYROOMACOUSTICS_SAMPLE_RATE)
    source_of: dict[str, Any] = {}
    receiver_of: dict[str, Any] = {}
    for i in indices:
        p = pairs[i]
        s_id, r_id = str(p["source_id"]), str(p["receiver_id"])
        if s_id not in source_of:
            x, y, z = (np.asarray(p["source_position"], float) - offset).tolist()
            directivity = build_pra_directivity(p.get("source_directivity_spec")) or "omnidirectional"
            source = ca.Source(_ca_name("s", len(source_of), s_id), x, y, z, directivity=directivity)
            scene.add_source(source)
            source_of[s_id] = source
        if r_id not in receiver_of:
            x, y, z = (np.asarray(p["receiver_position"], float) - offset).tolist()
            receiver = ca.Receiver(_ca_name("r", len(receiver_of), r_id), x, y, z,
                                   direction=Vector(*LISTENER_FORWARD), up=Vector(*LISTENER_UP))
            scene.add_receiver(receiver)
            receiver_of[r_id] = receiver
    return scene, source_of, receiver_of


def simulate_pairs(
    mesh: SimulationMesh,
    offset: np.ndarray,
    pairs: list[dict],
    settings: EngineSettings,
    progress: Callable[[float, str], None],
) -> EngineRun:
    """One response per pair (in ``pairs`` order) with compas_acoustics.

    ``pairs`` are the app's pair dicts (``source_id``, ``source_position``, ``receiver_id``,
    ``receiver_position``, optional ``source_directivity_spec``); ``progress(fraction, text)``.
    """
    import compas_acoustics as ca
    from compas_acoustics.progress import reporting
    from compas_acoustics.simulation_methods.base import SimulationContext

    progress(0.0, "compas_acoustics: building the room...")
    geometry = room_geometry(mesh, offset)
    method, notes = build_method(settings)
    if settings.ambisonic_order > 0 and not geometry.is_closed:
        notes.append(
            f"The model does not close: the ambisonic late field uses the estimated air volume "
            f"({geometry.volume:.0f} m^3) and treats the openings ({geometry.open_area:.1f} m^2) as fully absorbing."
        )

    groups = _groups(pairs)
    responses: list[PairResponse] = []
    run_generation: dict = {}
    for g, indices in enumerate(groups):
        scene, source_of, receiver_of = build_scene(pairs, indices, offset, f"group{g}")

        base = g / len(groups)
        span = 1.0 / len(groups)
        prefix = f"Group {g + 1}/{len(groups)}: " if len(groups) > 1 else ""

        def report(stage, done, of, _base=base, _span=span, _prefix=prefix):
            inner = (done / of) if (done is not None and of) else 0.0
            text = f"{_prefix}{stage}" + (f" {done}/{of}" if done is not None and of else "")
            progress(min(_base + _span * 0.95 * inner, 0.999), f"compas_acoustics: {text}...")

        progress(base, f"compas_acoustics: {prefix}simulating {len(source_of)} source(s) x {len(receiver_of)} listener(s)...")
        with reporting(report), diffraction_edge_filter(settings.excluded_edges, offset), edge_warnings(notes):
            results = scene.simulate(method, geometry=geometry)

        for i in indices:
            p = pairs[i]
            key = SimulationContext.key(source_of[str(p["source_id"])], receiver_of[str(p["receiver_id"])])
            if key not in results:
                raise RuntimeError(f"compas_acoustics returned no response for '{p['source_id']}' -> '{p['receiver_id']}'")
            ir = results[key]
            rir = np.asarray(ir.denormalized(), dtype=np.float64) * CA_TO_APP_LEVEL_SCALE
            metrics = None
            if CA_BAND_METRICS:
                try:
                    metrics = band_metrics(ir)
                except Exception as exc:  # noqa: BLE001 - extras only
                    print(f"  Warning: compas_acoustics band metrics failed for {p['source_id']}->{p['receiver_id']}: {exc}")
            generation = _json_safe(dict(ir.generation or {}))
            responses.append(PairResponse(pair_index=i, rir=rir, generation=generation, band_metrics=metrics))
            run_generation = generation

    responses.sort(key=lambda r: r.pair_index)
    summary = {k: run_generation.get(k) for k in (
        "method", "tail", "image_source_order", "n_rays", "seed", "diffraction", "air", "speed_of_sound",
        "air_absorption", "reciprocal", "n_jobs", "scattering", "num_delays",
    ) if k in run_generation}
    summary["version"] = getattr(ca, "__version__", None)
    summary["level_scale"] = "1/r (compas_acoustics 1/(4 pi r) x 4 pi)"
    summary["closed"] = bool(geometry.is_closed)
    summary["volume_m3"] = float(geometry.volume)
    summary["sampling_rate"] = PYROOMACOUSTICS_SAMPLE_RATE
    summary["excluded_edges"] = len(settings.excluded_edges or [])
    return EngineRun(responses=responses, notes=notes, generation=summary)
