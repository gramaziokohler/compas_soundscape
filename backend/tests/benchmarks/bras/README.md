# BRAS reference-scene benchmark of the PFFDTD pipeline

Compares the app's PFFDTD wave solver with the measured impulse responses of the
[BRAS](https://doi.org/10.14279/depositonce-6726.3) reference scenes (RS1-RS7: anechoic and
hemi-anechoic chambers, Genelec 8020c loudspeakers, free-field microphones). The simulation goes
through the real worker entry point (`services.pffdtd_job.run_pffdtd_simulation_from_geometry`):
mesh preparation, preflight, scene export, the compas-pffdtd pipeline and WAVs.

## 1. Link the input files: `scenes.py`

Every input of a scene is linked in [`scenes.py`](scenes.py), and nothing else needs to change for a
new scene. Copy an entry of `SCENES` and set:

| Field | What to link / set |
| --- | --- |
| `geometry.obj` | OBJ of the objects only (plate, wedge, blocks...). `up_axis="y"` for SketchUp / Rhino exports |
| `materials` | OBJ material (`usemtl`) or group name, as a pattern, mapped to a BRAS material CSV. `"*"` covers the rest. Several materials are fine, e.g. `{"*RockFon*": ROCKFON, "*": MDF_25MM}` |
| `measurements` | SOFA GeneralFIR (`RS*_RIRs_*.sofa`): measured IRs plus every source and receiver position |
| `source` | Directivity file (BRAS `*_IR_front_pole.csv` or SOFA) and the loudspeaker orientations: `aim_point`, or `orientations={"LS1": (phi, theta)}` from the scene description |
| `ground` | Hemi-anechoic chambers (RS1, RS5-RS7): a reflective floor spanning the whole domain, with its material key |
| `temperature_c`, `humidity` | Chamber conditions (the speed of sound for the measured arrivals) |
| `band_test` | See below |
| `gain_pair`, `smoke_pairs`, `animation` | Level calibration pair, default pairs, animated loudspeaker and highlighted microphone |

`BRAS_ROOT` relocates the database; `python -m benchmarks.bras.bras_benchmark --list` shows the
scenes and any missing file. The RS2 entries other than `RS2_1m_rigid` need their OBJs exported
from the `.skp` files first, with one material per surface type.

## 2. Define the frequency-band test: `BandTest`

| Field | Meaning (RS2 setting) |
| --- | --- |
| `stages` | fmax (Hz) to points per wavelength, one simulation per stage (`{500: 27.456, 2500: 10}`) |
| `fmin_hz`, `fmax_fraction` | Compared band: `fmin_hz` to `fmax_fraction` x fmax (125 Hz to 2 kHz at the 2.5 kHz stage) |
| `bands_per_octave` | Level-difference bands: 3 = third octaves, 1 = octaves |
| `smoothing_fraction` | Frequency-response curves, 1/N octave (12) |
| `pre_ms`, `gate_ms` | Analysis window around the direct sound (2 ms before, 17 ms after) |
| `duration_s` | Simulated IR length (0.05 s) |
| `padding_m` | Free air per stage, overriding `Scene.padding_m` (2.5 m at 2.5 kHz to fit the 8 GB GPU) |

## 3. Run (from `backend/`, compas-toy python)

```bash
python -m pytest tests/benchmarks/bras -m bras_benchmark -s
```

```bash
BRAS_SCENE=RS2_1m_rigid BRAS_FMAX=2500 BRAS_FULL=1 python -m pytest tests/benchmarks/bras -m bras_benchmark -s
```

| Variable | Effect |
| --- | --- |
| `BRAS_SCENE` | Scene name in `scenes.py` (default `RS2_1m_rigid`) |
| `BRAS_FMAX` | One stage of the band test (default: the first) |
| `BRAS_FULL=1` / `BRAS_PAIRS=LS1-MP1,...` | Every measured pair / explicit pairs (default: the scene's smoke pairs) |
| `BRAS_MATERIAL=rigid`, `BRAS_OMNI=1` | Rigid surfaces / omnidirectional loudspeakers |
| `BRAS_ANIMATION=off` or `=LS3` | Skip the animation / animate another loudspeaker |
| `BRAS_SOURCE_PHASE=off` | Compare the zero-phase solver output |
| `BRAS_FORCE=1` | Ignore cached simulations |

Or the CLI (with `backend/` and `backend/tests` on `PYTHONPATH`):
`python -m benchmarks.bras.bras_benchmark --scene RS2_1m_rigid --all-stages --pairs all`.

CPU-only unit tests: `python -m pytest tests/benchmarks/bras/test_bras_units.py tests/benchmarks/bras/test_bras_animation_units.py`.
`test_ground_plane_reflection` (GPU) checks the hemi-anechoic floor against an image source.

## 4. Outputs: `backend/temp/benchmarks/bras/<scene>/f<fmax>/`

| File | Content |
| --- | --- |
| `report.md` | Inputs, materials (absorption per octave), setup, results per pair and per band, file list |
| `plots/pair_<LS>-<MP>.png` | Gated IRs, frequency response and level difference per band, measured vs simulated |
| `plots/average.png` | Average response of all pairs and the per-band difference (mean, min to max) |
| `plots/overview.png` | Pairs x bands heatmap of the level difference |
| `animation/wave_<LS>_z<z>.mp4` | Wave propagation on the loudspeaker's horizontal plane, with the highlighted pair's measured and simulated IRs |
| `animation/wave_<LS>_z<z>.npz` + `.json` | The animation data (frames, plane axes, wall mask, positions, IRs) |
| `plots/animation_preview.png` | Six frames of the animation |
| `results.json` | Every number of the report |

## Method

- **Free field.** The domain is padded beyond every source, receiver and object, in whole grid
  cells so the objects' faces stay on cell faces. The grid spacing is planned by the benchmark and
  passed to the job (`grid_spacing`). The domain edge echoes, so each run has an empty-domain
  control run: same grid and source, the objects replaced by two tiny corner markers (the floor
  stays). The solver is linear, so subtracting what the control records after its physical
  arrivals (direct sound, floor reflection) removes the edge echo. The animation gets the same
  correction.
- **Loudspeaker.** The directivity file goes through the app's import (first-order pattern per
  octave band). The measured IRs carry the loudspeaker's phase, while the solver's source is
  zero-phase, so the simulated IRs get the on-axis phase (`bras_source_phase.py`, |H| unchanged).
  The phase is applied after the edge-echo subtraction, whose time gating needs the solver's
  compact pulses.
- **Comparison.** Both IRs get the solver's band limits (10 Hz high-pass, zero-phase low-pass at
  fmax). The simulation is resampled to 44.1 kHz, aligned on the direct sound and scaled by one
  global gain fitted on `gain_pair`'s direct sound. Both are gated identically. Level differences
  are simulated minus measured, per band.
