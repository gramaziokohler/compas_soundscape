# backend/services/simulation_preflight_service.py
# Turn a prepared SimulationMesh into user-facing preflight issues.
#
# The geometry checks (sources/receivers, blocked paths, leaks and holes, the
# automatic fixes, image-source cost, units) are compas_acoustics'
# ``geometry.analyze``; this module sets its thresholds from the app's
# constants and adds what depends on the engine: the PFFDTD grid, the
# compas_acoustics output mode, and a pyroomacoustics build without
# two-sided walls.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from compas_acoustics.geometry import Issues, ReportOptions, Seed
from compas_acoustics.geometry import analyze as analyze_geometry

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
    PFFDTD_DEFAULT_DURATION,
    PFFDTD_DEFAULT_FMAX,
    PFFDTD_DEFAULT_PPW,
    PFFDTD_DIRECTIONAL_MAX_RUNS,
    PFFDTD_PHASE_ACCURATE_PPW,
    PFFDTD_SEED_CLEARANCE_CELLS,
    PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS,
    SIM_MESH_INTERIOR_OBJECT_MAX_DEPTH_M,
)
from models.schemas import PreflightIssue
from services.simulation_mesh_service import SimulationMesh
from utils.pffdtd_grid import oblique_area_fraction, plan_grid

ENGINE_PYROOMACOUSTICS = "pyroomacoustics"
ENGINE_PFFDTD = "pffdtd"
ENGINES = (ENGINE_PYROOMACOUSTICS, ENGINE_PFFDTD)

# Appended to the skipped-faces issue when whole objects are unreached: how to leave them out in this app.
_EXCLUDE_UNREACHED_HINT = " Exclude them by removing their material."


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
    pffdtd_fmax: float = PFFDTD_DEFAULT_FMAX
    pffdtd_ppw: float = PFFDTD_DEFAULT_PPW
    pffdtd_duration: float = PFFDTD_DEFAULT_DURATION
    # Directional sources: reciprocal GPU runs (listeners x 4 for FOA); 0 = forward runs per source.
    pffdtd_runs: float = 0.0
    # Free-listener mode cannot radiate directional sources (1.0 = requested anyway).
    pffdtd_directional_free_listener: float = 0.0
    # Geometric engine behind ENGINE_PYROOMACOUSTICS (config.constants.ACOUSTICS_ENGINES) and its output
    geometric_engine: str = "pyroomacoustics"
    simulation_mode: str = "mono"
    diffraction: str = "off"


@dataclass
class PreflightAnalysis:
    issues: list[PreflightIssue]
    enclosure: list[int]                       # enclosure id per seed
    loop_leaking: list[bool]                   # per boundary loop
    blocked_paths: list[dict] = field(default_factory=list)
    seed_surface_distance: list[float] = field(default_factory=list)
    ism_paths_estimate: float = 0.0


def _label(seed: SeedMeta) -> str:
    return f"{seed.kind.capitalize()} '{seed.id}'"


def _report_options(ctx: PreflightContext) -> ReportOptions:
    """compas_acoustics' thresholds from the app's constants; the image-source and ray checks only for the geometric engines."""
    geometric = ctx.engine == ENGINE_PYROOMACOUSTICS
    return ReportOptions(
        image_source_order=int(ctx.max_order) if geometric else 0,
        ray_tracing=bool(geometric and ctx.ray_tracing),
        receiver_radius=PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS,
        surface_error_distance=PREFLIGHT_SURFACE_ERROR_DISTANCE_M,
        leak_warning_fraction=PREFLIGHT_LEAK_WARNING_FRACTION,
        leak_error_fraction=PREFLIGHT_LEAK_ERROR_FRACTION,
        hole_leak_match_distance=PREFLIGHT_HOLE_LEAK_MATCH_DISTANCE_M,
        ism_paths_warning=PREFLIGHT_ISM_PATHS_WARNING,
        ism_paths_error=PREFLIGHT_ISM_PATHS_ERROR,
        model_diagonal_min=PREFLIGHT_MODEL_DIAGONAL_MIN_M,
        model_diagonal_max=PREFLIGHT_MODEL_DIAGONAL_MAX_M,
        max_listed_items=PREFLIGHT_MAX_LISTED_ITEMS,
        max_issue_face_ids=PREFLIGHT_MAX_ISSUE_FACE_IDS,
        interior_object_max_depth=SIM_MESH_INTERIOR_OBJECT_MAX_DEPTH_M,
    )


