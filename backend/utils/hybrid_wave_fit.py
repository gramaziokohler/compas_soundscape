"""Parameters a hybrid card's wave part can run with when the card's own cannot (numpy only).

Two things stop the wave part as set: its grid does not fit the GPU memory free now, or a source /
listener sits so close to a surface that the grid must be refined (``wave_ppw``) — which costs memory
and time, and may itself not fit. Instead of failing, the job runs a fitted set and the card offers
the other one (Run tab), with the values actually used drawn on the Setup tab.

``fit_wave`` returns None when the card's settings run unchanged, else a :class:`WaveAdjustment` with
up to two options, both checked with the solver's own grid plan (``plan_grid``: alignment, GPU
budget) and clearance rule (PFFDTD_SEED_CLEARANCE_CELLS cells):

- **conservative** (recommended): keeps the wave part's accuracy. Grid too large: the card's points
  per wavelength, the crossover lowered to the highest value that fits. Seed near a surface: the
  card's crossover on the refined grid (what ``wave_ppw`` already did).
- **optimized**: keeps more of the band in the wave solver. Grid too large: the card's crossover,
  the points per wavelength lowered to the highest that fits (not below HYBRID_WAVE_FIT_PPW_MIN).
  Seed near a surface: the refined grid already resolves a higher crossover at the card's points
  per wavelength, for the same memory, so the crossover is raised to it.

When neither fits in the card's precision and it is double, single precision (half the memory per
node) is tried. No option at all: the adjustment has none and its message says what to change.
Each option carries the card settings to adopt (``crossover_hz``, ``ppw``, ``precision``): running
them again makes ``fit_wave`` return None or the same grid.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Optional

import numpy as np

from config.constants import (
    HYBRID_CROSSOVER_MAX_HZ,
    HYBRID_CROSSOVER_MIN_HZ,
    HYBRID_CROSSOVER_STEP_HZ,
    HYBRID_PARTS_WAVE,
    HYBRID_WAVE_FIT_PPW_MIN,
    HYBRID_WAVE_FMAX_MARGIN,
    HYBRID_WAVE_MAX_CELL_M,
    HYBRID_WAVE_SEED_CLEARANCE_MARGIN,
    PFFDTD_FMAX_MAX,
    PFFDTD_FMAX_MIN,
    PFFDTD_PPW_MAX,
    PFFDTD_SEED_CLEARANCE_CELLS,
    PFFDTD_SPEED_OF_SOUND,
)
from utils.hybrid_crossover import wave_ppw
from utils.pffdtd_grid import plan_grid

OPTION_CONSERVATIVE = "conservative"
OPTION_OPTIMIZED = "optimized"
REASON_GPU = "gpu"
REASON_CLEARANCE = "clearance"
_EPS = 1e-9


@dataclass
class WaveGrid:
    """The wave part of one card setting: what the job would run and whether it can."""
    crossover_hz: float      # the card's handle (crossover; the wave band's top when the wave runs alone)
    ppw: float               # the card's points per wavelength
    precision: str
    wave_fmax: float
    run_ppw: float           # after the clearance / cell-size refinement (wave_ppw)
    h: float
    gpu_bytes: int
    budget_bytes: int
    runtime_s: float
    clear: bool              # every source / listener at least the solver's clearance from a surface

    @property
    def fits(self) -> bool:
        return self.gpu_bytes <= self.budget_bytes

    @property
    def ok(self) -> bool:
        return self.fits and self.clear


@dataclass
class WaveOption:
    key: str
    label: str
    detail: str
    crossover_hz: float
    ppw: float
    precision: str
    wave_fmax: float
    run_ppw: float
    h: float
    gpu_gb: float
    budget_gb: float
    runtime_s: float


@dataclass
class WaveAdjustment:
    reason: str
    message: str
    requested: dict
    options: list = field(default_factory=list)
    recommended: Optional[str] = None
    applied: Optional[str] = None

    def option(self, key: Optional[str]) -> Optional[WaveOption]:
        return next((o for o in self.options if o.key == key), None)

    def as_dict(self) -> dict:
        return asdict(self)


def wave_fmax_for(crossover_hz: float, parts: str) -> float:
    """Top frequency of the wave run for a handle value (as plan_crossover / wave_only_fmax)."""
    margin = 1.0 if parts == HYBRID_PARTS_WAVE else HYBRID_WAVE_FMAX_MARGIN
    return float(np.clip(round(crossover_hz * margin, 2), PFFDTD_FMAX_MIN, PFFDTD_FMAX_MAX))


class _Planner:
    def __init__(self, extents, budget_bytes: int, parts: str, duration: float, min_seed_distance: Optional[float]):
        self.extents = np.asarray(extents, np.float64)
        self.budget = int(budget_bytes)
        self.parts = parts
        self.duration = float(duration)
        d = min_seed_distance
        self.d = float(d) if d is not None and np.isfinite(d) and d > 0 else None

    def grid(self, crossover_hz: float, ppw: float, precision: str) -> WaveGrid:
        fmax = wave_fmax_for(crossover_hz, self.parts)
        run_ppw, _ = wave_ppw(ppw, fmax, self.d)
        plan = plan_grid(self.extents, fmax, run_ppw, self.duration, precision=precision, gpu_budget_bytes=self.budget)
        clear = self.d is None or self.d + _EPS >= PFFDTD_SEED_CLEARANCE_CELLS * plan.h
        return WaveGrid(float(crossover_hz), float(ppw), precision, fmax, float(run_ppw), plan.h, plan.gpu_bytes,
                        plan.gpu_budget_bytes, plan.est_runtime_s, clear)

    def seed_refined(self, g: WaveGrid) -> bool:
        """The grid was refined beyond the card's points per wavelength for a source / listener near a surface."""
        if self.d is None or g.run_ppw <= g.ppw + _EPS:
            return False
        cell = min(PFFDTD_SPEED_OF_SOUND / (g.wave_fmax * g.ppw), HYBRID_WAVE_MAX_CELL_M)
        return self.d / (PFFDTD_SEED_CLEARANCE_CELLS * HYBRID_WAVE_SEED_CLEARANCE_MARGIN) < cell

    def lower_crossover(self, x0: float, ppw: float, precision: str) -> Optional[WaveGrid]:
        """Highest crossover on the card's step, at most ``x0``, whose grid runs."""
        steps = list(_steps_down(x0))
        lo, hi = 0, len(steps) - 1          # memory falls as the crossover falls: find the first that runs
        if not self.grid(steps[hi], ppw, precision).ok:
            return None
        while lo < hi:
            mid = (lo + hi) // 2
            if self.grid(steps[mid], ppw, precision).ok:
                hi = mid
            else:
                lo = mid + 1
        return self.grid(steps[lo], ppw, precision)

    def lower_ppw(self, x0: float, ppw: float, precision: str) -> Optional[WaveGrid]:
        """Highest whole points per wavelength below ``ppw`` (not below the fit minimum) whose grid runs."""
        top = math.ceil(ppw - 1.0 - _EPS)
        for p in range(int(top), int(math.ceil(HYBRID_WAVE_FIT_PPW_MIN)) - 1, -1):
            g = self.grid(x0, float(p), precision)
            if g.ok:
                return g
        return None


