# AGENTS.md — compas_soundscape

## Project

Acoustic soundscape design tool for architectural spaces. A 3D Speckle model viewer connects AI audio
generation (TangoFlux / AudioLDM2), spatial room acoustics simulation (pyroomacoustics, Choras),
sound library search (Freesound / BBC), LLM-driven workflow orchestration (Gemini), and
ambisonic / binaural spatial audio rendering.

## Stack & Ports

| Layer    | Technology                          | Port |
| -------- | ----------------------------------- | ---- |
| Backend  | FastAPI + Uvicorn                   | 8000 |
| Frontend | Next.js 15 + React 19 (App Router)  | 3000 |
| State    | Zustand v5 + zundo undo/redo        | —    |

## Run Commands

```bash
# Backend (from repo root), to run the app
mamba activate compas-toy
cd backend && uvicorn main:app --reload --log-config log_config.json

# Frontend (from repo root), to run the app
cd frontend && pnpm dev

# TypeScript strict gate — must pass before any commit
pnpm exec tsc --noEmit
# or, after heavy frontend changes or new library installation:
pnpm build
```

## Repository Map

```
backend/
  main.py                  # App factory, lifespan, service injection, router registration
  config/constants.py      # ALL backend constants — never hardcode literals elsewhere
  models/schemas.py        # ALL Pydantic request/response schemas
  routers/                 # 14 routers — validate input, dispatch to service, return response
  services/                # Business logic, ML model wrappers, external API clients
  middleware/session.py    # UUID cookie injection → request.state.session_id
  utils/                   # Stateless helpers (audio_processing, file_operations, etc.)
  choras_backend/          # Choras FEM/DG acoustic solver interfaces
  temp/                    # All generated/transient files (gitignored)
    static/sounds/generated/<session_id>/
    static/impulse_responses/
    static/pyroomacoustics_rir/
    simulations/           # Progress JSON + simulation results
    uploads/               # Staged uploads

frontend/src/
  app/page.tsx             # Single "use client" orchestration page (intentionally large)
  app/globals.css          # ALL CSS tokens (colors, shadows) — single source of truth
  components/              # UI components by domain
  store/                   # 24 Zustand stores — always import from @/store barrel
  lib/audio/               # Audio pipeline (AudioOrchestrator, modes, decoders)
  hooks/                   # Domain-scoped custom hooks
  services/api.ts          # All backend API calls via fetchWithErrorHandling()
  types/                   # TypeScript types — barrel export from types/index.ts
  utils/constants.ts       # Frontend constants (AMBISONIC, WAVESURFER_TIMELINE, HRTF, etc.)
```

## Global Hard Rules

1. **No database.** Persistence is filesystem-only under `backend/temp/`.
2. **Never block the request thread.** Heavy jobs (ML, LLM, acoustics) go through
   `services/task_queue.py` pools; return a job ID immediately.
3. **Session-scope all file writes** via `request.state.session_id` (from `middleware/session.py`).
4. **TypeScript strict** — `pnpm build` must pass with 0 errors. No `any`.
5. **One source of truth per layer** — constants in `config/constants.py` (backend) or
   `utils/constants.ts` (frontend); never duplicate magic numbers.
6. **Refresh survival is three separate problems — never treat them as one.**
   Domain state (configs/events/receivers/simulations) → backend
   `data/soundscapes/<session>/<model_id>/soundscape.json`, loaded via `?model_id=` URL param,
   autosaved every 3s. UI/session state (camera, panels, wizard step) → `localStorage` via
   Zustand `persist` (`skipHydration: true` + manual `rehydrate()`); camera bypasses `persist`
   entirely (direct `localStorage.setItem` before `beforeunload`). In-flight jobs (ML/LLM/sim) →
   `sessionStorage` key `compas-inflight-jobs`, resumed by `useJobRecovery`. Mechanics, pitfalls,
   and code patterns: `.cursor/rules/persistence.mdc`.
7. **Debug systematically, not speculatively.** When behavior is unexpected, add `[dbg:*]`-prefixed
   logs at write/read/set sites *before* writing any fix — don't guess-and-check with speculative
   changes (delays, gating, reordering). Full discipline: `global.mdc` § Debugging Discipline.

## Scoped Rules

Detailed rules for each domain live in `.cursor/rules/` and are loaded automatically when you
touch matching files (Cursor by glob, Opencode via `opencode.json`, Claude Code via `CLAUDE.md`).

| File                  | Domain                        | Key paths                                                             |
| --------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `global.mdc`          | Always loaded                 | All files                                                             |
| `run-app-when-debugging.mdc` | Start the app only when debugging needs a live instance | Always loaded — do not run/browser-verify after routine UI edits |
| `persistence.mdc`     | Refresh survival, save/load   | `page.tsx`, `soundscape-serializer.ts`, `soundscape.py`, stores with persist |
| `acoustic-sim.mdc`    | Room acoustics simulation     | `backend/services/pyroomacoustics_service.py`, `choras_backend/**`    |
| `zustand-stores.mdc`  | State management              | `frontend/src/store/**`                                               |
| `task-queue.mdc`      | Background job system         | `backend/services/task_queue.py`, `**/*_worker.py`                    |
| `ui-conventions.mdc`  | UI styling & components       | `frontend/src/components/**`, `globals.css`                           |
| `speckle.mdc`         | Speckle 3D platform           | `backend/services/speckle_service.py`, `backend/routers/speckle.py`   |
| `object-explorer.mdc` | ObjectExplorer, filtering, isolation, view modes | `ObjectExplorer.tsx`, `useSpeckleFiltering.ts`, `useAcousticLayerIsolation.ts`, `VirtualTreeItem.tsx` |
| `sound-rendering.mdc` | Spatial audio pipeline        | `frontend/src/lib/audio/**`                                           |
| `daw-timeline.mdc`    | DAW timeline & WaveSurfer     | `frontend/src/components/audio/daw/**`                                |
| `audio-generation.mdc`| AI audio generation pipeline  | `backend/routers/sounds.py`, `backend/services/sounds_worker.py`, `frontend/src/store/soundscapeStore.ts`, `SoundResultContent.tsx` |
| `gh-csharp-components.mdc` | Grasshopper C# (.gha) component development | `src/compas_acoustics_gh_components/**`, `**/*.csproj`, `**/build_gha.ps1` |
| `frontend-ux.mdc`     | Sidebar wizard & card flow    | `frontend/src/components/layout/**`, `store/cardFlowStore.ts`         |
| `chrome-devtools.mdc` | Browser debugging via chrome-devtools MCP | `frontend/**`, dev-mode `_next/static/chunks` reverse-engineering |