def _adapt_to_app(out: Issues, ctx: PreflightContext) -> None:
    """Reword the two issues whose remedy depends on the app."""
    for issue in out.items:
        if issue.code == "two_sided_surfaces" and not ctx.two_sided_supported:
            # Stock pra has no Wall.two_sided: the run continues one-sided (see build_room).
            issue.severity, issue.code = "warning", "two_sided_unsupported"
            issue.id = issue.id.replace("two_sided_surfaces", "two_sided_unsupported", 1)
            issue.title = "pyroomacoustics build lacks two-sided walls"
            issue.detail = (f"{len(issue.face_ids)} surface(s) should reflect on both sides; they will be treated as "
                            "one-sided. Rebuild the local pyroomacoustics fork for correct double-sided reflection "
                            "(python setup.py build_ext --inplace).")
            issue.object_ids = []
        elif issue.code == "skipped_faces" and issue.object_ids:
            issue.detail += _EXCLUDE_UNREACHED_HINT


class SimulationPreflightService:
    """Geometry checks shared by the preflight job and the simulation logs."""

    @staticmethod
    def analyze(mesh: SimulationMesh, ctx: PreflightContext) -> PreflightAnalysis:
        options = _report_options(ctx)
        out = Issues(options)
        seeds = [Seed(id=s.id, kind=s.kind, position=list(s.position)) for s in ctx.seeds]
        report = analyze_geometry(mesh, seeds, ctx.pairs, options, out)
        _adapt_to_app(out, ctx)
        if ctx.engine == ENGINE_PFFDTD and len(mesh.faces):
            _pffdtd_checks(mesh, ctx, out, report.seed_surface_distance)
        if ctx.engine == ENGINE_PYROOMACOUSTICS and ctx.geometric_engine == "compas_acoustics" and len(mesh.faces):
            _compas_acoustics_checks(mesh, ctx, out)
        return PreflightAnalysis(
            issues=[PreflightIssue(**issue.to_dict()) for issue in out.items],
            enclosure=report.enclosure,
            loop_leaking=report.loop_leaking,
            blocked_paths=report.blocked_paths,
            seed_surface_distance=report.seed_surface_distance,
            ism_paths_estimate=report.ism_paths_estimate,
        )


def _pffdtd_checks(mesh: SimulationMesh, ctx: PreflightContext, out: Issues, dists: list[float]) -> None:
    """Grid cost, stencil clearance, staircasing and band limit for the PFFDTD engine."""
    pts = mesh.vertices[mesh.faces.ravel()]
    plan = plan_grid(pts.max(axis=0) - pts.min(axis=0), ctx.pffdtd_fmax, ctx.pffdtd_ppw, ctx.pffdtd_duration)
    runs = int(round(ctx.pffdtd_runs))
    per_run = (f"~{plan.est_runtime_s:.0f} s per run, {runs} runs (~{plan.est_runtime_s * runs:.0f} s total)"
               if runs else f"~{plan.est_runtime_s:.0f} s per source")
    cost = (f"{plan.nodes / 1e6:.1f} M grid points (h = {plan.h * 100:.2f} cm), {plan.gpu_bytes / 1e9:.2f} GB "
            f"of {plan.gpu_budget_bytes / 1e9:.1f} GB GPU memory, {per_run}")
    if not plan.fits_gpu:
        out.add("error", "pffdtd_grid_too_large", "Grid does not fit in GPU memory",
                f"{cost}. Lower the max frequency or the points per wavelength (memory depends on "
                "the grid size, not on the IR length).")
    else:
        out.add("info", "pffdtd_grid", "Wave simulation grid", cost + ".")
    if runs > PFFDTD_DIRECTIONAL_MAX_RUNS:
        out.add("error", "pffdtd_directional_too_many_runs", "Too many GPU runs for directional sources",
                f"Directional sources need one run per listener (x4 for FOA): {runs} runs here, limit "
                f"{PFFDTD_DIRECTIONAL_MAX_RUNS}. Use fewer listeners, mono output, or omnidirectional sources.")
    if ctx.pffdtd_directional_free_listener:
        out.add("error", "pffdtd_directional_free_listener", "Free listener cannot radiate directional sources",
                "Free listener positioning runs forward from each source. Switch to Free source, or set the "
                "sources to omnidirectional.")
    clearance = PFFDTD_SEED_CLEARANCE_CELLS * plan.h
    for meta, d in zip(ctx.seeds, dists):
        if d < clearance:
            out.add("error", "pffdtd_seed_clearance", f"{_label(meta)} is too close to a surface for the grid",
                    f"It is {d * 100:.1f} cm from a surface; the wave solver needs {clearance * 100:.1f} cm "
                    f"({PFFDTD_SEED_CLEARANCE_CELLS:g} grid cells). Move it or raise the resolution.",
                    position=[float(x) for x in meta.position])
    oblique = oblique_area_fraction(mesh.normals, mesh.areas)
    if oblique > 0:
        out.add("info", "pffdtd_oblique_walls", f"{oblique:.0%} of the surface is oblique to the grid",
                "Walls not parallel to the x/y/z axes are modelled with conformal cut cells "
                "(second-order accurate, like axis-aligned walls). Zero-thickness two-sided "
                "surfaces are still staircased.")
    out.add("info", "pffdtd_band_limited", f"Impulse response is band-limited to {ctx.pffdtd_fmax:.0f} Hz",
            f"The wave solver resolves frequencies up to the max frequency at "
            f"{plan.ppw_effective:.1f} points per wavelength; phase-accurate long IRs need about "
            f"{PFFDTD_PHASE_ACCURATE_PPW:g}.")


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