def _steps_down(x0: float):
    """``x0`` then the crossover step values below it, down to the minimum."""
    yield float(x0)
    x = math.floor((x0 - _EPS) / HYBRID_CROSSOVER_STEP_HZ) * HYBRID_CROSSOVER_STEP_HZ
    while x >= HYBRID_CROSSOVER_MIN_HZ - _EPS:
        if x < x0 - _EPS:
            yield float(x)
        x -= HYBRID_CROSSOVER_STEP_HZ


def _option(key: str, g: WaveGrid, label: str, detail: str) -> WaveOption:
    return WaveOption(
        key=key, label=label, detail=detail,
        crossover_hz=round(g.crossover_hz, 2), ppw=round(g.ppw, 2), precision=g.precision,
        wave_fmax=round(g.wave_fmax, 2), run_ppw=round(g.run_ppw, 1), h=round(g.h, 5),
        gpu_gb=round(g.gpu_bytes / 1e9, 2), budget_gb=round(g.budget_bytes / 1e9, 2), runtime_s=round(g.runtime_s, 1),
    )


def _cost(g: WaveGrid) -> str:
    return f"{g.gpu_bytes / 1e9:.1f} of {g.budget_bytes / 1e9:.1f} GB, ~{g.runtime_s:.0f} s per run"


