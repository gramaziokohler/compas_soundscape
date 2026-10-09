# Local development: run the app in manual terminals (Windows)

> **Running the always-on server (soundisblue.com)? Use [`PRODUCTION.md`](PRODUCTION.md), not
> this file.** That host runs everything as Windows services with auto-deploy. Following the steps
> below there (manual `uvicorn`, manual `pip install`) conflicts with the services.

This is the complete local-dev setup for the **distributed backend** (FastAPI +
Redis job store + resident worker processes + Next.js frontend). Production
nginx/nssm deployment assets are intentionally **not** covered here — this runs
everything in plain terminals on one machine.

> TL;DR — terminals: **Redis** → **backend (uvicorn)** → **workers**
> (gpu/cpu/choras, plus **sa3** for the default Stable Audio 3 model — see §0.1)
> → **frontend (pnpm dev)**. Then open `http://localhost:3000`.

---

## 0. Prerequisites

| Tool | Notes |
| ---- | ----- |
| Conda / Mamba env **`compas-toy`** | `mamba activate compas-toy` — used for backend + gpu/cpu/choras workers (dev-machine name; the production host uses `compas-soundscape`) |
| Conda / Mamba env **`compas-sa3`** | Isolated Python 3.10 / torch 2.7.1 env for **Stable Audio 3** (the default text-to-audio model) — see §0.1 |
| **Redis** (Memurai or redis-windows) | See §2. Nothing runs jobs without it |
| **Node / pnpm** | Frontend; `pnpm --version` |
| GPU with ≥ ~10 GB VRAM | Audio generation; use `TANGOFLUX_DTYPE=bfloat16` for ≤12 GB, 1 GPU worker only |

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

## 0.1 Stable Audio 3 (`compas-sa3`) — isolated environment

Stable Audio 3 (`stabilityai/stable-audio-3-small-sfx`, the **default
text-to-audio model**) needs **Python 3.10 + torch 2.7.1 + transformers 5 +
numpy 2**. Those are incompatible with `compas-toy` (torch 2.4 / transformers
4.44 / numpy 1.26, pinned by TangoFlux), so it runs in a **separate env** and a
**separate worker** (`--role sa3`, queue `queue:sa3`). The FastAPI process never
imports `stable_audio_3`; only the sa3 worker does.

Run these once on a new machine:

```powershell
# 1. Clone the model package (the pip-installable "stable-audio-3" source)
git clone https://github.com/Stability-AI/stable-audio-3 C:\repos\stable-audio-3

# 2. Create the isolated env (Python 3.10)
mamba create -n compas-sa3 python=3.10 -y
mamba activate compas-sa3

# 3. Install the package and its pinned stack (pulls torch 2.7.1, torchaudio,
#    transformers 5, numpy 2, soundfile, huggingface-hub, einops).
cd C:\repos\stable-audio-3
pip install -e .

# Make sure the GPU build of torch is present (Windows uses the cu126 index):
#   pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu126

# 4. The worker reuses the repo's Redis job store + dotenv loader, and the shared
#    resampler (backend/utils/resampling.py, scipy) — install just those into this env:
pip install redis python-dotenv scipy

# 5. Sanity check (import only — weights download on the first real job):
python -c "from stable_audio_3 import StableAudioModel; print('ok')"
```

Gated weights: accept the license at
<https://huggingface.co/stabilityai/stable-audio-3-small-sfx>, then set a token
in the repo-root `.env` as `HF_TOKEN=hf_...`. The first sa3 job downloads
`model.safetensors` plus the `google/t5gemma-b-b-ul2` text encoder bundled in the
same snapshot. After that you can set `HF_HUB_OFFLINE=1` to load from cache
without a token.

Optional overrides (repo-root `.env`): `STABLE_AUDIO_MODEL` (default `small-sfx`),
`STABLE_AUDIO_PYTHON` (absolute path to the `compas-sa3` `python.exe` if the env
is not on `PATH`), `STABLE_AUDIO_LOCAL_DIR` (mirror weights to a plain local dir
on Windows, same idea as `TANGOFLUX_LOCAL_DIR`), `SA3_WORKER_SLOTS` (default 1).

Running the sa3 worker (its own terminal — see §4):

