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
| `geometry.skp` | The BRAS SketchUp model, read directly (`bras_skp.py`): visible faces in metres, their material names, and the text labels. An OBJ of the objects (`geometry.obj`) still works |
| `materials` | Material name in the model, as a pattern, mapped to a BRAS material CSV. Faces of a `.skp` whose material is not listed are left out (icons, supporting structure, the finite floor patch). Several materials are fine |
| `measurements` | SOFA GeneralFIR (`RS*_RIRs_*.sofa`): the measured IRs. Positions come from the model's labels, which the BRAS documentation names as authoritative (the RS1 SOFA files disagree with them by up to 24 cm) |
| `source` | Directivity file (BRAS `*_IR_front_pole.csv` or SOFA). Loudspeaker orientations are read from the model's labels; `orientations` or `aim_point` override or cross-check them |
| `ground` | Hemi-anechoic chambers (RS1, RS5-RS7): a reflective floor spanning the whole domain, with its material key |
| `temperature_c`, `humidity` | Chamber conditions (the speed of sound for the measured arrivals) |
| `band_test` | See below |
| `gain_pair`, `smoke_pairs`, `animation` | Level calibration pair, default pairs, animated loudspeaker and highlighted microphone |

`BRAS_ROOT` relocates the database. Reading `.skp` uses the SketchUp C library that Rhino 7/8 ships
(`Plug-ins/SketchUpAPI.dll`, or `SKETCHUP_API_DLL`); it is Windows only.

All RS1-RS7 setups of the documentation are registered (13 scenes). Notes that follow the documentation:

- Hidden objects of a model are not used (the RS1 rigid model hides the absorber and the diffusor).
- The supporting structures are left out, as the documentation allows.
- RS2 and RS3 use `mat_MDF25mmA_plane`, RS4 and RS5 `mat_MDF25mmB_plane`, RS1 diffusor / RS6 / RS7 `mat_MDF12mm_plane`,
  the absorbers `mat_RockFonSonarG_00deg`, the RWTH chamber floor `mat_Tiles`.
- The RS2 absorber is drawn as one face; `extrude` turns it into the 20 mm slab.
- Microphones 6 mm above the floor (RS5, RS6) are simulated at the solver's clearance (3.5 cells); the report says so.

## 2. Define the frequency-band test: `BandTest`

| Field | Meaning (RS2 setting) |
| --- | --- |
| `stages` | fmax (Hz) to points per wavelength, one simulation per stage (`{500: 27.456, 2500: 10}`) |
| `fmin_hz`, `fmax_fraction` | Compared band: `fmin_hz` to `fmax_fraction` x fmax (125 Hz to 2 kHz at the 2.5 kHz stage) |
| `bands_per_octave` | Level-difference bands: 3 = third octaves, 1 = octaves |
| `smoothing_fraction` | Frequency-response curves, 1/N octave (12) |
| `pre_ms`, `gate_ms` | Analysis window around the direct sound (2 ms before, 17 ms after) |
| `duration_s` | Simulated IR length (0.05 s) |

The free air around the scene is not a setting: it is computed per domain face from the geometry and
the window (see Method, *Domain size*). Set `PFFDTD_GPU_MEMORY_GB` to the GPU's memory (default 8; 10.5
on the 11 GB RTX 2080 Ti of the production host), since the planner coarsens the grid to fit that budget.

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
| `BRAS_HIGH_ORDER=off` | PFFDTD with the app's first-order directivity fit (default: the whole measured balloon, below) |
| `BRAS_GAIN_PAIR=scene` / `=LS1-MP1` | Calibrate the level on the scene's `gain_pair` / that pair (default `on_axis`) |

### Every reference scene in one go

```bash
python tests/benchmarks/bras/run_all.py --dry-run
```

```bash
python tests/benchmarks/bras/run_all.py
```

The dry run reads every input, plans every grid and runs the app's geometry preflight without the GPU, and
writes `plan.md` to the output root. For every stage it gives the free air per face, whether the grid was
coarsened to fit the GPU, and whether the run is edge-clean. The real run goes through the scenes and stages in sequence; each
benchmark writes its report, plots and MP4 as it finishes, `index.md` lists them all, a failing scene does
not stop the rest, and finished simulations are cached, so an interrupted run resumes.
Options: `--scenes "RS1*" RS5`, `--stages 500`, `--pairs smoke`, `--no-animation`, `--force`.

Or the CLI (with `backend/` and `backend/tests` on `PYTHONPATH`):
`python -m benchmarks.bras.bras_benchmark --scene RS2_1m_rigid --all-stages --pairs all`.

CPU-only unit tests: `python -m pytest tests/benchmarks/bras/test_bras_units.py tests/benchmarks/bras/test_bras_animation_units.py`.
`test_ground_plane_reflection` (GPU) checks the hemi-anechoic floor against an image source.

## 4. Outputs: `../compas_soundscape_benchmarks/bras/<scene>/f<fmax>/`

A sibling folder of the repository, so runs and caches stay out of git (`BRAS_OUTPUT_ROOT` moves
it; `_cache/` holds the directivity balloons and the loudspeaker phase).

