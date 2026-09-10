# Run the COMPAS Soundscape app locally (Windows)

This is the complete local-dev setup for the **distributed backend** (FastAPI +
Redis job store + resident worker processes + Next.js frontend). Production
nginx/nssm deployment assets are intentionally **not** covered here — this runs
everything in plain terminals on one machine.

> TL;DR — 4 terminals: **Redis** → **backend (uvicorn)** → **workers**
> (gpu/cpu/choras) → **frontend (pnpm dev)**. Then open `http://localhost:3000`.

---

## 0. Prerequisites

| Tool | Notes |
| ---- | ----- |
| Conda / Mamba env **`compas-toy`** | `mamba activate compas-toy` — used for backend + workers |
| **Redis** (Memurai or redis-windows) | See §2. Nothing runs jobs without it |
| **Node / pnpm** | Frontend; `pnpm --version` |
| GPU with ≥ ~10 GB VRAM | TangoFlux generation; use `TANGOFLUX_DTYPE=bfloat16` for ≤12 GB, 1 GPU worker only |

Python dependencies are declared in `requirements.txt`:

```powershell
mamba activate compas-toy
python -m pip install -r requirements.txt
```

Frontend dependencies:

```powershell
cd frontend
pnpm install
```

First GPU job downloads the TangoFlux model from Hugging Face automatically
(`declare-lab/TangoFlux`) — it takes a while once and needs disk space.

---

## 1. Environment file (repo root `.env`)

The backend and the workers load `.env.local` (overrides) then `.env` from the
repo root. Create/keep them there. Recognized keys (values never printed here):

| Variable | Purpose | Required? |
| -------- | ------- | --------- |
| `GOOGLE_API_KEY` | Gemini LLM + TTS | yes for LLM agents / speech |
| `SPECKLE_TOKEN` | Speckle 3D model fetch (get at app.speckle.systems) | yes for 3D scenes |
| `SPECKLE_PROJECT_NAME` | Default Speckle project (`soundscape-viewer`) | optional |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Alt LLM providers | optional |
| `TANGOFLUX_DTYPE` | `bfloat16` halves VRAM (~9-10 GB) vs fp32 (~18-20 GB); leave empty for fp32 | for small GPUs |
| `FORCE_CPU_MODE` | `true` = run audio on CPU (very slow) | optional |
| `REDIS_URL` | Default `redis://127.0.0.1:6379/0` | optional override |
| `GPU_WORKER_SLOTS`, `CPU_WORKER_SLOTS`, `CHORAS_WORKER_SLOTS` | Slot counts read by `--slots` defaults / docs | optional |
| `LLM_MAX_CONCURRENT` (8), `TTS_MAX_CONCURRENT` (2), `GPU_QUEUE_PER_SESSION_MAX` (3) | Concurrency tuning | optional |
| `FRONTEND_ORIGIN` | CORS origin (default `http://localhost:3000`) | only when changed |
| `CORS_ALLOW_ALL` | `true` = open CORS (dev only) | optional |

Example for a 10-12 GB GPU:

```dotenv
GOOGLE_API_KEY=...
SPECKLE_TOKEN=...
TANGOFLUX_DTYPE=bfloat16
```

> Note: the Speckle token can also be set later from the app (Advanced Settings)
> — that value is stored in Redis so workers pick it up. An env-file
> `SPECKLE_TOKEN` always wins over the Redis value.

---

## 2. Redis

Pick **one** server (both accept `deploy/redis/redis.windows.conf`):

