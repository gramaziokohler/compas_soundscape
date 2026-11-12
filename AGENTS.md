# AGENTS.md — compas_soundscape

## Project

Acoustic soundscape design tool for architectural spaces. A 3D Speckle model viewer connects AI audio
generation (TangoFlux / AudioLDM2), spatial room acoustics simulation (pyroomacoustics, PFFDTD),
sound library search (Freesound / BBC), LLM-driven workflow orchestration (Gemini), and
ambisonic / binaural spatial audio rendering.

## Deployment Docs: which file to use

| Talking about… | Use |
| --- | --- |
| Running the app locally, dev setup, a new dev machine | `deploy/README.md` |
| The always-on server (soundisblue.com), Windows services, auto-deploy, the `compas` CLI, prod logs in `C:\compas\logs\` | `deploy/PRODUCTION.md` (CLI reference: `C:\compas\README.md`) |

On the production host, never tell the user to run `uvicorn`/workers or `pip install -r` by hand.
Use `compas restart <svc>` and `compas deps` instead, because `compas deps` honours
`PipExcludePackages`. Local editable builds such as pyroomacoustics must not be overwritten.

## Run Commands (local dev — see `deploy/README.md`)

The backend env is `compas-toy` on dev machines and `compas-soundscape` on the production host.

```bash
# Redis must be up first (Memurai or redis-windows) — see deploy/README.md
redis-cli ping   # → PONG

# Backend (from repo root), to run the app
mamba activate compas-toy
cd backend && uvicorn main:app --reload --log-config log_config.json

# Worker processes (one terminal each; required for GPU/CPU/SA3/PFFDTD job queues)
cd backend
python -m workers.worker_main --role gpu --slots 1 --worker-id gpu-1     # ×2 for two GPU lanes
python -m workers.worker_main --role cpu --slots 4 --worker-id cpu-1
# PFFDTD GPU wave solver: worker runs in compas-toy and calls the isolated compas-pffdtd
# env + CUDA engine (setup and build: deploy/README.md §0.2)
python -m workers.worker_main --role pffdtd --slots 1 --worker-id pffdtd-1
# Stable Audio 3 (stable-audio-3-small-sfx, the default TTA model) MUST run in the
# isolated compas-sa3 env (torch 2.7.1 / transformers 5 for T5Gemma; incompatible
# with compas-toy). Full env setup on a new machine: deploy/README.md §0.1. One-time:
#   mamba activate compas-sa3 && pip install redis python-dotenv scipy
mamba activate compas-sa3 && python -m workers.worker_main --role sa3 --slots 1 --worker-id sa3-1

# Frontend (from repo root), to run the app
cd frontend && pnpm dev

