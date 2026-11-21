# Acoustic job scheduling: plan (revised after the 2026-11-21 benchmark)

## Context

On 2026-11-21 eight ray-tracing simulations ran at once on the production host (i9-9900K, 8 cores / 16 threads,
63 GB). With 8 CPU slots x 8 processes each, they shared 64 processes, every job finished at the end (35-72 min each),
and the CPU queue served short jobs (preflight, path views, SED, loop) only after them. Wave (PFFDTD) and hybrid jobs
hold the single GPU slot for their whole run, including the hybrid's CPU-only ray part, and that ray part starts its
own processes outside the CPU worker's accounting.

Goal: a lone simulation runs as fast as the machine allows, several users share fairly, short jobs never wait behind
simulations, memory never runs out, and the GPU is never idle while wave jobs wait.

## What the benchmark showed

Production settings (FOA, ISM order 2, 29 000 rays, UDFA), the app's own `simulate_pairs`, 32 pairs (16 sources x 2
receivers), 4 rooms: real office 640 m3 / 97 walls, small office 61 m3, L corridor 318 m3, hall 7 390 m3 (9.4 s
responses). Scripts and raw data: `scratchpad/bench` of the session (`run_one.py`, `driver.py`, `results.jsonl`).

| finding | numbers |
| --- | --- |
| One job saturates the host at 4-8 processes | office 1/2/4/8/16 processes: 2113/1185/861/732/645 s; small and corridor gain nothing past 8 |
| compas_acoustics threads are the hidden parallelism | it renders a part's pairs on threads sized by `os.cpu_count()`: per-source time in the office grows from 144 s (2 processes) to 588 s (16) |
| 16 processes cost memory, not speed | office 8 -> 16: -12 % time, +58 % memory; small 16.4 -> 18.7 GB for no gain |
| Memory scales with the response length | hall ~9 GB per process (35 GB at 4 processes); office ~0.8 GB |
| Concurrent jobs barely raise throughput | office 2x8 / 4x4 / 8x2: 2-6 % faster than one after another; small 9-25 % |
| ...and delay every result, and can run out of memory | office 8x2: first result after 4289 s instead of 645 s; small 8x2: 5 of 8 jobs out of memory |
| Cutting a job into more parts than processes is free | office 8/16/32 parts at 8 processes: 732/688/689 s; rays are traced per pair already |
| Splitting one emitter's rays over processes is not worth it | mono, 1 -> 16 processes: office 340 -> 282 s, hall (1 -> 4) 80 -> 70 s |
| The FDN (late reverberation) is not a target | 0-5 % of the time in every room |
| Where the time goes | early reflections incl. diffraction 37-68 %, ray tracing 19-39 %, ambisonic encoding 10-19 % |

Consequence for the design: the fine-grained shared process pool considered before (tasks from all jobs on one pool)
would gain at most a few percent of throughput. What matters is how many simulations run at once, in which order,
within which memory budget, and that short jobs and the GPU have their own lanes.

## Design

