"""Fitted wave parameters of a hybrid run (utils/hybrid_wave_fit.py): GPU memory and seed clearance."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.constants import HYBRID_CROSSOVER_STEP_HZ, PFFDTD_SEED_CLEARANCE_CELLS  # noqa: E402
from utils.hybrid_wave_fit import (  # noqa: E402
    OPTION_CONSERVATIVE, OPTION_OPTIMIZED, REASON_CLEARANCE, REASON_GPU, fit_wave,
)

ROOM = [13.72, 9.7256, 4.14]   # the room of the reported "Grid does not fit in GPU memory" run


def _fit(budget_gb, crossover, ppw=20.0, d=0.5, parts="both", precision="double"):
    return fit_wave(ROOM, int(budget_gb * 1e9), precision, parts, crossover, ppw, 1.0, d)


def test_settings_that_run_need_no_adjustment():
    assert _fit(9.9, 1170) is None


def test_grid_too_large_offers_a_lower_crossover_or_a_coarser_grid():
    a = _fit(8.0, 1170)
    assert a.reason == REASON_GPU and a.recommended == a.applied == OPTION_CONSERVATIVE
    low, coarse = a.option(OPTION_CONSERVATIVE), a.option(OPTION_OPTIMIZED)
    assert low.ppw == 20 and low.crossover_hz < 1170 and low.crossover_hz % HYBRID_CROSSOVER_STEP_HZ == 0
    assert coarse.crossover_hz == 1170 and coarse.ppw < 20
    for option in (low, coarse):
        assert option.gpu_gb <= option.budget_gb
        # adopting the option on the card runs it unchanged
        assert _fit(8.0, option.crossover_hz, option.ppw) is None


def test_lowered_crossover_is_the_highest_that_fits():
    low = _fit(8.0, 1170).option(OPTION_CONSERVATIVE)
    assert _fit(8.0, low.crossover_hz + HYBRID_CROSSOVER_STEP_HZ) is not None


def test_seed_near_a_surface_runs_the_finer_grid_and_offers_a_higher_crossover():
    a = _fit(9.9, 300, d=0.06)
    assert a.reason == REASON_CLEARANCE and a.applied == OPTION_CONSERVATIVE
    fine, raised = a.option(OPTION_CONSERVATIVE), a.option(OPTION_OPTIMIZED)
    assert fine.crossover_hz == 300 and fine.run_ppw > 20 and 0.06 >= PFFDTD_SEED_CLEARANCE_CELLS * fine.h
    assert raised.crossover_hz > 300 and raised.ppw == 20 and raised.gpu_gb <= fine.gpu_gb + 1e-6


def test_no_setting_runs_says_what_to_move():
    a = _fit(9.9, 300, d=0.02)
    assert a.options == [] and a.applied is None and "Move the sources and listeners" in a.message


def test_wave_alone_lowers_its_band_top():
    a = _fit(5.0, 1800, d=None, parts="wave")
    low = a.option(OPTION_CONSERVATIVE)
    assert low.wave_fmax == low.crossover_hz < 1800 and "wave band top" in low.label