# TypeScript strict gate — must pass before any commit
pnpm exec tsc --noEmit
# or, after heavy frontend changes or new library installation:
pnpm build
```

## Where Things Live (conventions the directory tree won't show)

- Single sources of truth: `backend/config/constants.py` (all backend constants), `backend/models/schemas.py`
  (all Pydantic schemas), `frontend/src/utils/constants.ts`, `frontend/src/app/globals.css` (all CSS tokens).
- `frontend/src/app/page.tsx` is intentionally one large `"use client"` orchestration page.
- Import stores from the `@/store` barrel and types from `types/index.ts`. All backend calls go through
  `fetchWithErrorHandling()` in `services/api.ts`; jobs are polled via the unified `/api/jobs`.
- Routers only validate, dispatch to a service, and return; `backend/utils/` holds stateless helpers.
- `compas_acoustics_engine.py` is the default geometric-acoustics engine; `hybrid_job.py` runs PFFDTD below
  the crossover and compas_acoustics above. `backend/pffdtd_backend/` is vendored and runs only in `compas-pffdtd`.
- Transient output goes under `backend/temp/` (gitignored); durable data under `backend/data/`
  (`app.db`, `soundscapes/`, `directivities/<user_hash>/`).

## Global Hard Rules

1. **Metadata in SQLite, media on disk.** Durable metadata (users, sessions, workspaces,
   membership, invites, blob refs) lives in `backend/data/app.db` via
   `services/metadata_store.py`. Audio/media stays on the filesystem under `backend/temp/`
   (transient) and `backend/data/` (saved). Redis is a job store / ephemeral state, not a database.
2. **Never block the request thread.** Heavy jobs (ML, acoustics) go through the Redis job store
   (`services/job_store.py.enqueue()`) and run in resident worker processes
   (`workers/worker_main.py --role gpu|cpu|sa3|pffdtd`); LLM/TTS/model-analysis run as in-process
   asyncio tasks (`services/io_jobs.py`). Always return `{job_id, position, total}` immediately.
3. **Scope all file writes to a workspace.** `request.state.session_id` is set by
   `middleware/session.py` to the **workspace id** (identity comes from the Cloudflare Access JWT
   email, or an anonymous session cookie in dev). Use it for every path.
4. **TypeScript strict** — `pnpm build` must pass with 0 errors. No `any`.
5. **One source of truth per layer** — constants in `config/constants.py` (backend) or
   `utils/constants.ts` (frontend); never duplicate magic numbers.
6. **Refresh survival is three separate problems — never treat them as one.**
   Domain state (configs/events/receivers/simulations) → backend
   `data/soundscapes/<session>/<model_id>/soundscape.json`, loaded via `?model_id=` URL param,
   autosaved every 3s. UI/session state (panels, wizard step) → `localStorage` via
   Zustand `persist` (`skipHydration: true` + manual `rehydrate()`). The camera is never
   persisted: every model load/refresh frames the model like "Reset camera view". In-flight jobs (ML/LLM/sim) →
   `sessionStorage` key `compas-inflight-jobs`, resumed by `useJobRecovery`. Mechanics, pitfalls,
   and code patterns: `.cursor/rules/persistence.mdc`.
7. **Debug systematically, not speculatively.** When behavior is unexpected, add `[dbg:*]`-prefixed
   logs at write/read/set sites *before* writing any fix — don't guess-and-check with speculative
   changes (delays, gating, reordering). Full discipline: `global.mdc` § Debugging Discipline.
8. **Speckle uploads land as bundle-only versions — re-materialize them.** Speckle 2026.9 ingestion
   (`startFileIngestion`) stores files as bundles (`referencedObject = bundle.<project>.<model>.<version>`)
   with no legacy object graph; the pinned viewer and the acoustic pipeline cannot read them. The
   backend re-materializes each bundle into a normal legacy version and the client polls for it. Never
   return an ingestion id or a bundle version id as `version_id`, and keep `specklepy[bundle]` +
   `gql>=4` (gql 4 needs `variable_values=`). Full flow and pitfalls: `speckle.mdc` § File Uploads.
9. **Every UI change must work on both Windows and macOS.** Never rely on platform-specific event
   order or modifiers: Cmd must work wherever Ctrl does (`hasModKey()`), shortcut labels go through
   `formatShortcutKeys()`, and right-click/`contextmenu` logic must not assume the Windows
   order (macOS fires `contextmenu` on press, before the drag). Also cover trackpad gestures
   (two-finger tap, Ctrl+click, pinch = Ctrl+wheel). Checklist: `ui-conventions.mdc` §
   Cross-Platform Input.

10. **The public share view is read-only and anonymous.** `/share/<id>` (Cloudflare Access
    bypassed) may only call `/api/public/*` and Speckle. Gate every new editing control with
    `useCanEdit()`. Never expose `SPECKLE_TOKEN` or `/soundscapes/<ws>/…` paths to it. Static
    files it loads go in `frontend/public/assets/` (the only bypassed public folder). See
    ARCHITECTURE.md § Public Share Links.

## Scoped Rules

Detailed rules for each domain live in `.cursor/rules/` and are loaded automatically when you
touch matching files (Cursor by glob, Opencode via `opencode.json`, Claude Code via the `paths:` pointers in `.claude/rules/*.md`).

| File                  | Domain                        | Key paths                                                             |
| --------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `global.mdc`          | Always loaded                 | All files                                                             |
| `run-app-when-debugging.mdc` | Start the app only when debugging needs a live instance | Always loaded — do not run/browser-verify after routine UI edits |
| `persistence.mdc`     | Refresh survival, save/load   | `page.tsx`, `soundscape-serializer.ts`, `soundscape.py`, stores with persist |
| `acoustic-sim.mdc`    | Room acoustics simulation     | `backend/services/pyroomacoustics_service.py`, `backend/pffdtd_backend/**`    |
| `zustand-stores.mdc`  | State management              | `frontend/src/store/**`                                               |
| `task-queue.mdc`      | Background job system         | `backend/services/job_store.py`, `backend/services/io_jobs.py`, `backend/workers/**`, `backend/routers/jobs.py` |
| `ui-conventions.mdc`  | UI styling & components       | `frontend/src/components/**`, `globals.css`                           |
| `speckle.mdc`         | Speckle 3D platform           | `backend/services/speckle_service.py`, `backend/routers/speckle.py`   |
| `object-explorer.mdc` | ObjectExplorer, filtering, isolation, view modes | `ObjectExplorer.tsx`, `useSpeckleFiltering.ts`, `useAcousticLayerIsolation.ts`, `VirtualTreeItem.tsx` |
| `sound-rendering.mdc` | Spatial audio pipeline        | `frontend/src/lib/audio/**`                                           |
| `daw-timeline.mdc`    | DAW timeline & WaveSurfer     | `frontend/src/components/audio/daw/**`                                |
| `audio-generation.mdc`| AI audio generation pipeline  | `backend/routers/sounds.py`, `backend/workers/gpu_runner.py`, `frontend/src/store/soundscapeStore.ts`, `SoundResultContent.tsx` |
| `gh-csharp-components.mdc` | Grasshopper C# (.gha) component development | `src/compas_acoustics_gh_components/**`, `**/*.csproj`, `**/build_gha.ps1` |
| `frontend-ux.mdc`     | Sidebar wizard & card flow    | `frontend/src/components/layout/**`, `store/cardFlowStore.ts`         |
| `chrome-devtools.mdc` | Browser debugging via chrome-devtools MCP | `frontend/**`, dev-mode `_next/static/chunks` reverse-engineering |
