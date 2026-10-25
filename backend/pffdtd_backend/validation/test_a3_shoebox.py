"""A3: rigid shoebox, long-time phase accuracy vs exact image-source reference.

Room [0,3.2]x[0,2.5]x[0,2.1] m, S (0.90,0.70,1.10), 3 receivers, 150 ms, fmax 500 Hz,
compared on 63-400 Hz after removing the uniform-pressure mode (see shoebox.py).
Accept (user criteria): complex error <= -20 dB in both half-bands, third-octave mean
<= 0.5 dB and max <= 1.6 dB, level within 0.1 dB -- for all three receivers.

PPW sweep (PPW counted at fmax on the Cartesian spacing, PPW = c / (fmax h)):
- Cartesian with walls on cell faces: h = 0.1/k m (k = 2..8 -> PPW 13.7..54.9),
- Cartesian at PPW 10.5 (walls not aligned) as a sanity check vs the -7.7 dB baseline,
- FCC at h = 0.1/k, and single precision at the first passing Cartesian PPW.
The test passes if Cartesian/double meets every criterion at some PPW in the sweep; the
minimum passing PPW and its runtime are reported.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from pffdtd_backend.validation import shoebox as sb

K_CART_FULL = [2, 3, 4, 5, 6, 8]
K_CART_QUICK = [3, 5]
K_FCC_FULL = [3, 5, 8]
K_FCC_QUICK = [5]
SANITY_PPW = 10.5


def run(work_dir: Path, quick: bool = False) -> dict:
    f = np.arange(sb.BAND[0], sb.BAND[1] + sb.DF / 2, sb.DF)
    Href = sb.reference_tf(f)
    cart = [sb.run_shoebox(work_dir, 0.1 / k, False, Href=Href) for k in (K_CART_QUICK if quick else K_CART_FULL)]
    sanity = sb.run_shoebox(work_dir, sb.C_SOUND / (sb.FMAX * SANITY_PPW), False, Href=Href, tag="a3sanity")
    fcc = [sb.run_shoebox(work_dir, 0.1 / k, True, Href=Href) for k in (K_FCC_QUICK if quick else K_FCC_FULL)]
    passing = [r for r in cart if r["pass"]]
    single = sb.run_shoebox(work_dir, passing[0]["h"], False, precision="single", Href=Href) if passing else None
    return {
        "name": "A3 rigid shoebox vs ISM",
        "criteria": "cplx err <= -20 dB both half-bands; 1/3-oct mean <= 0.5, max <= 1.6 dB; level <= 0.1 dB",
        "cartesian": cart,
        "sanity_ppw10_5": sanity,
        "fcc": fcc,
        "single_at_min_ppw": single,
        "min_passing_ppw_cart": passing[0]["ppw_at_500hz"] if passing else None,
        "min_passing_runtime_s": passing[0]["runtime_s"] if passing else None,
        "pass": bool(passing),
    }


@pytest.mark.gpu
def test_a3_shoebox(work_dir, quick):
    result = run(work_dir, quick)
    for r in result["cartesian"] + result["fcc"]:
        print(r["grid"], round(r["ppw_at_500hz"], 1), round(r["worst_cplx_err_db"], 2), r["pass"])
    assert result["pass"], result