1. **At most 2 simulations at once, 8 processes each** (cores // 2). A lone job runs at ~90 % of the best possible
   speed; two users each get half; further jobs wait.
2. **Fair order**: the next simulation comes from the workspace with the fewest simulations running; within a
   workspace, oldest first (a user's batch finishes one by one, results arrive every few minutes).
3. **Memory admission**: a simulation starts only if its estimated peak fits the free budget; long-response rooms get
   fewer processes (the hall: 4).
4. **Light lane** for short CPU jobs, with their own slots.
5. **GPU lane**: wave and hybrid jobs hold the GPU only during the engine run; their CPU stages run meanwhile.

## Phases

### Phase 0: interim slot count (done 2026-11-21)

`C:\compas\compas-lib.ps1`: CPU worker `--slots 2`, so `PYROOMACOUSTICS_MAX_PROCESSES` = 16 // 2 = 8 (commit fe06c03
makes it cores // slots). Applied by `compas restart cpu` (Administrator) or the next deploy. Short jobs can still wait
behind two simulations until phase 1.

### Phase 1: light lane (done 2026-11-21)

- `services/job_store.py`: `enqueue(..., queue=None)` stores a `queue` field in the hash; `cancel`, the reaper's
  requeue, `requeue_tail`, `get` (position) and the queued-job expiry read it, falling back to `_queue_key_for_type`.
- Routers enqueue onto `queue:cpu-light` (new constant next to `JOB_TYPE_QUEUE` in `config/constants.py`):
  preflight (`routers/simulation_preflight.py`), acoustic paths (`routers/acoustic_paths.py`), voxel preview
  (`routers/pffdtd.py`), SED, loop, directivity import and preset build.
- `workers/cpu_runner.py`: a second set of `CPU_LIGHT_SLOTS` (default 2) slot threads leasing `queue:cpu-light`
  (reuse `MultiSlotSubprocessRunner`; only `queue_key` differs). Same service, no production change.
- `pool_depths` + `QueueStatusResponse` gain `cpu_light`.
- Tests: `backend/tests/test_job_store.py` (queue override through cancel, requeue, position, expiry).

### Phase 2: simulation admission and fair order (done 2026-11-21)

As built: routing by job type and variant inside `job_store.enqueue` (`sim_scheduler.queue_for`), so the
routers are unchanged; the light lane and the simulation slots run in the same CPU worker (`CpuRunner.lanes`).
Memory admission is two simple rules instead of a per-job budget: a further simulation starts only with
`SIM_START_MIN_FREE_GB` free, and each job sizes its processes from the RAM free at its start and its Eyring
T60 (`sim_scheduler.simulation_processes`, calibrated on the benchmark). The cards keep their
"Queued — position N of M" text; N is now the fair order.


- New `services/sim_scheduler.py` (Redis, atomic Lua): per-workspace lists `simq:<workspace>`, a running-count hash,
  `SIM_MAX_CONCURRENT` (2). `lease()` picks the workspace with the fewest running simulations (ties: oldest head job),
  pops its oldest job, checks memory admission, increments the count; `release()` on complete, fail, cancel and in the
  reaper.
- Simulation jobs (`pyroomacoustics_speckle`/`_geometry`) enqueue there instead of `queue:cpu`; the CPU runner's
  simulation slots lease from the scheduler. `get()` reports the policy position ("N simulations ahead").
- Memory admission: estimate a job's peak from its response length and pairs per part (compas_acoustics' own
  `peak = 17 * samples * delays * 8` per pair, x pairs rendered at once, x processes), against
  `SIM_MEMORY_BUDGET_GB` (default: total RAM minus what the services hold). Reduce the job's processes until it fits;
  if it cannot fit beside the running job, it waits. Calibrate the estimate on the benchmark's peaks (`peak_rss_gb`).
- Processes per job: `PYROOMACOUSTICS_MAX_PROCESSES` (8), lowered by admission; passed in the job kwargs so the
  hybrid job uses the same value.
- Frontend: the four "Queued — position N of M" strings (`AcousticsSection.tsx`, `runPffdtdSimulation.ts`,
  `runHybridSimulation.ts`, `pffdtdAnimationStore.ts`) show the scheduler's status text instead.
- Tests: scheduler policy (fakeredis: fairness across workspaces, FIFO within one, admission, release on every exit
  path, reaper).

### Phase 3: honest thread accounting in compas_acoustics (CA PRs, upstream style)

- `simulation_methods/hybrid.py` (pair threads sized by `os.cpu_count()` and a 4 GB budget), `hybrid/envelope.py`
  (default-sized thread pool, `scipy.fft` `workers=-1`): one setting for the threads a render may use.
- Memory: shape the omni late field after projecting onto the ambisonic channels (the 9 x n x 96 array), see the
  2026-11-21 encoding investigation.
- App: pass the thread count per process; re-run the benchmark (`driver.py` plans e1/e2) to choose processes x
  threads per job and recalibrate admission.

### Phase 4: GPU lane for wave and hybrid jobs

- PFFDTD worker `--slots 3`; a Redis GPU semaphore (one holder, fair across workspaces, TTL-renewed by the holder's
  heartbeat) acquired only around the engine run: the pipeline (`pffdtd_backend/pipeline.py`) prints
  `COMPAS_GPU_ACQUIRE` before `run_engine` and waits for a line on stdin; `_run_pipeline`
  (`services/pffdtd_job.py`) acquires and answers, and releases on `COMPAS_GPU_RELEASE`, exit or kill.
  Animation jobs use the same semaphore.
- Hybrid: its geometric part takes a simulation slot from the phase 2 scheduler (and its process count), so it no
  longer runs outside the CPU accounting.
- With a manual crossover and a given duration, the hybrid starts the wave part (GPU) and the geometric part at the
  same time; the automatic (measured T60) mode keeps today's order.
- Cap numba threads in the PFFDTD worker's children (`NUMBA_NUM_THREADS`, e.g. 4) so voxelisation does not take every
  core from running simulations.
- Production: `compas-lib.ps1` pffdtd slots; no new service.

## Verification

- Each phase: unit tests above, `pnpm exec tsc --noEmit`, the backend suite in `compas-toy`.
- Phases 2-4: re-run benchmark subsets with `driver.py` (2 jobs from two workspaces, 8 from one), check
  first-result times, total time and peak memory against the 2026-11-21 tables; a preflight submitted during a full
  batch must start within seconds; a wave job submitted during a hybrid's ray part must start its solve at once.
- Production: watch `C:\compas\logs\CompasWorkerCpu.out.log` and `health-state.json` after each deploy.
