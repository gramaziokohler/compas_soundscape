# PFFDTD validation report (2026-10-25)

Engine: vendored PFFDTD with the CUDA engine built natively on Windows (nvcc 12.8 + MSVC,
sm_89). Hardware: RTX 2000 Ada Laptop GPU (8 GB). Runs use double precision unless noted.
c = 343.2 m/s (PFFDTD at 20 °C).

Reproduce:

```
cd backend
python -m pffdtd_backend.validation.run_validation --work-dir <dir>
```

The run takes about 20 minutes. Plots are written to `<dir>/report/*.png`.

Cartesian runs use the **conformal (cut-cell) walls** (`SimSpec.conformal`, default on;
`voxelizer/cut_cells.py`). FCC runs keep the staircase. The numbers below are from the cut-cell
run; the earlier staircase numbers are quoted where they differ.

## Summary

| Test | Result | Key numbers |
| --- | --- | --- |
| B1 CUDA vs numpy engine | **PASS** | max relative difference 3.3e-14 (Cartesian), 3.5e-14 (FCC, folded grid), 5.8e-14 (rotated room, cut cells) |
| A2 rigid unit cube | **Cartesian PASS**, FCC fail | Cartesian rate −2.06 (max Courant) and −2.07 (0.02×). FCC rate −1.37 |
| A1 free-field Gaussian | **rates PASS** | Cartesian −1.95, FCC −1.98 |
| A1 point source 1/(4πr) | Cartesian PASS, FCC fail | worst band level: Cartesian 0.05 dB, FCC 0.13 dB (h = 1/30) |
| A3 rigid shoebox vs ISM | **PASS** (Cartesian) | first pass at PPW 27.5: −23.7 dB, 1/3-oct max 0.24 dB, level 0.05 dB, 2.5 s GPU |
| A4 rotated shoebox | **PASS** (Cartesian) | first pass at PPW 34.3: −27.5 dB (A3: −27.6), 10 s GPU. 2nd order, within 0.22 dB of A3 at every PPW (staircase: −8.6 dB at PPW 82, 1st order) |
| B2 absorbing wall | **PASS** | α_sim vs theory: 0.076/0.086 (250 Hz), 0.205/0.220 (500 Hz) |
| B3 passivity and stability | **PASS** | energy balance 7.1e-15 (aligned), 1.3e-14 (rotated, cut cells); 1 s lossy runs decay 34.0 / 33.9 dB (aligned / rotated, double and single) |

## Details

**A2.** The paper's Gaussian (s = 0.3 m²) in a unit cube is still 0.43 at the walls. The
single Gaussian therefore breaks ∂p/∂n = 0, and its even extension has a kink. With that
initial condition, any scheme stalls at an error floor of about 2e-2; this run measured
1.9e-2 at h = 1/160.

The test uses the Gaussian **plus its wall images** (method of images, Sakamoto 2007). That
field is smooth, compatible with the walls, and has a closed-form 7-mode cosine series. It
is the only reading under which the paper's spectral convergence is possible.

The paper gives no source position, so the cube centre is used. Cartesian errors are
3.9e-2, 8.5e-3, 2.0e-3, 5.0e-4 and 1.25e-4 at h = 1/10 … 1/160: clean 2nd order.

**A3 (Cartesian, walls on cell faces, double).** With walls on cell faces, the cut cells
reduce exactly to the staircase links (bit-identical boundary data), so these numbers did not change.

| PPW @ 500 Hz | Worst complex error | 1/3-oct max | Level | GPU time | Pass |
| --- | --- | --- | --- | --- | --- |
| 10.5 (walls not aligned) | −5.2 dB (staircase: −6.2 dB) | | | | sanity check vs −7.7 dB baseline |
| 13.7 | −12.0 dB | 0.98 dB | 0.17 dB | 2.3 s | no |
| 20.6 | −18.8 dB | 0.39 dB | 0.07 dB | 1.7 s | no |
| **27.5** | **−23.7 dB** | 0.24 dB | 0.05 dB | 2.4 s | **yes** |
| 34.3 | −27.6 dB | 0.13 dB | 0.03 dB | 5.3 s | yes |
| 41.2 | −30.7 dB | 0.14 dB | 0.02 dB | 8.4 s | yes |
| 54.9 | −35.7 dB | 0.10 dB | 0.01 dB | 18.6 s | yes |

Other A3 results:
- FCC fails: −4.3 dB at PPW 55.
- Single precision at PPW 27.5 reaches +10.9 dB, even though it stays stable and decays
  correctly in the lossy B3 run.

**A4 (az 30°, el 20°), worst complex error.** Accept: A3 criteria, and within 1 dB of A3 at
the same PPW.