### Option A — Memurai (recommended)
Install [Memurai Developer](https://www.memurai.com/get-memurai), then either
start it via its service or run once:

```powershell
memurai.exe --port 6379
```

### Option B — redis-windows (BSD Redis 7.2 build)
Download a release, then start it **from the repo root** so the relative log/dir
paths in the config work, or run it from anywhere with:

```powershell
redis-server.exe C:\path\to\compas_soundscape\deploy\redis\redis.windows.conf
```

`deploy/redis/redis.windows.conf` binds `127.0.0.1:6379` with `maxmemory 256mb`
and no persistence (fine for dev; the job store is ephemeral state by design).

**Verify** in any terminal:

```powershell
redis-cli ping     # → PONG
```

If Redis is NOT running, the backend still boots but prints once:
`[job-store] Redis is not reachable ... background jobs are disabled until it is up.`
Start Redis and it picks it up automatically (no API restart needed).

---

## 3. Backend (FastAPI)

```powershell
mamba activate compas-toy
cd backend
uvicorn main:app --reload --log-config log_config.json
```

- Serves the API on `http://localhost:8000`
- Interactive docs: `http://localhost:8000/docs`
- Smoke check: `http://localhost:8000/api/versions` (needs the backend running;
  the `[env] .env*` lines at startup tell you which env file was found)
- Check `http://localhost:8000/api/queue/status` → `{"gpu":0,"cpu":0,"choras":0}`

---

## 4. Workers (one terminal per process)

Each worker leases its queue from Redis. **Start these after the backend** (they
need Redis, not the API).

```powershell
mamba activate compas-toy
cd backend

# TangoFlux GPU worker — 1 slot per process (one resident model).
# Start ONE if your card is ≤ ~12 GB (with TANGOFLUX_DTYPE=bfloat16).
# Start a SECOND process for a second lane only if VRAM allows (≥ ~20 GB fp32).
python -m workers.worker_main --role gpu --slots 1 --worker-id gpu-1

# CPU worker — runs pyroomacoustics / SED / loop. 4 child slots.
python -m workers.worker_main --role cpu --slots 4 --worker-id cpu-1

# Choras worker — FEM/DG acoustics. 1 slot.
python -m workers.worker_main --role choras --slots 1 --worker-id choras-1
```

You should see e.g. `[worker:gpu-1] loading TangoFlux model (resident)...` then
`ready, leasing from queue:gpu`.

Notes:
- Workers are **required** for everything job-based: sound generation, LLM text
  generation, model analysis, simulations, SED, loop analysis.
- `--role gpu` ignores `--slots` (always 1 model per process); to double GPU
  throughput open a second terminal with `--worker-id gpu-2`.
- Stop each worker with `Ctrl+C` / `Ctrl+Break`.
- `TANGOFLUX_DTYPE`/`REDIS_URL` etc. are read from the repo-root `.env`, same as
  the API (workers load the env file on startup).

---

## 5. Frontend (Next.js)

```powershell
cd frontend
pnpm dev
```

Open **`http://localhost:3000`**. First time:
1. In **Advanced Settings** add your **Speckle token** (loads a project) and your
   **Google API key** if it isn't already in `.env`.
2. Import/select a Speckle model → the scene loads.
3. Add Context / Usage / Sounds cards and hit **Generate** — you should see the
   job stream progress (partial sounds appear card-by-card as each clip finishes).

Local networking note: on `localhost` the frontend calls the API at
`http://localhost:8000`. On any other hostname it uses **same-origin** URLs
(that's the production nginx path); for plain local dev keep using `localhost`.

---

## 6. Verification & sanity checks

| Check | Command / URL | Expected |
| ----- | ------------- | -------- |
| Redis | `redis-cli ping` | `PONG` |
| API up | `http://localhost:8000/api/versions` | JSON of service versions |
| Queue depths | `http://localhost:8000/api/queue/status` | `{"gpu":0,"cpu":0,"choras":0}` |
| Workers | worker terminals | `ready, leasing from queue:*` |
| GPU worker warm-up | gpu terminal | `warm-up generation done in …s` |
| Frontend | `http://localhost:3000` | app loads |
| Types (strict gate) | `cd frontend; pnpm exec tsc --noEmit` | no output |
| Unit tests | `cd backend; python -m pytest tests` | all pass |

### Load test (optional)

`scripts/load_test.py` fires N LLM + N pyroomacoustics (a box room) + N TangoFlux
jobs from separate sessions and reports first-clip / completion times and queue
depths. Needs Redis + the workers running:

```powershell
mamba activate compas-toy
python scripts/load_test.py --llm 2 --pyroom 1 --sounds 1
```

---

## 7. Troubleshooting

- **`[job-store] Redis is not reachable at ...`** → Redis isn't up. Run §2 and
  the backend/workers will reconnect automatically.
- **`Error 10061` from a worker / job endpoint** → same cause: Redis down.
- **Generation hangs at "Queued"** → no GPU worker is running (or the model is
  still loading — first load is slow). Check the gpu terminal.
- **Worker dies with `Timeout reading from socket` / `Error 10061` while idle** →
  a redis-py blocking `BLPOP`/`pubsub` poll timed out and used to kill the
  worker loop. Fixed: idle polls now return "no job" and the worker reconnects —
  if you still see it, Redis went down and the worker is waiting for it (it
  reconnects automatically, no restart needed).
- **CUDA out of memory** → set `TANGOFLUX_DTYPE=bfloat16` in `.env` and run only
  one `--role gpu` worker.
- **`SPECKLE_TOKEN ... not configured`** → set it in `.env` or Advanced Settings.
- **LLM/TTS disabled warning at startup** → `GOOGLE_API_KEY` missing.
- **Frontend can't reach the API on a LAN IP** → for non-localhost the app uses
  same-origin API paths; serve through the nginx origin or set
  `NEXT_PUBLIC_API_BASE_URL` to point at the backend.
- **Generated files vanished** → they live in `backend/temp/` which is cleaned by
  an age-based janitor (24 h, hourly) — not on restart. Saved soundscapes under
  `backend/data/soundscapes/` are persistent.
