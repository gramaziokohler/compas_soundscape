# Step 1 (this approval): implement the compas_acoustics changes in the `bouiz` fork

## Context

First step of the migration below: make compas_acoustics (CA) able to serve as the engine, with
no change to compas_soundscape (CS) yet. Work happens in `bouiz/compas_acoustics`, on top of its
`hil-d24-1-benchmark` branch (one commit ahead of upstream `main`; it adds `examples/hil_d24_1.py`,
its OBJ, and `tests/test_sample_room.py`). A ground-truth reference is recorded before any change
and re-checked after every major change.

## 0. Setup and housekeeping

1. **Save the roadmap**: copy the full migration plan (everything under "Roadmap" below) to
   `C:\Users\soundisblue\repos\compas_soundscape\docs\compas_acoustics_migration_plan.md`
   (not committed), and add a memory pointer to it and to the fork.
2. **Clone** `https://github.com/bouiz/compas_acoustics` to `C:\Users\soundisblue\repos\compas_acoustics`,
   add `upstream` = `gramaziokohler/compas_acoustics`, check out `hil-d24-1-benchmark`, and create
   the work branch `engine-integration` from it.
3. **Environment**: `mamba env create -f environment.yml` (env `compas-acoustics-bouiz`,
   Python 3.12, `pip install -e .[dev]`), with CPU-only torch installed first as CA's CI does.
   Stock pyroomacoustics from PyPI, not the patched fork, so the reference reflects upstream behaviour.
4. **GitHub access**: `gh` is not installed and no git credential helper is configured. Install
   with `winget install GitHub.cli`; you run `gh auth login` yourself (I do not enter credentials).
   Commits are pushed to the `bouiz` fork only. No pull request to `gramaziokohler` in this step.

## 1. Ground-truth reference

A small harness `tools/regression_reference.py` in the fork, with two commands:

- `record <dir>`: runs `examples/hil_d24_1.py::main()` and stores, per source–receiver pair, the
  raw IR (`ir.denormalized()`, `.npz`), the `generation` metadata and the full `Analyser.analyse()`
  output (JSON); then runs the whole test suite (`pytest --junitxml`, slow and hybrid tests
  included) and stores each test's outcome and the wall time of both.
- `compare <reference dir> <new dir>`: reports IRs as identical / max absolute difference and
  level difference in dB, per-band metric differences, tests whose outcome changed, and run time.

Reference procedure:

1. Record twice on the untouched branch to establish whether the run is bit-reproducible
   (seed 42). If not, the spread between the two runs becomes the tolerance.
2. Keep the reference outside git (`examples/results/` is ignored) at
   `examples/results/reference/<commit>`.
