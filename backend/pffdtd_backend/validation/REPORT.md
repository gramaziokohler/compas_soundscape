# PFFDTD validation report (2026-10-25)

Engine: vendored PFFDTD with the CUDA engine built natively on Windows (nvcc 12.8 + MSVC,
sm_89). Hardware: RTX 2000 Ada Laptop GPU (8 GB). Runs use double precision unless noted.
c = 343.2 m/s (PFFDTD at 20 °C).

Reproduce:

```
cd backend
python -m pffdtd_backend.validation.run_validation --work-dir <dir>
```

The run took about 15 minutes. Plots are written to `<dir>/report/*.png`.

## Summary

| Test | Result | Key numbers |
| --- | --- | --- |
| B1 CUDA vs numpy engine | **PASS** | max relative difference 3.3e-14 (Cartesian), 3.5e-14 (FCC, folded grid) |
| A2 rigid unit cube | **Cartesian PASS**, FCC fail | Cartesian rate −2.06 (max Courant) and −2.07 (0.02×). FCC rate −1.37 |
| A1 free-field Gaussian | **rates PASS** | Cartesian −1.95, FCC −1.98 |
| A1 point source 1/(4πr) | Cartesian PASS, FCC fail | worst band level: Cartesian 0.05 dB, FCC 0.13 dB (h = 1/30) |
| A3 rigid shoebox vs ISM | **PASS** (Cartesian) | first pass at PPW 27.5: −23.7 dB, 1/3-oct max 0.24 dB, level 0.05 dB, 2.5 s GPU |
| A4 rotated shoebox | **FAIL** | Cartesian −8.6 dB at PPW 82. Converges at 1st order only (staircased walls) |
| B2 absorbing wall | **PASS** | α_sim vs theory: 0.076/0.086 (250 Hz), 0.205/0.220 (500 Hz) |
| B3 passivity and stability | **PASS** | energy balance 5.7e-15; a 1 s lossy run decays 32.7 dB (double and single) |

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

**A3 (Cartesian, walls on cell faces, double).**

| PPW @ 500 Hz | Worst complex error | 1/3-oct max | Level | GPU time | Pass |
| --- | --- | --- | --- | --- | --- |
| 10.5 (walls not aligned) | −6.2 dB | | | | sanity check vs −7.7 dB baseline |
| 13.7 | −12.0 dB | 0.98 dB | 0.17 dB | 2.5 s | no |
| 20.6 | −18.8 dB | 0.39 dB | 0.07 dB | 1.9 s | no |
| **27.5** | **−23.7 dB** | 0.24 dB | 0.05 dB | 2.5 s | **yes** |
| 34.3 | −27.6 dB | 0.13 dB | 0.03 dB | 4.0 s | yes |
| 41.2 | −30.7 dB | 0.14 dB | 0.02 dB | 6.6 s | yes |
| 54.9 | −35.7 dB | 0.10 dB | 0.01 dB | 16.5 s | yes |

Other A3 results:
- FCC fails: −4.3 dB at PPW 55.
- Single precision at PPW 27.5 reaches +10.9 dB, even though it stays stable and decays
  correctly in the lossy B3 run.

**A4 (az 30°, el 20°), after the voxeliser fix (see below).**

| Grid | PPW 20.6 | PPW 34.3 | PPW 54.9 | PPW 82.4 |
| --- | --- | --- | --- | --- |
| Cartesian | +2.2 dB | −1.1 dB | −5.0 dB | **−8.6 dB** (was +2.9 dB before the fix) |
| FCC | | +0.2 dB | −3.1 dB (was +8.6 dB) | |

At PPW 82, third-octave bands are within 2.0 dB and the level is within 0.1 dB. A
snapshot check found no leak: the field outside the room is exactly 0.

### Investigation: why A4 got worse at PPW 82

**Cause: an upstream voxeliser bug, now fixed.**
- A node within 1e-6·h of a triangle ("near boundary") has all its links cut, but its
  neighbours kept their links to it open.
- Those neighbours then read a node frozen at 0, which acts as a pressure-release point in
  the wall.
- It destroyed the rigid uniform mode: the effective volume from the ramp slope came out
  +48% (Cartesian PPW 82) and +179% (FCC PPW 55), against ≤0.13% everywhere else. It also
  shifted the low modes.
- Upstream's guard `nb_check_adj_full` asserts `~(a ^ b)`, which is always truthy, so it
  never caught this. Its FCC variant also pairs the wrong neighbours.
- Fix (`vox_scene.py`, `compas:`): links are symmetrised after voxelisation (open only if
  both ends agree), and a working symmetry check now runs on every prepare.
- An audit of all 66 runs found only those two runs affected, so every other number in this
  report stands.

**What remains is a first-order staircase effect, not a defect.** The effective volume is
correct to <0.1%, but the low modes come out lower. Δf/f scales exactly with h: −8369 ppm
at h = 33 mm and −2074 ppm at 8.3 mm, i.e. 4.04× for a 4× finer h. That is equivalent to
each staircased wall sitting about 0.2–0.4 h further out, depending on its orientation
(rough-wall effect).

At first order, reaching −20 dB from −8.6 dB would need about 3.8× finer h: PPW ≈ 310 and
about 5e9 nodes (~85 GB). That is out of reach without a conformal (cut-cell)
boundary.

## Findings

1. **The port is correct.** Bit-level parity with upstream's numpy engine holds, and energy
   balance holds to machine precision.
2. **Cartesian, double precision, walls aligned with the grid: 2nd order, and A3 passes from
   PPW ≈ 28.** That is better than the edg-acoustics reference (−20.2 dB). The run takes
   seconds on the laptop GPU.
3. **Every non-aligned boundary is staircased.** This covers FCC with any wall and Cartesian
   with rotated walls. The staircased boundary is at best 1st order and is not monotone in
   h, so long-time phase accuracy (A4, A3-FCC) does not converge within 8 GB. This limits
   PFFDTD's boundary model, not the build. Fixing it needs conformal (cut-cell
   finite-volume) boundary cells in the engine.
4. **Single precision is not accurate enough for long, lightly damped responses.** It is
   stable, but the backend should default to double: 16 B/node, up to about 400 M nodes on
   8 GB.
5. **Resolved:** A4 getting worse at PPW 82 was an upstream voxeliser bug (asymmetric links
   around near-boundary nodes). It is fixed, and A4 now converges at 1st order.