def obstacle_faces(mesh: SimulationMesh) -> np.ndarray:
    """compas_acoustics' obstacles (RoomGeometry.from_prepared): the two-sided faces, stored as two walls."""
    from compas_acoustics.geometry import obstacle_mask

    return obstacle_mask(mesh)


def model_closes(mesh: SimulationMesh) -> bool:
    """compas_acoustics' rule (RoomGeometry.from_prepared): the room has one-sided walls and the share of
    reflections that escape is at most its ``CLOSED_LEAK_TOLERANCE`` (acoustic, not topological, closure)."""
    from compas_acoustics.room.geometry import CLOSED_LEAK_TOLERANCE

    has_boundary = bool(np.any(~obstacle_faces(mesh)))
    return has_boundary and float(mesh.visibility.leak_fraction) <= CLOSED_LEAK_TOLERANCE


def _compas_acoustics_checks(mesh: SimulationMesh, ctx: PreflightContext, out) -> None:
    """What the compas_acoustics engine does differently from the legacy pyroomacoustics path.

    Ambisonic late field: topology that does not close is fine when nothing escapes (estimated
    volume, open_area = 0). Warn only when the walk's leak share is high enough that openings
    absorb in the FDN / Eyring tail — same gate as :data:`PREFLIGHT_LEAK_WARNING_FRACTION`.
    """
    ambisonic = ctx.simulation_mode in ("foa", "hoa")
    closes = model_closes(mesh)
    if ambisonic and not closes:
        if mesh.air_volume <= 0:
            out.add("error", "ca_hybrid_no_volume", "Ambisonic output needs an air volume",
                    "The model does not close and no air volume could be estimated from the sources and "
                    "listeners. Close the room, or run in mono.")
        else:
            leak = float(mesh.visibility.leak_fraction) if mesh.visibility is not None else 0.0
            if leak >= PREFLIGHT_LEAK_WARNING_FRACTION:
                out.add("warning", "ca_hybrid_open_model",
                        "Ambisonic late field treats openings as absorbing",
                        f"About {leak:.1%} of reflected sound escapes. The late reverberation uses the "
                        f"estimated air volume ({mesh.air_volume:.0f} m^3, "
                        f"{mesh.air_volume_method.replace('_', ' ')}) and treats those openings as fully "
                        "absorbing, so the decay may be too short. Close the leaks for a reliable tail.")
    if ctx.diffraction == "btms" and not ambisonic:
        out.add("error", "ca_btms_mono", "BTMS diffraction needs ambisonic output",
                "Use UDFA diffraction for mono, or switch the output to FOA/HOA.")
    if ctx.diffraction != "off" and ctx.max_order == 0:
        out.add("info", "ca_diffraction_direct_only", "Diffraction with image-source order 0",
                "Only edges seen from both the source and the listener diffract (first order).")