def _precision_note(g: WaveGrid, requested: str) -> str:
    return f", {g.precision} precision" if g.precision != requested else ""


def fit_wave(
    extents,
    budget_bytes: int,
    precision: str,
    parts: str,
    crossover_hz: float,
    ppw: float,
    duration: float,
    min_seed_distance: Optional[float] = None,
) -> Optional[WaveAdjustment]:
    """None when the card's wave part runs as set; else the fitted options (see the module doc)."""
    planner = _Planner(extents, budget_bytes, parts, duration, min_seed_distance)
    req = planner.grid(crossover_hz, ppw, precision)
    requested = {"crossover_hz": round(float(crossover_hz), 2), "ppw": float(ppw), "precision": precision}
    band = "wave band top" if parts == HYBRID_PARTS_WAVE else "crossover"
    d_cm = None if planner.d is None else planner.d * 100

    if req.ok and not planner.seed_refined(req):
        return None   # runs as set (a refinement to HYBRID_WAVE_MAX_CELL_M cells stays a run note)

    if req.ok:
        # Only refined for a source / listener near a surface: it runs; the finer grid also resolves more band
        conservative = _option(
            OPTION_CONSERVATIVE, req, f"Keep the {band} at {req.crossover_hz:.0f} Hz on the finer grid",
            f"{req.run_ppw:.0f} points per wavelength ({req.h * 100:.2f} cm cells), {_cost(req)}",
        )
        options = [conservative]
        raised = _raise_on_grid(planner, req, ppw, precision)
        if raised is not None:
            options.append(_option(
                OPTION_OPTIMIZED, raised, f"Raise the {band} to {raised.crossover_hz:.0f} Hz",
                f"The finer grid resolves it at {ppw:g} points per wavelength: same memory, more of the band "
                f"from the wave solver ({_cost(raised)})",
            ))
        return WaveAdjustment(
            reason=REASON_CLEARANCE,
            message=(f"A source or listener {d_cm:.0f} cm from a surface needs cells of at most "
                     f"{req.h * 100:.2f} cm: the wave grid runs at {req.run_ppw:.0f} instead of {ppw:g} points "
                     f"per wavelength."),
            requested=requested, options=options, recommended=OPTION_CONSERVATIVE, applied=OPTION_CONSERVATIVE,
        )

    reason = REASON_GPU if not req.fits else REASON_CLEARANCE
    options: list[WaveOption] = []
    precisions = [precision] + (["single"] if precision == "double" else [])
    for prec in precisions:
        low = planner.lower_crossover(crossover_hz, ppw, prec)
        if low is not None and low.crossover_hz < crossover_hz - _EPS:
            options.append(_option(
                OPTION_CONSERVATIVE, low,
                f"Lower the {band} to {low.crossover_hz:.0f} Hz",
                f"Keeps {ppw:g} points per wavelength{_precision_note(low, precision)}: the band above it goes to "
                f"the rays ({_cost(low)})" if parts != HYBRID_PARTS_WAVE else
                f"Keeps {ppw:g} points per wavelength{_precision_note(low, precision)} ({_cost(low)})",
            ))
        coarse = planner.lower_ppw(crossover_hz, ppw, prec) if ppw > HYBRID_WAVE_FIT_PPW_MIN else None
        if coarse is None and prec != precision:
            same = planner.grid(crossover_hz, ppw, prec)
            coarse = same if same.ok else None
        if coarse is not None:
            options.append(_option(
                OPTION_OPTIMIZED, coarse,
                f"Keep the {band} at {crossover_hz:.0f} Hz with {coarse.ppw:g} points per wavelength",
                f"Coarser grid{_precision_note(coarse, precision)}: more of the band from the wave solver, less "
                f"accurate phase ({_cost(coarse)})",
            ))
        if options:
            break

    if reason == REASON_GPU:
        message = (f"The wave grid at {crossover_hz:.0f} Hz and {ppw:g} points per wavelength needs "
                   f"{req.gpu_bytes / 1e9:.1f} GB of GPU memory, {req.budget_bytes / 1e9:.1f} GB available.")
        if planner.d is not None and req.run_ppw > ppw + _EPS:
            message += f" A source or listener {d_cm:.0f} cm from a surface already refines it to {req.run_ppw:.0f}."
    else:
        message = (f"A source or listener {d_cm:.0f} cm from a surface needs at least "
                   f"{PFFDTD_SEED_CLEARANCE_CELLS:g} grid cells of clearance; the {PFFDTD_PPW_MAX:g} points per "
                   f"wavelength the grid may use give {req.h * 100:.2f} cm cells.")
    if not options:
        message += " " + _no_option_hint(planner, req, precision)
    recommended = OPTION_CONSERVATIVE if any(o.key == OPTION_CONSERVATIVE for o in options) else (
        options[0].key if options else None)
    return WaveAdjustment(reason=reason, message=message, requested=requested, options=options,
                          recommended=recommended, applied=recommended)