3. Note any test that already fails or is skipped on this machine before changes (for example the
   C# and docs tests), so later failures are attributable.

## 2. Changes, in order, each followed by `compare`

Every milestone is one or more commits on `engine-integration`; after each, run `compare` and the
full tests, and report the result before moving on. An unexpected difference stops the work
until it is explained.

| # | Change (roadmap item) | Main files in CA | Expected effect on the reference |
| --- | --- | --- | --- |
| M1 | Optional hybrid dependencies and lazy heavy imports (U1); explicit octave grid / documented process-bound state (U6); public progress + cancel callback (U2) | `requirements.txt`, `pyproject.toml`, `__init__.py`, `room/geometry.py`, `worker/jobs.py`, `simulation_methods/*.py` | Identical IRs and metrics; same test outcomes |
| M2 | Mesh preparation moved into CA (U3, roadmap 5c): port CS `utils/mesh_{topology,raycast,orientation,coplanar}.py`, `utils/air_visibility.py`, `services/simulation_mesh_service.py` and the generic part of `simulation_preflight_service.py` into a numpy/scipy-only `compas_acoustics/geometry/` package; `PreparedMesh`, `prepare_mesh`, `RoomGeometry.from_prepared`, `check_inside=False`, `Scene.simulate(method, geometry=…)`; port `test_simulation_mesh.py` / `test_simulation_preflight.py` | new `geometry/`, `room/geometry.py`, `scene.py`, `simulation_methods/base.py` | Identical: the existing `from_scene` path is untouched unless seeds are passed. New tests added |
| M3 | Parallel `Mono` and reciprocity (U8, roadmap 5a/5b): port the pra fork's `rt_parallel.py` and CS `utils/child_pool.py`; `Mono(n_jobs=…, reciprocity=…)`; parallel `directional_histograms` | new `room/parallel.py`, `room/raytracing.py`, `simulation_methods/pra.py` | Defaults (`n_jobs=1`, no swap): identical. With `n_jobs>1`: ISM part identical, ray-traced tail within the Monte-Carlo tolerance; run time reported |
| M4 | Hybrid in rooms that do not close (U4): supplied air volume and area, tolerant directional scan | `simulation_methods/hybrid.py`, `hybrid/pair.py`, `hybrid/late.py`, `hybrid/directional.py` | Identical for the closed HIL room; new tests for an open room |
| M5 | Measured source directivity (U5): `Source.directivity` accepts a pra directivity object or SOFA path; per-band evaluation in the hybrid and on diffracted paths | `source.py`, `room/pra.py`, `hybrid/early.py`, `hybrid/diffraction.py`, `worker/api.py` | Identical for omni and cardioid sources |
| M6 | Diffraction in `Mono`, edge cache per geometry, non-convex closed obstacles (U7) | `simulation_methods/pra.py`, `hybrid/diffraction.py` | Identical with `diffraction=False` (default); separate run with it on, reported as a new result |
| M7 | Extras: reliability flags, decay-curve output, channel choice in `Analyser` (U9); per-band energy on `SpecularPath` and public diffraction-path accessor (U10); material id aliases to pra keys (U11) | `analyser.py`, `rays.py`, `hybrid/diffraction.py`, `materials.py` | Identical; additive fields only |

Constraints while implementing:

- CA supports Python 3.9–3.12 and stock pra ≥ 0.10.1: no dependency on the patched fork
  (`Wall.two_sided`, `n_processes`), no syntax newer than 3.9.
- Keep CA's conventions: 62.5 Hz–8 kHz grid, 1/(4πr) scale, `ruff` formatting, CHANGELOG entry
  per change, existing public signatures unchanged (new behaviour is opt-in).
- M3 depends on one open check: that stock pra exposes `simulation.rt.compute_rt_rir` as the fork
  does. If it does not, the parallel path reuses pra's own synthesis through a thin copy in CA.
- U12 (upstreaming fork fixes to pyroomacoustics itself) is not a CA change and is left out.

## 3. Verification

- After each milestone: `python tools/regression_reference.py record` + `compare` against the
  reference, full `pytest` (including `-m slow` and `tests/hybrid`), `ruff check`.
- New tests per milestone as listed; ported CS tests must pass unchanged in logic.
- End of step: a summary table of M1–M7 with IR difference, metric difference, test outcome
  changes and run time against the reference; branch pushed to `bouiz/compas_acoustics`.

---

# Roadmap (saved for the next steps): compas_soundscape as a wrapper of compas_acoustics

## Context

Today the app drives pyroomacoustics (pra) directly through its own service, room builder and a
patched pra fork. The goal is to reverse that: use `gramaziokohler/compas_acoustics` (CA, v0.1.0,
MIT) as the room-acoustics engine and follow its conventions (bands, level scale, air model,
materials, metrics). This repo keeps only what the app and its workflows really need on top.
This plan lists what is gained, what is lost, what to change here (wrapper) and what to change
in CA itself.

Abbreviations: **CS** = compas_soundscape (this repo), **CA** = compas_acoustics,
**pra** = pyroomacoustics, **ISM** = image-source method, **RT** = ray tracing,
**FOA/HOA** = first/higher-order ambisonics, **FDN** = feedback delay network (CA's late reverb).

## Checks already run

- `pip install --dry-run compas_acoustics` in the `compas-soundscape` env resolves. It keeps
  torch 2.4.1+cu121, numpy 1.26.4 and the editable pra fork (0.10.2.dev satisfies `>=0.10.1`).
  It would upgrade **scipy 1.15.3 → 1.17.1** and **protobuf 5.29.6 → 7.36.2**, and add compas,
  compas_pb, pyfar, pyrato, spharpy, sofar, pyFDN, flamo, multislope, onnxruntime, nnaudio,
  netCDF4, sounddevice.
- Current export wraps: a 0.5 m source–mic pair gives peak 1.98, written as int16 −745.
- Current output carries a 40-sample latency (peak at sample 110, geometric arrival at 70).
- Positional band padding equals `Material.resample` for all stock pra materials.

## 1. Comparative table of the two implementations

| Area | CS today | CA | If CS wraps CA |
| --- | --- | --- | --- |
| pra build | Patched fork, editable, rebuilt by auto-deploy | Stock PyPI ≥ 0.10.1 | Fork no longer required once CA covers its features (section 5, phase 5) |
| Input geometry | Speckle or raw triangles, units converted to metres | COMPAS `Mesh` per object, or `RoomGeometry.from_mesh(vertices, faces, face_materials, materials, obstacles)`; metres only | Wrapper keeps Speckle loading and unit handling; feeds `from_mesh` |
| Welding | KD-tree, 0.1 mm default, user 0–50 mm | Union-find, 1 mm default | Same, weld once in CS prep |
| Normal orientation | Air-side random walk from sources/receivers; works on open and non-manifold meshes | BFS over shared edges; closed components wound outward; **open boundaries kept as drawn** (pra then drops images silently) | CS prep must stay; CA needs a "trust my orientation" input (U3) |
| Thin panels | C++ `Wall.two_sided` flag, detected automatically | `role="obstacle"`: face stored twice, ±1 mm apart | CS two-sided detection → CA obstacle role |
| Open / leaky models | Run in every mode; preflight reports leaks | `Mono` runs (10 s duration). `Ambisonics`/`Binaural` **raise** | Mono keeps working; ambisonic output needs U4 |
| Points outside the hull | Accepted (`check_inside=False`), preflight warns | Dropped with a warning; hybrid raises | Needs an opt-out (U3) |
| Coplanar merge | Any simple polygon, 1° / 1 mm, user-tunable | Convex results only, 1e-5 m | More walls than today on concave floors → slower ISM until U3 |
| float32 precision | Geometry recentred on the bounding box | Not seen; to verify | Wrapper recentres before calling CA |
| Bands | 125 Hz–16 kHz (8), pra default grid | 62.5 Hz–8 kHz, base moved to 62.5; 62.5 copies 125 | Adopt CA grid |
| Materials | pra `materials.json` + 2 custom absorbers + user materials in SQLite (7 bands) | 95 JSON files, 7 bands 125–8k, absorption + scattering + (unused) transmission | Adopt CA library; id migration needed |
| Scattering | One scalar per object, only with RT, default 0.05 | Per band, from material; default 0.05; depth-based helper | Per-band scattering from material, scalar override kept |
| Air | pra table, fixed c = 343 (user 300–400) | `AirConditions(temperature, humidity, pressure)`; Cramer c; ISO 9613-1 | Adopt; replaces the sound-speed field |
| Level scale | 1/r re 1 m; PFFDTD multiplied by 4π to match | 1/(4πr) "package scale"; peak-normalised by default with the factor kept | Adopt 1/(4πr) everywhere |
| Timing | 40-sample filter latency left in | Removed | Adopt |
| Mono method | ISM order 3 (UI 2) + RT 10 k rays, `time_thres` 10 s | ISM 3 + RT 20 k rays, duration 1.5 × Eyring (0.5–12 s), seeded | Adopt CA defaults |
| Ambisonic output | FOA from 4 directive capsules in pra (ISM + RT), any mesh | Own hybrid: ISM early part + directional FDN late part, any order, closed rooms only | FOA and HOA via CA `Ambisonics` |
| Binaural IR | None (frontend decodes ambisonics with head rotation) | `Binaural` (KEMAR or any SOFA, nearest HRIR) | Not needed by the app |
| Edge diffraction | None | UDFA first order and BTMS, hybrid methods only | New, ambisonic mode only until U7 |
| Source directivity | Cardioid family + measured balloons (SOFA / BRAS CSV, DIRPAT presets), yaw/pitch/roll | Cardioid family only; one broadband gain per image in the hybrid; ignored on diffracted paths | **Measured directivity lost** until U5 |
| Mic directivity | Yes (fork applies it in RT) | None | Not needed once FOA comes from the hybrid |
| Reciprocity swap | Yes, for omni/mono with more sources than listeners | None | Keep in wrapper |
| Metrics | Broadband RT60, EDT, C50, D50, DRR + reliability flags | Per band: EDT, T20, T30, C50, C80, D50, DRR, Ts, STI, G, SPL, LF, LFC + overall | Adopt `Analyser`; keep reliability flags in wrapper |
| Sanity reference | None | Sabine/Eyring prediction + uneven-absorption warning | New |
| Parallelism | Rooms across processes + rays across processes | None (parallel tracer removed) | Wrapper parallelises one process per source |
| Progress | ISM node count, RT in 20 chunks, synthesis | Stage boundaries only | Coarser bar until U2 |
| Cancellation | Hard kill of the child process | Cooperative at stage boundaries | Hard kill still works |
| Reproducibility | Not seeded | Seed 42 by default | New |
| Preflight | Leaks, seeds outside, two-sided, units, ISM cost, 3D preview | Warnings only | Keep CS preflight; add CA-specific checks |
| Ray / path display | None | `RayField`, `SpecularReflections` | New |
| Energy map | Metric heat map interpolated from grid IRs | `EnergyMap`: SPL per band and per 4 ms frame at any points | New |
| Output files | int16 WAV (wraps above 1.0) | float32 WAV + JSON metadata sidecar | Adopt float32 |
| Grasshopper | Own C# and GhPython components, **both broken** against the current API | Maintained C# plugin with its own worker | Retire the CS ones |

## 2. What the app really needs (must survive the switch)

Everything below is consumed by the frontend, by PFFDTD, or by saved soundscapes.

1. **Messy Speckle meshes run.** Open, non-manifold and unoriented models, thin panels, sources
   outside the hull. This is `SimulationMeshService` + `utils/mesh_*.py` + `utils/air_visibility.py`.
   It is shared with PFFDTD and the preflight, so it stays in CS regardless.
2. **Preflight with the 3D preview** (`simulation_preflight_service.py`, `simulation-mesh-preview.ts`).
3. **The job contract**: the two endpoints, job variants, `{job_id, position, total}`, result
   `{simulation_id, ir_files, results_file}`, file name `sim_<id>_src_<s>_rcv_<r>.wav`, results
   JSON with `results[].{source_id, receiver_id, acoustic_parameters}`.
4. **Mono and FOA IRs at 48 kHz, AmbiX (ACN, SN3D)**, propagation delay kept.
5. **Many receivers per run.** Grid listeners create hundreds of receivers that only need metrics.
6. **Metric keys** `rt60, edt, c50, d50, drr, spl, rt60_reliable, edt_reliable, rt60_is_estimate`.
7. **Per-object material and scattering assignment, custom 7-band materials.**
8. **Source directivity**, including measured balloons and the two DIRPAT presets.
9. **Level consistency with PFFDTD** and with saved IR gain settings.
10. **Hard cancel and a progress bar with status text.**
11. **Read-only share view**: materials list, IR files, pruned results JSON.

Not needed and safe to drop: the unused result fields (`geometry_diagnostics`, `reciprocity`,
FOA tags), the "parallel" toggle, `enable_grid`, the dead API methods, the CS Grasshopper components.

## 3. New features gained

| Feature | CA source | Work in CS |
| --- | --- | --- |
| Early-reflection paths in the 3D viewer | `SpecularReflections.from_scene` → points, order, wall ids, delay | New endpoint + a three.js line overlay with order and time filters |
| Animated ray field / particles | `RayField.from_scene`, `.particles(time_ms)` | New endpoint + overlay (optional, after paths) |
| Energy / SPL map per band and over time | `EnergyMap.from_scene` | Feed the existing `gradient-map-manager.ts`; faster than one IR per grid point |
| Edge diffraction | `Ambisonics(diffraction="udfa")` | Toggle in settings; preflight note on skipped edges |
| HOA IRs (orders 2–3) | `Ambisonics(sh_order=…)` | Frontend already decodes 9/16 channels; fix the IR upload that cuts 9 channels to 4 |
| Per-band metrics, T20, C80, Ts, STI, G, LF | `Analyser.analyse()` | Extend results JSON and the metrics panel |
| Calibrated SPL and voice presets | `Source.spl`, `sound_pressure_level` | Optional source level field |
| Temperature / humidity / pressure | `AirConditions` | Three settings replacing sound speed |
| Sabine/Eyring reference + uneven-room warning | `room/diffuse.py` | Show next to simulated RT |
| Multi-slope decays (coupled rooms) | `n_slopes` | Advanced setting |
| Scattering split (specular vs scattered early part) | `scattering=True` | Advanced setting |
| Scattering from surface depth | `scattering_coefficients_from_depth` | Helper in the custom-material dialog |
| Seeded, reproducible runs | `seed` | Store seed in results |
| 62.5 Hz band | CA grid | Comes with the switch |
| float32 IR + metadata sidecar | `ImpulseResponse.to_wav` | Fixes the wrap bug |
| Maintained Grasshopper plugin | CA C# plugin | Replaces the broken CS components |

## 4. Features lost or degraded (and how each is handled)

| Lost / degraded | Why | Handling |
| --- | --- | --- |
| Measured source directivity (SOFA, BRAS CSV, DIRPAT presets) | CA only accepts cardioid names | U5 upstream. Until then the UI greys out measured entries for this engine |
| Ambisonic IRs in open or leaky models | CA hybrid raises without a closed room | U4 upstream. Until then: preflight error "ambisonic output needs a closed room", mono still runs |
| Diffraction in mono | Only in the hybrid | U7 upstream |
| Ray-traced FOA tail | CA's late part is an FDN shaped by RT energy, not RT itself | Accepted (CA way); check against BRAS |
| Ray tracing split across processes | Removed in CA | Wrapper runs one process per source (existing `utils/child_pool.py`) |
| Fine progress inside ISM and RT | Stage-level only | U2 upstream; meanwhile show stage text |
| Non-convex merged walls | CA merges to convex only | U3 upstream; meanwhile more walls, covered by the ISM cost check |
| 16 kHz band | CA grid ends at 8 kHz (held above) | Accepted |
| User weld / merge tolerances | CA has fixed tolerances | Kept, because CS still prepares the mesh |
| Free-form sound speed (300–400) | Derived from air conditions | Replaced by temperature / humidity |
| Reliability flags on RT60 / EDT | `Analyser` has none | Wrapper computes them (or U9) |
| Fork-only ray fixes (scatter lobe on back hits, two-sided ISM) | Stock pra | Not needed with doubled obstacles; verify on the panel test scene |
| Light backend env | CA pulls pyFDN → flamo (+ onnxruntime, nnaudio), upgrades scipy and protobuf | U1 upstream (optional extra); else isolated env |
| Cheap FOA | 96-line FDN per pair even at order 1 | Grid listeners always use `Mono`; ambisonics only for real listeners |

## 5. Changes in compas_acoustics (upstream)

Ordered by how much they block the wrapper.

- **U1. Make the hybrid dependencies optional.** Move pyFDN / multislope (and so flamo, torch,
  onnxruntime) to an extra such as `compas_acoustics[hybrid]`; `Mono`, `Analyser`, rays and the
  energy map work without them. Loosen the protobuf pin if `compas_pb` allows.
- **U2. Public progress and cancel hook.** Promote `worker/jobs.py` to a library-level callback
  (`progress=callable`, raising on cancel) passed to `compute`, `RayField`, `EnergyMap`. Report
  per source inside ray tracing by tracing in chunks.
- **U3. Move mesh preparation into CA** (details in 5c): engine-neutral `prepare_mesh` →
  `PreparedMesh`, then `RoomGeometry.from_prepared`; light `compas_acoustics.geometry` import;
  `check_inside=False` to keep points the winding test rejects; `Scene.simulate(method,
  geometry=…)` so a prepared geometry does not need a hand-built `SimulationContext`.
- **U4. Hybrid in rooms that do not close.** Accept an externally supplied air volume and surface
  area (CS already estimates volume from the mean free path), let the directional scan tolerate
  rays that escape, and downgrade the raise to a warning.
- **U5. Measured source directivity.** `Source.directivity` accepts a pra `Directivity` object or
  a SOFA path; the hybrid evaluates it per band per image, and diffracted paths apply it too.
- **U6. Remove process-wide state.** `pra_octave_grid()` and `pra.random.seed` mutate globals;
  document as process-bound or pass the grid explicitly, so thread-based hosts are safe.
- **U7. Diffraction outside the hybrid and faster.** Add first-order UDFA to `Mono` (the paths
  are independent of the late field), cache `diffraction_edges(geometry)` across pairs, and accept
  non-convex closed obstacles.
- **U8. Parallel `Mono` and reciprocity** (details in 5a and 5b): port the fork's histogram-level
  ray split, add the emitter pool as `Mono(n_jobs=N)`, and `Mono(reciprocity="auto")`.
- **U9. Analysis extras.** Reliability flags (decay range reached, fit linearity), an
  energy-decay-curve / echogram output, and analysis of a chosen channel instead of channel 0 only.
- **U10. Path data for display.** Per-band energy on `SpecularPath`; a public accessor for
  diffraction paths (apex point, zone, delay) so the viewer can draw them.
- **U11. Materials.** Stable ids matching pra keys (alias table), the missing
  `tools/import_backend_materials.py`, and either use or remove `transmission_coefficients`.
- **U12. Upstream the useful fork behaviour to pra or CA**: the scatter-lobe fix for back hits
  and the cheaper visibility tests, so the fork can be retired.

## 5a. Parallelism: is `child_pool.py` alone as fast as today?

**No, not when there are few emitters, which is the usual case in the app.**

Today (`split_processes`, `pyroomacoustics_worker.py:85`) a job with P processes (default 8) and
E emitters runs `min(P, E)` rooms at once, and gives each room `P // min(P, E)` processes to split
its rays through the fork's `rt_parallel.py`. With CA on stock pra, `child_pool.py` can only do
the first half (one process per emitter).

| Emitters E | Cores used today | Cores with `child_pool` only | Ray-tracing slowdown |
| --- | --- | --- | --- |
| 1 | 8 | 1 | up to 8× |
| 2 | 8 | 2 | up to 4× |
| 3 | 6 | 3 | up to 2× |
| 4 | 8 | 4 | up to 2× |
| 5–7 | E | E | none |
| ≥ 8 | 8 | 8 | none |

- Reciprocity makes E = min(sources, receivers) for mono runs, so E is small in most sessions
  (a few sounds, or one listener). The slowdown is therefore the common case.
- ISM is serial per emitter in both, so pure-ISM runs are unaffected.
- Each pool worker would import CA (pyfar, pyrato, compas, pra) instead of pra alone: several
  seconds of start-up per worker until imports are lazy (U1).
- Left alone, CA `Mono` puts all sources in one room in one process: 1 core for the whole job.
- Splitting rays in the wrapper by running several smaller `Mono` runs and averaging does **not**
  work: the ray-traced tail is a noise sequence shaped by the histogram, so averaging RIRs lowers
  its level instead of its variance. The split must happen at histogram level.

**What it takes in CA (replaces U8).** The fork's `rt_parallel.py` (266 lines) is the right
design and does not touch private `Room` state, which was CA's reason for removing `n_jobs`: each
worker rebuilds its own C++ engine from a picklable wall list, traces a slice of rays, and returns
sparse histograms that are summed. CA's `directional_histograms` already drives
`room_engine.ray_tracing` and reads histograms the same way, serially.

1. Port `rt_parallel.py` into CA (`room/parallel.py`) against stock `libroom` (drop the
   `two_sided` field; keep spawn, parent-watch, slice seeds, sparse return).
2. Use it in `directional_histograms` directly (pure gain, no pra internals beyond what it uses now).
3. For `Mono`: CA computes the ISM part with pra, the ray histograms with the parallel tracer,
   and synthesises the tail with pra's module-level `simulation.rt.compute_rt_rir` (present in the
   fork; confirm it is in stock ≥ 0.10.1). No write to `Room` state.
4. Add the emitter-level pool (`child_pool.py`, 101 lines) as `Mono(n_jobs=N)`: rooms across
   processes first, leftover processes split rays, same rule as `split_processes`.
5. Progress per finished slice comes for free (the port already reports `done_rays, total_rays`).

Effort: about 400 lines moved plus the synthesis hand-off and tests (serial equals parallel for
ISM; ray-traced decay within Monte-Carlo tolerance; children exit when the parent is killed —
all three tests exist in `tests/test_pyroomacoustics_parallel.py`). Result: CS keeps no
parallel code at all.

## 5b. Reciprocity: what it entails in CA

Today `utils/reciprocity.py` (69 lines) swaps roles when listeners are mono, every source is
omni, and there are more sources than listeners; the worker then groups pairs by emitter.

In CA it is a small change, and simpler than in CS because CA microphones are always omni:

- **Where**: `Mono.compute` (`simulation_methods/pra.py`) and the two helpers it calls,
  `image_source_rirs` / `ray_traced_rirs` (`room/raytracing.py`), which take the source and
  receiver lists and build one room. Swap the lists, run, and re-key results with
  `SimulationContext.key(source, receiver)`.
- **Condition**: every source omnidirectional and `n_sources > n_receivers`. Option
  `Mono(reciprocity="auto" | False)`.
- **Exactness**: ISM is exactly reciprocal (the CS test checks identical IRs after the swap).
  Ray tracing is reciprocal only statistically: the receiver sphere moves to the other end and
  the seeded noise differs, so a swapped run is not sample-identical to an unswapped one. Record
  `reciprocal: true` in the `generation` dict so results stay reproducible and explainable.
- **Unaffected**: `Receiver.radius` is unused by `Mono` (global `receiver_radius`), `Source.spl`
  only enters the analysis, first-order diffraction is already reciprocal (tested in CA).
- **Hybrid**: `Ambisonics` / `Binaural` cannot swap their main path (arrival direction and HRTF
  are receiver-side), but their reference run is a `Mono` run, so they inherit the saving on the
  `"references"` stage. Directional histograms are not swapped.
- **Interaction with U5**: a measured or cardioid source turns the swap off, as in CS.
- **Interaction with 5a**: the emitter pool must group by the emitting side after the decision,
  so reciprocity and `n_jobs` belong in the same place (`Mono`).

Effort: about 60–80 lines and three tests (ISM identical after swap, ray-traced T30 within
tolerance, keys unchanged). CS then deletes `utils/reciprocity.py` and the grouping code in the
worker; the `reciprocity` block in the results JSON is filled from `generation`.

## 5c. Geometry: what CA is missing to take over all of it (and serve PFFDTD)

**What CA already does**: weld (union-find, fixed 1 mm), drop collapsed faces, fan-triangulate
warped polygons, split T-junctions before orienting, BFS orientation, outward winding of closed
components by signed volume, convex coplanar merge, closed-room check with open-edge report,
winding-number inside test, air-side volume and area for closed rooms, obstacle doubling.

**What CS has that CA lacks** (all numpy/scipy only, no pra, no COMPAS; about 1 360 lines in
`services/simulation_mesh_service.py` and `utils/mesh_{topology,raycast,orientation,coplanar}.py`,
`utils/air_visibility.py`, plus 315 lines of tests):

| Missing in CA | CS code | Needed by |
| --- | --- | --- |
| Air-side orientation from source/receiver seeds (random walk, 12 bounces); works on open, non-manifold and unorientable meshes | `air_visibility.py`, `mesh_orientation.py` | pra, PFFDTD, preflight |
| A vectorised ray–triangle caster on the raw triangles | `mesh_raycast.py` | the walk, classification, leak rays |
| Automatic two-sided detection, smoothed per object (CA needs a manual `role="obstacle"`) | `mesh_orientation.py` | pra, PFFDTD |
| Face classes shell / interior / never reached, and dropping unreached faces | `_classify` | preflight preview, ISM cost |
| Air volume for open models from the mean free path, with fallbacks | `_air_volume` | ray-traced tail, CA hybrid (U4), PFFDTD stats |
| Leak diagnostics: seeds outside or leaky, escape fraction, leak rays, hole loops, non-manifold edge list | `air_visibility.py`, `mesh_topology.boundary_loops` | preflight |
| Duplicate and coincident-opposite face removal, sliver threshold | `mesh_topology.dedupe_faces` | all |
| User tolerances for weld and merge (angle + distance), merge to any simple polygon, per-face scattering in the merge key | `mesh_coplanar.py` | pra wall count |
| A neutral prepared mesh kept as triangles with per-face provenance (object, material, flipped, two-sided flag, component) | `SimulationMesh` | **PFFDTD**: it needs single-sheet triangles with a two-sided flag, not ±1 mm doubled copies and not merged polygons |
| Deterministic preparation (fixed seed) so the preview equals what is simulated | `prepare` | preflight invariant |
| Float32 recentring before building pra walls | `room_offset` | georeferenced models |
| Geometry issue analysis with engine-specific severities | `simulation_preflight_service.py` (362 lines) | preflight |

**Structural gaps in CA beyond the missing algorithms**

1. `RoomGeometry` mixes neutral preparation with pra-specific output (doubled obstacles, merged
   polygons). It needs two stages: `prepare_mesh(...) -> PreparedMesh` (engine-neutral, what
   `SimulationMesh` is today) and `RoomGeometry.from_prepared(prepared)` (shell → boundary,
   two-sided → obstacle, orientation trusted, air volume passed on).
2. `import compas_acoustics` loads pyfar, pyrato, pra and compas eagerly. A geometry-only caller
   such as the PFFDTD job needs a light `compas_acoustics.geometry` subpackage (numpy/scipy only).
3. Preparation needs the seed points (sources and receivers) as an input; CA's constructors take none.
4. CA tolerances are module constants; they must become options to keep the app's settings panel.

**Recommended split after the move**

- **Moves to CA**: the six geometry modules, `SimulationMesh` (as `PreparedMesh`),
  `MeshPrepOptions`, the generic part of the issue analysis (as a `GeometryReport`), and their
  tests. CA keeps its T-junction splitting and warped-face triangulation, which CS lacks.
- **Stays in CS**: the Speckle loader and unit fixing (`simulation_geometry_loader.py`,
  `speckle_service.py`), the settings schema, the preflight job and its 3D preview payload
  (`utils/preflight_payload.py`), PFFDTD-specific checks and the voxel export
  (`pffdtd_scene_export.py`), which reads `PreparedMesh` instead of `SimulationMesh`.
- **PFFDTD calling CA for geometry only is feasible**: `pffdtd_job.py` and `pffdtd_scene_export.py`
  read only `vertices, faces, normals, areas, face_material, two_sided, air_volume_m3, stats`,
  all present in the prepared mesh. Mesh preparation already runs in the main backend env, not in
  `compas-pffdtd`, so no new env coupling appears.

**Order of work**: (1) port the modules unchanged and make CS import them from CA, checked by
running `tests/test_simulation_mesh.py` and `tests/test_simulation_preflight.py` against both
copies for identical output; (2) make CA's own `from_scene` path call the same preparation when
seeds are given, so Grasshopper users get open-model support too; (3) delete the CS copies.
This replaces U3, covers the volume half of U4, and removes the "CS prep must stay" rows above.

## 6. Changes in compas_soundscape (wrapper)

**New / replaced backend code**

- `backend/services/compas_acoustics_engine.py` (new): adapter from `SimulationMesh` to
  `RoomGeometry.from_mesh` (shell faces → boundary, two-sided faces → obstacles, recentring),
  sources and receivers to CA objects, CS settings to `Mono` / `Ambisonics`, results to the
  existing file and JSON contract. Runs `method.compute(SimulationContext(...))` directly.
- `backend/services/pyroomacoustics_worker.py`: `_run_pyroomacoustics_compute_loop` calls the
  adapter instead of `build_room` / `compute_rir`. Grid receivers always go through `Mono`.
  Until U3 and U8 land it keeps the CS mesh prep, `utils/reciprocity.py` and the per-emitter
  `child_pool` (slower with few emitters, see 5a); afterwards those three are deleted and the
  worker passes `n_jobs` and the prepared mesh from CA.
- Engine switch: constant `ACOUSTICS_ENGINE = "pra_legacy" | "compas_acoustics"` in
  `config/constants.py` so both run side by side during validation.
- `backend/services/acoustic_materials_service.py` (new): CA `MaterialsLibrary` behind the
  existing `/api/pyroomacoustics/materials`, `/api/pffdtd/materials` and share endpoints; alias
  map from old pra ids so saved soundscapes still load; keep the two custom absorbers and SQLite
  user materials.
- Metrics: `utils/acoustic_measurement.py` calls `Analyser`, maps overall values to the existing
  keys, adds a `bands` block, and keeps the reliability flags. Remove its unused `import pyroomacoustics`.
- Level and files: write float32 at 1/(4πr); drop the ×4π in `services/pffdtd_job.py:392`;
  `impulse_response_service.py` keeps float and accepts 9 channels.
- Decouple remaining pra imports: `directivity_service.bundled_sofa_path`,
  `simulation_preflight_service.two_sided_supported`, `_write_progress` / `_write_result` helpers.
- Preflight additions: "ambisonic output needs a closed room", "measured directivity not
  supported by this engine", "N edges skipped for diffraction", CA's ISM cost formula.
- New endpoints (CPU jobs): `/api/acoustics/reflection-paths`, `/api/acoustics/ray-field`,
  `/api/acoustics/energy-map`, each with a `/api/public/*` read-only twin only if shared.
- `models/schemas.py`: settings gain `air {temperature, humidity, pressure}`, `sh_order`,
  `diffraction`, `tail`, `seed`, `n_slopes`; `sound_speed` and `parallel` become ignored on load.
- Deploy: add `compas_acoustics` to `requirements.txt`; check specklepy and the rest of the app
  against scipy 1.17 and protobuf 7. If that fails, run it as its own worker role in an isolated
  env (same pattern as `compas-sa3`). Update `deploy/README.md` and `deploy/PRODUCTION.md`.
- Benchmark: `backend/tests/benchmarks/bras/bras_ca.py` with the `simulate_pra` interface, and a
  third curve in `bras_benchmark.py`.

**Frontend**

- `PyroomAcousticsSimulationSettings.tsx` + `utils/constants.ts`: output choice mono / FOA / HOA
  order, diffraction toggle, air conditions, tail type and seed under advanced; remove "parallel".
- `AdvancedSettingsSection.tsx`: sound speed replaced by temperature / humidity.
- `DirectivitySelect.tsx`: measured entries disabled for this engine until U5.
- `SimulationResultContent.tsx` / `acousticMetrics.ts`: per-band table, new metrics, Sabine/Eyring
  reference line; gradient-map selector gains C80, STI, G, SPL.
- New overlays in `lib/three/`: reflection paths (order and time filters), optional ray
  particles, energy map through `gradient-map-manager.ts`. All new controls gated by `useCanEdit()`.
- Playback level: one constant compensating the 4π scale change so old and new IRs sound alike;
  `soundscape-serializer.ts` tags saved IRs with their scale.
- Fix stale "ACN/N3D" comment; delete dead `runPyroomacousticsSimulation` and `runSpeckleSimulation`.

**Remove at the end (phase 5)**

- `pyroomacoustics_service.py`, `pyroomacoustics_room_builder.py`, `pyroomacoustics_directivity.py`
  (after U5), the fork steps in auto-deploy (`compas pyroom`, `PipExcludePackages` entry),
  `src/compas_acoustics_gh_components/` and `src/compas_acoustics_test_ghpython/`, root debug scripts.
- Update `.cursor/rules/acoustic-sim.mdc`, `AGENTS.md`, `ARCHITECTURE.md`.

## 7. Phases

0. **Spike (no app change).** Install CA in a scratch env; run `Mono` on a `SimulationMesh`
   through a draft adapter inside the BRAS harness; compare level, timing, RT and run time with
   the current engine on a closed room, an open model and a panel scene. Confirms U3/U4 needs.
1. **Mono behind the engine switch.** Adapter, float32 output, scale change, materials service,
   metrics via `Analyser`. Upstream U1, U2, U3 (geometry move) and U8 (parallel + reciprocity);
   U8 is needed before the switch becomes the default, or few-emitter runs get up to 8× slower.
2. **Ambisonics and diffraction.** FOA/HOA through CA for closed rooms; preflight gating. Upstream U4, U7.
3. **Directivity.** Upstream U5, then re-enable measured sources.
4. **Visualisations.** Reflection paths, energy map, ray particles. Upstream U10.
5. **Retire** the legacy pra path, the fork and the CS Grasshopper components. Upstream U12.

## Verification

- Phase 0 numbers decide go / no-go: direct sound equals 1/(4πr) on the geometric sample; RT
  within the BRAS tolerance already used in `bras_report.py`; run time per source and per pair.
- `pytest backend/tests` (existing pra, mesh, preflight, metrics, materials tests) with the switch
  on both values; new adapter tests: two-sided panel reflects on both sides, open model runs in
  mono, 0.5 m pair exports without wrap, old material ids resolve.
- BRAS report with three engines (legacy pra, CA, PFFDTD), including RS5–RS7 with diffraction on.
- `pnpm exec tsc --noEmit`; then a live run in the app: mono + grid listeners, FOA in a closed
  room, a saved soundscape from before the switch (materials, IR level), and the share view.
