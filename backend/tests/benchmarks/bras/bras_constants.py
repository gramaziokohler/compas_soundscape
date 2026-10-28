"""Generic settings of the BRAS benchmark (scene inputs and band tests live in scenes.py)."""
from __future__ import annotations

import os
from pathlib import Path

from config.constants import BACKEND_DIR

# ── Measurements ──────────────────────────────────────────────────────────────
ANALYSIS_FS = 44100                             # every BRAS IR; the simulation is resampled to it
ONSET_TOL_S = 0.3e-3                            # measured onset vs geometry (positioning <= 5.5 cm)
SOURCE_AIM_TOL_DEG = 1.0                        # aim point vs BRAS orientation labels

# ── Simulation ────────────────────────────────────────────────────────────────
AIR_ABSORPTION = True
SIMULATION_MODE = "mono"
DIRECTIVITY_STEP_DEG = 5                        # BRAS 1 deg balloon kept every 5 deg (as the app's import)
# corner markers of the empty-domain control run: plate-thick boxes, >= 2 cells across at every
# stage so they own boundary nodes (a scene with none crashes the cut cells), tiny vs a wavelength
CONTROL_MARKER_EDGE_M = 0.05
GROUND_BELOW_CELLS = 2                          # domain extends this many cells under a ground plane
GROUND_INSET_CELLS = 1                          # ground plane stops this far inside the domain faces

# ── Analysis ──────────────────────────────────────────────────────────────────
FADE_IN_S = 0.001
FADE_OUT_S = 0.002
DIRECT_WINDOW_S = 0.004                         # direct sound only: global gain and direct-level residual
EDGE_SUBTRACT_KEEP_S = 0.005                    # control run kept this long after its last physical arrival
PLOT_FMIN_HZ = 50.0
NFFT = 2 ** 15
XCORR_MAX_LAG_S = 0.5e-3                        # direct-sound alignment search

# ── Sanity checks of the benchmark tests (not acceptance criteria) ────────────
DIRECT_LEVEL_TOL_DB = 2.0                       # line-of-sight pairs, after the global gain
DIRECT_LEVEL_MAX_OFFAXIS_DEG = 90.0

# ── Run selection (environment) ───────────────────────────────────────────────
ENV_FMAX = "BRAS_FMAX"                          # one stage of the scene's band test (default: the first)
ENV_PPW = "BRAS_PPW"                            # override the stage's points per wavelength
ENV_PAIRS = "BRAS_PAIRS"                        # "LS1-MP1,LS4-MP4" (default: the scene's smoke pairs)
ENV_FULL = "BRAS_FULL"                          # 1 = every measured pair
ENV_OMNI = "BRAS_OMNI"                          # 1 = omnidirectional loudspeakers
ENV_MATERIAL = "BRAS_MATERIAL"                  # csv (default) | rigid
ENV_FORCE = "BRAS_FORCE"                        # 1 = ignore cached simulations
ENV_ANIMATION = "BRAS_ANIMATION"                # off | a loudspeaker id (default: the scene's)
ENV_SOURCE_PHASE = "BRAS_SOURCE_PHASE"          # on (default) | off
MATERIAL_MODES = ("csv", "rigid")

# ── Wave animation (omni pulse, the app's on-demand animation mode) ───────────
ANIMATION_DIR = "animation"
ANIMATION_REMOVE_EDGE_ECHOES = True             # subtract an empty-domain control animation's edge echoes
ANIMATION_PULSE_PERIODS_PER_FMAX = 1.5          # mirror of pffdtd_backend.fields.PULSE_PERIODS_PER_FMAX
ANIMATION_DIRECT_KEEP_PERIODS = 4.0             # control kept this long after its last physical front
ANIMATION_PREVIEW_FRAMES = 6
ANIMATION_FPS = 20
ANIMATION_DPI = 110

# ── Loudspeaker phase on the simulated IRs ────────────────────────────────────
# The solver's directional source is zero-phase (per-band magnitudes only); the measured IRs carry
# the loudspeaker's phase (crossover, low-frequency group delay). A phase-only filter from the
# on-axis IR of the directivity file (bulk delay removed) gives the simulated IRs that phase.
SOURCE_PHASE_NFFT = 8192                        # all-pass FIR length at 44.1 kHz (the BRAS IR has 4096 taps)
SOURCE_PHASE_PRE_S = 0.002                      # pre-ringing room kept before the loudspeaker's main peak
SOURCE_PHASE_FLOOR_DB = -60.0                   # below this |H| (re max) the phase is noise: left at 0

# ── Outputs ───────────────────────────────────────────────────────────────────
# outside the repository (a sibling folder of compas_soundscape), so runs and caches never touch git
OUTPUT_ROOT = Path(os.environ.get("BRAS_OUTPUT_ROOT", BACKEND_DIR.parent.parent / "compas_soundscape_benchmarks" / "bras"))
CACHE_DIR = OUTPUT_ROOT / "_cache"                  # directivity balloons, loudspeaker phase (<scene>/ beside it)