```powershell
mamba activate compas-sa3
cd backend
python -m workers.worker_main --role sa3 --slots 1 --worker-id sa3-1
```

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
| `HF_TOKEN` | Token for the gated `stabilityai/stable-audio-3-small-sfx` repo (default TTA model) | yes for Stable Audio 3, or `HF_HUB_OFFLINE=1` once cached |
| `STABLE_AUDIO_MODEL` | Stable Audio 3 variant (default `small-sfx`) | optional |
| `STABLE_AUDIO_PYTHON` | Path to the `compas-sa3` `python.exe` if the env is not on `PATH` | optional |
| `STABLE_AUDIO_LOCAL_DIR` | Mirror Stable Audio 3 weights to a plain local dir on Windows | optional |
| `REDIS_URL` | Default `redis://127.0.0.1:6379/0` | optional override |
| `GPU_WORKER_SLOTS`, `CPU_WORKER_SLOTS`, `CHORAS_WORKER_SLOTS`, `SA3_WORKER_SLOTS` | Slot counts read by `--slots` defaults / docs | optional |
| `LLM_MAX_CONCURRENT` (8), `TTS_MAX_CONCURRENT` (2), `GPU_QUEUE_PER_SESSION_MAX` (3) | Concurrency tuning | optional |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access team domain + app Audience tag. When set, the verified Access email is the user identity (multi-user mode). | for multi-user behind Cloudflare |
| `LOADTEST_SERVICE_TOKEN_IDS` | Comma-separated Cloudflare service-token client ids allowed to act as synthetic load-test users (`X-Loadtest-User` header). Unset = disabled. See `scripts/loadtest/README.md`. | only while load testing |
| `AUTH_DEV_BYPASS`, `DEV_USER_EMAIL` | Local dev identity without Cloudflare | optional |
| `COOKIE_SECURE` (default `true`) | Secure session cookie; set `false` only for plain-HTTP LAN tests | optional |
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
- Check `http://localhost:8000/api/queue/status` → `{"gpu":0,"sa3":0,"cpu":0,"choras":0}`

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

**Stable Audio 3 worker** (the default text-to-audio model) runs in its own
terminal **inside the isolated `compas-sa3` env** — see §0.1:

```powershell
mamba activate compas-sa3
cd backend
python -m workers.worker_main --role sa3 --slots 1 --worker-id sa3-1
```

You should see e.g. `[worker:gpu-1] loading TangoFlux model (resident)...` then
`ready, leasing from queue:gpu`, and `[sa3:sa3-1] model ready ... ready, leasing
from queue:sa3` for the sa3 worker.

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
| Queue depths | `http://localhost:8000/api/queue/status` | `{"gpu":0,"sa3":0,"cpu":0,"choras":0}` |
| Workers | worker terminals | `ready, leasing from queue:*` |
| GPU worker warm-up | gpu terminal | `warm-up generation done in …s` |
| SA3 worker ready | sa3 terminal | `[sa3:sa3-1] model ready … ready, leasing from queue:sa3` |
| Frontend | `http://localhost:3000` | app loads |
| Types (strict gate) | `cd frontend; pnpm exec tsc --noEmit` | no output |
| Unit tests | `cd backend; python -m pytest tests` | all pass |

### Load test (optional)

`scripts/loadtest/run.py` simulates N concurrent users. Each one has its own identity and
workspace, and loads the page, sends presence heartbeats, browses, saves/loads a soundscape, and
runs pyroomacoustics, text-to-audio and LLM jobs. It reports latency per endpoint, job times, queue
depths, and session-isolation checks. It works against localhost or the public deployment through
Cloudflare Access; setup is in `scripts/loadtest/README.md`.

```powershell
mamba activate compas-toy
python scripts/loadtest/run.py --base-url http://localhost:8000 --users 3 --duration 60
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
- **Stable Audio 3 TTA writes a silent / flat `-1.0` file** → the TangoFlux-style
  negative prompt was being applied with guidance > 3, which overflows the
  distilled model to NaN. Fixed: SA3 ignores the negative prompt. Restart the sa3
  worker after pulling.
- **TTA stays "Queued" on `queue:sa3`** → no sa3 worker is running (§4). The
  TangoFlux `--role gpu` worker does not serve SA3 jobs.
- **`No module named 'stable_audio_3'` in the sa3 worker** → it was launched from
  the wrong env; `mamba activate compas-sa3` first (§0.1).
- **`No module named 'redis'` / `'dotenv'` in the sa3 worker** →
  `mamba activate compas-sa3; pip install redis python-dotenv scipy`.
- **`No module named 'scipy'` in the sa3 worker** → same fix (needed by
  `utils/resampling.py` to write output at `AUDIO_SAMPLE_RATE`).
- **401 / gated-repo error loading Stable Audio 3** → accept the model license and
  set `HF_TOKEN` in `.env`, or set `HF_HUB_OFFLINE=1` once the weights are cached.
- **`SPECKLE_TOKEN ... not configured`** → set it in `.env` or Advanced Settings.
- **LLM/TTS disabled warning at startup** → `GOOGLE_API_KEY` missing.
- **Frontend can't reach the API on a LAN IP** → for non-localhost the app uses
  same-origin API paths; serve through the nginx origin or set
  `NEXT_PUBLIC_API_BASE_URL` to point at the backend.
- **Generated files vanished** → they live in `backend/temp/` which is cleaned by
  an age-based janitor (24 h, hourly) — not on restart. Saved soundscapes under
  `backend/data/soundscapes/` are persistent.
