# backend/services/pyroomacoustics_room_builder.py
# Build a pyroomacoustics Room from a prepared SimulationMesh.
#
# The mesh has already been welded, oriented from the air side, classified and
# (optionally) coplanar-merged by SimulationMeshService. This module only maps
# its walls to pra walls: per-band absorption / scattering, two-sided flags and
# a recentring offset (pra stores wall corners in float32, so georeferenced
# coordinates far from the origin lose millimetre precision).

from __future__ import annotations

import numpy as np
import pyroomacoustics as pra

from config.constants import (
    PYROOMACOUSTICS_CUSTOM_MATERIALS,
    PYROOMACOUSTICS_DEFAULT_SCATTERING,
    PYROOMACOUSTICS_SAMPLE_RATE,
    PYROOMACOUSTICS_USE_RAND_ISM,
)
from services.simulation_mesh_service import SimulationMesh, _material_key

# Randomized-ISM displacement (only used when PYROOMACOUSTICS_USE_RAND_ISM).
_RAND_ISM_MAX_DISP_M = 0.05


def pra_supports_two_sided() -> bool:
    return hasattr(pra.libroom.Wall, "two_sided")


def room_offset(mesh: SimulationMesh) -> np.ndarray:
    """Translation applied to geometry AND positions before building the room."""
    if len(mesh.vertices) == 0:
        return np.zeros(3)
    return (mesh.vertices.min(axis=0) + mesh.vertices.max(axis=0)) / 2.0


def _n_bands(fs: int) -> int:
    # Must match the octave bands pra derives from fs (air absorption, filters).
    base = pra.constants.get("octave_bands_base_freq")
    return int(np.floor(np.log2(fs / base)))


def _fit_bands(values, n_bands: int) -> list[float]:
    values = list(values)
    if len(values) < n_bands:
        return values + [values[-1]] * (n_bands - len(values))
    return values[:n_bands]


def _octave_centres(n_bands: int) -> np.ndarray:
    """Centre frequencies of pra's octave bands (base frequency x 2^k)."""
    return float(pra.constants.get("octave_bands_base_freq")) * 2.0 ** np.arange(n_bands)


def _to_octave_bands(coeffs, center_freqs, n_bands: int) -> list[float]:
    """Coefficients given at ``center_freqs`` -> pra's ``n_bands`` octave bands, by frequency.

    Each octave gets the mean of the input bands centred in it (three for 1/3-octave data,
    one for octave data, so octave materials map unchanged); an octave without any gets the
    value interpolated on a log-frequency axis, held constant beyond the given range.
    """
    f = np.asarray(center_freqs, np.float64)
    c = np.asarray(coeffs, np.float64)
    order = np.argsort(f)
    f, c = f[order], c[order]
    out = []
    for fc in _octave_centres(n_bands):
        inside = (f >= fc / np.sqrt(2.0)) & (f < fc * np.sqrt(2.0))
        out.append(float(c[inside].mean()) if inside.any() else float(np.interp(np.log2(fc), np.log2(f), c)))
    return out


def _absorption_bands(material, n_bands: int) -> tuple[list[float], list[float]]:
    """Per-band absorption + the material's own scattering for a material id / coeff dict."""
    value = material
    if isinstance(value, str) and value in PYROOMACOUSTICS_CUSTOM_MATERIALS:
        custom = PYROOMACOUSTICS_CUSTOM_MATERIALS[value]
        value = {"coeffs": custom["coeffs"], "center_freqs": custom["center_freqs"]}
    elif isinstance(value, dict):
        # User materials arrive inlined as {"id", "coeffs", "center_freqs"}; pra takes only the bands.
        value = {"coeffs": value["coeffs"], "center_freqs": value["center_freqs"]}
    mat = pra.Material(energy_absorption=value)
    ea = mat.energy_absorption
    # Map by frequency: taking the first n_bands values would give pra's 125 Hz-16 kHz octaves
    # the lowest bands of finer data (1/3-octave from 20 Hz -> the 20-100 Hz absorption).
    if ea.get("center_freqs") is not None and len(ea["center_freqs"]) == len(ea["coeffs"]):
        absorption = _to_octave_bands(ea["coeffs"], ea["center_freqs"], n_bands)
    else:
        absorption = _fit_bands(ea["coeffs"], n_bands)
    return absorption, _fit_bands(mat.scattering["coeffs"], n_bands)


def build_room(
    mesh: SimulationMesh,
    offset: np.ndarray,
    max_order: int,
    ray_tracing: bool,
    air_absorption: bool,
    sound_speed: float,
) -> pra.Room:
    """
    One pra wall per merged wall (falling back to its triangles when pra
    rejects the polygon as non-planar). Raises RuntimeError when two-sided
    walls are required but the installed pra build does not support them.
    """
    if mesh.two_sided.any() and not pra_supports_two_sided():
        raise RuntimeError(
            f"{int(mesh.two_sided.sum())} surface(s) must reflect on both sides, but the installed "
            "pyroomacoustics build has no two-sided walls. Rebuild the local fork "
            "(python setup.py build_ext --inplace) and restart the CPU worker."
        )
    if not mesh.walls:
        raise RuntimeError("No walls left to simulate (check that surfaces have materials).")

    fs = PYROOMACOUSTICS_SAMPLE_RATE
    n_bands = _n_bands(fs)
    cache: dict[str, tuple[list[float], list[float]]] = {}
    walls = []

    for w_idx, wall in enumerate(mesh.walls):
        f0 = int(wall.faces[0])
        material = mesh.face_material[f0]
        key = _material_key(material)
        if key not in cache:
            cache[key] = _absorption_bands(material, n_bands)
        absorption, scattering = cache[key]
        if ray_tracing:
            s = mesh.face_scattering[f0]
            scattering = [PYROOMACOUSTICS_DEFAULT_SCATTERING if np.isnan(s) else float(s)] * n_bands

        try:
            built = [pra.wall_factory((wall.corners - offset).T, absorption, scattering, f"wall_{w_idx}")]
        except RuntimeError:  # pra rejects the merged polygon as non-planar
            built = [
                pra.wall_factory((mesh.vertices[mesh.faces[f]] - offset).T, absorption, scattering,
                                 f"wall_{w_idx}_{k}")
                for k, f in enumerate(wall.faces)
            ]
        if mesh.two_sided[f0]:
            for pw in built:
                pw.two_sided = True
        walls.extend(built)

    # pra.Room does not accept c= in every version: set it globally meanwhile.
    original_c = pra.constants.get("c")
    pra.constants.set("c", sound_speed)
    try:
        room = pra.Room(
            walls=walls,
            fs=fs,
            max_order=max_order,
            ray_tracing=ray_tracing,
            air_absorption=air_absorption,
            use_rand_ism=PYROOMACOUSTICS_USE_RAND_ISM,
            max_rand_disp=_RAND_ISM_MAX_DISP_M,
        )
    finally:
        pra.constants.set("c", original_c)

    # The ray-traced tail's echo density comes from the room volume. pra's
    # divergence volume is meaningless for open / multi-part meshes, so use
    # the air volume estimated by the mesh preparation (mean free path).
    if ray_tracing and mesh.air_volume_m3 > 0:
        volume = float(mesh.air_volume_m3)
        room.get_volume = lambda: volume
    return room