def _raise_on_grid(planner: _Planner, req: WaveGrid, ppw: float, precision: str) -> Optional[WaveGrid]:
    """The highest handle value whose grid at the card's ``ppw`` is no finer than ``req``'s (same memory)."""
    margin = 1.0 if planner.parts == HYBRID_PARTS_WAVE else HYBRID_WAVE_FMAX_MARGIN
    fmax = min(PFFDTD_SPEED_OF_SOUND / (req.h * ppw), PFFDTD_FMAX_MAX)
    top = min(fmax / margin, HYBRID_CROSSOVER_MAX_HZ)
    x = math.floor(top / HYBRID_CROSSOVER_STEP_HZ + _EPS) * HYBRID_CROSSOVER_STEP_HZ
    while x >= req.crossover_hz + HYBRID_CROSSOVER_STEP_HZ - _EPS:
        g = planner.grid(x, ppw, precision)
        if g.ok and g.gpu_bytes <= req.gpu_bytes * (1.0 + 1e-6):
            return g
        x -= HYBRID_CROSSOVER_STEP_HZ
    return None


def _no_option_hint(planner: _Planner, req: WaveGrid, precision: str) -> str:
    """What to change when no setting runs: the seed distance the finest grid that fits allows."""
    if planner.d is not None and req.run_ppw > req.ppw + _EPS:
        # coarsest clearance grid that fits: scan the cell size up from the requested grid's
        h = req.h
        for _ in range(200):
            h *= 1.02
            fmax = req.wave_fmax
            plan = plan_grid(planner.extents, fmax, PFFDTD_SPEED_OF_SOUND / (fmax * h), planner.duration,
                             h=h, precision="single" if precision == "double" else precision,
                             gpu_budget_bytes=planner.budget)
            if plan.fits_gpu:
                need = PFFDTD_SEED_CLEARANCE_CELLS * HYBRID_WAVE_SEED_CLEARANCE_MARGIN * h
                return (f"Move the sources and listeners at least {need * 100:.0f} cm from every surface, "
                        f"or switch the wave part off.")
        return "Move the sources and listeners further from the surfaces, or switch the wave part off."
    return "Lower the crossover or the points per wavelength, or switch the wave part off."
