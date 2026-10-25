"""A4: A3 rotated by azimuth 30 deg and elevation 20 deg about the room centre.

Geometry, source and receivers are rotated together; the reference is the same ISM in the
box frame (rotation invariance). The walls are now staircased on the grid.
Accept: A3 criteria, and the worst complex error within 1 dB of A3's at the same PPW.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from pffdtd_backend.validation import shoebox as sb
from pffdtd_backend.validation.scenes import rotation_az_el

AZ_DEG = 30.0
EL_DEG = 20.0
K_CART_FULL = [3, 5, 8, 12]
K_CART_QUICK = [3, 5]
K_FCC_FULL = [5, 8]
K_FCC_QUICK = [5]
INVARIANCE_TOL_DB = 1.0


def run(work_dir: Path, quick: bool = False) -> dict:
    f = np.arange(sb.BAND[0], sb.BAND[1] + sb.DF / 2, sb.DF)
    Href = sb.reference_tf(f)
    R = rotation_az_el(AZ_DEG, EL_DEG)
    out = {}
    for grid, ks in (("cart", K_CART_QUICK if quick else K_CART_FULL), ("fcc", K_FCC_QUICK if quick else K_FCC_FULL)):
        rows = []
        for k in ks:
            r = sb.run_shoebox(work_dir, 0.1 / k, grid == "fcc", rotation=R, tag="a4", Href=Href)
            a3 = sb.run_shoebox(work_dir, 0.1 / k, grid == "fcc", Href=Href)  # cached if A3 ran this PPW
            r["a3_worst_cplx_err_db"] = a3["worst_cplx_err_db"]
            r["invariance_db"] = r["worst_cplx_err_db"] - a3["worst_cplx_err_db"]
            r["pass"] = r["pass"] and abs(r["invariance_db"]) <= INVARIANCE_TOL_DB
            rows.append(r)
        out[grid] = rows
    passing = [r for r in out["cart"] + out["fcc"] if r["pass"]]
    return {
        "name": "A4 rotated shoebox (az 30, el 20)",
        "criteria": f"A3 criteria and |worst cplx err - A3| <= {INVARIANCE_TOL_DB} dB",
        "cartesian": out["cart"],
        "fcc": out["fcc"],
        "pass": bool(passing),
    }


@pytest.mark.gpu
def test_a4_rotated(work_dir, quick):
    result = run(work_dir, quick)
    for r in result["cartesian"] + result["fcc"]:
        print(r["grid"], round(r["ppw_at_500hz"], 1), round(r["worst_cplx_err_db"], 2), round(r["invariance_db"], 2), r["pass"])
    assert result["pass"], result
