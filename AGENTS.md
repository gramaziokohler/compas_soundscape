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
# Always activate the environment first
mamba activate compas-toy

# Backend (from repo root)
cd backend && uvicorn main:app --reload

# Frontend (from repo root)
cd frontend && pnpm dev

# TypeScript strict gate — must pass before any commit
cd frontend && pnpm build
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

## Scoped Rules

Detailed rules for each domain live in `.cursor/rules/` and are loaded automatically when you
touch matching files (Cursor by glob, Opencode via `opencode.json`, Claude Code via `CLAUDE.md`).

| File                  | Domain                        | Key paths                                                             |
| --------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `global.mdc`          | Always loaded                 | All files                                                             |
| `acoustic-sim.mdc`    | Room acoustics simulation     | `backend/services/pyroomacoustics_service.py`, `choras_backend/**`    |
| `zustand-stores.mdc`  | State management              | `frontend/src/store/**`                                               |
| `task-queue.mdc`      | Background job system         | `backend/services/task_queue.py`, `**/*_worker.py`                    |
| `ui-conventions.mdc`  | UI styling & components       | `frontend/src/components/**`, `globals.css`                           |
| `speckle.mdc`         | Speckle 3D platform           | `backend/services/speckle_service.py`, `backend/routers/speckle.py`   |
| `sound-rendering.mdc` | Spatial audio pipeline        | `frontend/src/lib/audio/**`                                           |
| `daw-timeline.mdc`    | DAW timeline & WaveSurfer     | `frontend/src/components/audio/daw/**`                                |
| `frontend-ux.mdc`     | Sidebar wizard & card flow    | `frontend/src/components/layout/**`, `store/cardFlowStore.ts`         |