| File | Content |
| --- | --- |
| `report.md` | Inputs, materials (absorption per octave), setup, results per pair and per band, file list |
| `plots/pair_<LS>-<MP>.png` | Gated IRs, frequency response and level difference per band, measured vs simulated |
| `plots/average.png` | Average response of all pairs and the per-band difference (mean, min to max) |
| `plots/setup.png` | The setup, same layout for every scene: plan / section / perspective with materials, loudspeakers (aim) and microphones; the PFFDTD boundary nodes (from the solver's voxel cache, `plots/setup_voxels.npz`) and the pyroomacoustics walls; the material CSVs and their values in the compared band. Without a GPU: `python tests/benchmarks/bras/bras_setup_plots.py --scenes RS7` |
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
- **Domain size** (`bras_domain.edge_padding_m`, planned in `bras_benchmark._plan_domain`). The
  subtraction is exact for the pure edge echo but not for an edge wave that also meets an object
  (scattered by the plate in one run, absent from the control). Each of the six faces is therefore
  moved out until every such path reaches every microphone after the window (gate + 2 ms fade + 1 ms
  low-pass ringing). Lower bound used, with S' / R' mirrored across the face and X any point on the
  objects (sampled every 10 cm, 20 cm subtracted): `|S' - X| + |X - R|` and `|S - X| + |X - R'|`; an
  unfolded reflection is never shorter, so the bound is safe at any angle. The pure edge echo must
  also come 10 ms after the floor reflection, so the control keeps its whole 5 ms physical part. The
  face under a floor needs nothing. Then 0.1 m is added, and at least 0.5 m is kept.
  The top face usually decides (edge waves from above land on the objects early): about 4.6-5.7 m
  above the highest device or object, 2.6-4.1 m on the other faces (RS1_rigid, with no object, 6.7 m
  on its y faces: there the pure echo's 10 ms decides).
- **When the GPU is too small.** First the grid is coarsened, down to `PPW_MIN` = 8 points per
  wavelength at fmax (10 at the top of the compared band), then the padding is scaled down and the
  report flags the run *NOT edge-clean*. At 2.5 kHz on 8.9 GB usable, 10 of the 13 scenes are clean
  (8 of them on a coarser grid, 9.3-10.9 points per wavelength); RS2_1m_rigid and RS2_2m_rigid miss
  5-10 % of the free air, and RS3 (100 ms window: about 17 m on every face) cannot be clean.
  On the RS7 check (RS7 at 3 m vs a clean domain, `../compas_soundscape_benchmarks/bras_edge_bc/`)
  the edge residue of the old fixed 3 m padding was -16 dB in the compared band, and changed the
  per-band results by up to 1.8 dB (1250 Hz) while the mean |dL| moved by 0.07 dB.
- **Loudspeaker.** The directivity file goes through the app's import (first-order pattern per
  octave band). The measured IRs carry the loudspeaker's phase, while the solver's source is
  zero-phase, so the simulated IRs get the on-axis phase (`bras_source_phase.py`, |H| unchanged).
  The phase is applied after the edge-echo subtraction, whose time gating needs the solver's
  compact pulses.
- **High-order loudspeaker (benchmark only).** The app gives PFFDTD a first-order pattern per octave
  band (7 probes at the source), up to 3.8 dB off the measured balloon at 2 kHz. The benchmark sets
  `PFFDTD_HIGH_ORDER_DIRECTIVITY=1` (never set by the app) and marks its specs `high_order`: each
  loudspeaker records every grid node within 4 cells, the arriving field is fitted with spherical
  harmonics per frequency (up to order 6, while the ball resolves it) and weighted by the measured
  balloon's magnitude in the world frame (`pffdtd_backend/directional_ho.py`). On the RS2 free-field
  control runs it reproduces the balloon within 0.46 dB per octave (first order: 3.8 dB).
  pyroomacoustics already uses the balloon's IRs.
- **pyroomacoustics in a closed room** (`PRA_CLOSED_ROOM`, `bras_geometry.enclosed_geometry`).
  pyroomacoustics only tests walls off the convex hull of all walls for obstruction, which assumes
  sources and receivers inside a closed room. In the open BRAS scenes they are outside, so hull walls
  (an absorber's top, a plate) never blocked a path and the floor reflected through the objects. A
  fully absorbing box (alpha = 1) 1 m beyond the domain closes the scene: the objects obstruct again
  and the shell reflects nothing. The app's mesh preparation then orients every face from the air
  side, which pyroomacoustics needs (it reflects off a wall's front only).
- **pyroomacoustics mesh settings** (`PRA_MESH_SETTINGS`). The RockFon absorbers are tiled panels with
  ~1 mm slits: a 2 mm weld closes them, and `drop_unreached_faces` (an app setting, off by default)
  leaves the panel sides inside the slab out of the walls. Otherwise the image source model mirrors
  in them and repeats the absorber reflection (+10 dB on the RS1 specular pairs).
- **Material bands.** The app maps a material's coefficients to pyroomacoustics' octave bands by
  frequency (`pyroomacoustics_room_builder._to_octave_bands`: mean of the 1/3-octave bands in each
  octave). It used to take the first eight values, which gave the BRAS CSVs (1/3 octave from 20 Hz)
  their 20-100 Hz absorption in every band.
- **Calibration pair.** The global gain is fitted on the line-of-sight pair closest to its
  loudspeaker's axis (`on_axis`); scenes whose pairs are all 30 deg off use their least off-axis one.
- **Comparison.** Both IRs get the solver's band limits (10 Hz high-pass, zero-phase low-pass at
  fmax). The simulation is resampled to 44.1 kHz, aligned on the direct sound and scaled by one
  global gain fitted on `gain_pair`'s direct sound. Both are gated identically. Level differences
  are simulated minus measured, per band.