| Grid | PPW 20.6 | PPW 34.3 | PPW 54.9 | PPW 82.4 |
| --- | --- | --- | --- | --- |
| Cartesian, cut cells | −18.6 dB | **−27.5 dB** | −35.7 dB | −42.8 dB |
| A3 at the same PPW | −18.8 dB | −27.6 dB | −35.7 dB | −42.7 dB |
| Cartesian, staircase (before) | +2.2 dB | −1.1 dB | −5.0 dB | −8.6 dB |
| FCC (staircase) | | +0.2 dB | −3.1 dB | |

- Cartesian passes from **PPW 34.3**: 7.9 M points, 10 s on the GPU. At PPW 20.6 it misses
  −20 dB exactly as A3 does.
- The rate is 2nd order, and the rotated room matches the aligned one within 0.22 dB at every
  PPW (rotation invariance).
- Third-octave bands are within 0.30 dB (mean ≤ 0.08 dB), and the level is within 0.03 dB.
- PPW 82.4 (101 M points, 198 s) reaches −42.8 dB. The −20 dB target therefore needs about
  8 M points instead of the ~5e9 the staircase would need.

### Conformal (cut-cell) walls

`voxelizer/cut_cells.py` and `cut_cell_geom.py` turn the scheme into a finite-volume scheme on
the cut cells:

- **Geometry.** Each cell a wall passes through gets its air volume fraction κ and the open
  fraction β of each face. Both are exact for planar walls (the cell is clipped against the
  wall half-spaces). The fluxes become β·(u_j − u_i) and the update is scaled by 1/κ. Lossy
  walls use the true wall area in the cell, also scaled by 1/κ.
- **Air side.** The air is the grid component that holds the source (flood fill). Cells whose
  node lies outside it but that hold some air join it as small cells, so the air volume on the
  grid equals the mesh volume.
- **Stability.** The energy is positive iff κ ≥ (λ²/2)·Σβ. At the usual maximal Courant
  number many small cells (κ ≲ ½) break this. Three remedies were measured on A4 at PPW 20.6:

  | Remedy for small cells | A4, PPW 20.6 | Order |
  | --- | --- | --- |
  | cap their largest faces (water-filling) | −7.0 dB | ~1.1 |
  | merge them with the neighbour across their largest face | −7.1 dB | ~1 |
  | **lend them volume from cells with spare volume (≤ 6 open faces away)** | **−18.6 dB** | **2** |

  A 1-D analysis explains the first two. With volume κ and inward face β, the effective wall
  sits κh/β from the cell centre, so any face reduction moves it by O(h). On an oblique wall,
  merging joins cells in varying directions, and the flux across the remaining faces no
  longer matches the node spacing. Volume lending changes no face and keeps the total volume
  exact; mass only moves O(h), so it costs O(h²). Over the A4 sweep, at most 168 cells (out of
  10⁵–10⁶ cut cells) found no lender and kept scaled-down faces.
- **Fallbacks to the staircase.** Two-sided surfaces (air on both sides) and cells where the
  walls are neither all convex nor all reflex.
- **Passivity.** The energy is weighted by κ. The B3 energy balance is 1.3e-14 on the rotated
  lossy room, and 1 s runs decay normally in double and single precision.

### Earlier: the voxeliser bug that made A4 worse at PPW 82

- A node within 1e-6·h of a triangle ("near boundary") had all its links cut, but its
  neighbours kept their links to it open. They read a node frozen at 0, which acts as a
  pressure-release point in the wall.
- That broke the rigid uniform mode: the effective volume came out +48% (Cartesian PPW 82)
  and +179% (FCC PPW 55).
- Upstream's guard `nb_check_adj_full` asserts `~(a ^ b)`, which is always truthy.
- Fix (`vox_scene.py`, `compas:`): links are symmetrised after voxelisation, and a working
  symmetry check runs on every prepare.
- After that fix, the staircase converged at exactly 1st order (Δf/f ∝ h: −8369 ppm at
  h = 33 mm, −2074 ppm at 8.3 mm). That equals each wall sitting 0.2–0.4 h too far out. The
  cut cells remove this effect.

## Findings

1. **The port is correct.** Bit-level parity with upstream's numpy engine holds (also with
   cut cells), and energy balance holds to machine precision.
2. **Cartesian, double precision: 2nd order for any wall orientation.**
   - Aligned walls (A3) pass from PPW ≈ 28. That beats the edg-acoustics reference (−20.2 dB).
   - Oblique walls with cut cells (A4) pass from PPW ≈ 34 and match the aligned room. The
     runs take seconds on the laptop GPU.
3. **FCC stays staircased** (cut cells are Cartesian-only): 1st order at every wall, so the
   backend uses Cartesian.
4. **Single precision is not accurate enough for long, lightly damped responses.** It is
   stable, but the backend should default to double: 16 B/node, up to about 400 M nodes on
   8 GB.
5. **Limits of the cut cells.** Two-sided (zero-thickness) surfaces and mixed convex/reflex
   corners fall back to the staircase locally.
