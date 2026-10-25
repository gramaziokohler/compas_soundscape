# Production host (always-on Windows server)

This is the **always-on server** behind `soundisblue.com`. It does **not** run the app in manual
terminals. Every process is an nssm Windows service, kept alive and auto-deployed by a PowerShell
supervisor. For local development (manual terminals, `pnpm dev`, `uvicorn --reload`), see
[`README.md`](README.md) instead.

The operational scripts live **outside this repo**, in `C:\compas\`. Their full CLI reference is
`C:\compas\README.md`. This file covers what you need to know from the repo side.

## Layout

| Piece | Where |
| --- | --- |
| Scripts | `C:\compas\compas.ps1` (CLI `compas`), `compas-lib.ps1`, `compas-supervisor.ps1`, `compas-install.ps1` |
| Config | `C:\compas\config.psd1`: paths, service names, ports, intervals, `EnableAutoDeploy`, `PipExcludePackages` |
| Backend Python env | `PythonExe` = `…\miniconda3\envs\compas-soundscape\python.exe` (**not** `compas-toy`) |
| Stable Audio 3 env | `Sa3PythonExe` = `…\miniconda3\envs\compas-sa3\python.exe` |
| PFFDTD env (not yet installed) | `compas-pffdtd` + built CUDA engine, see `deploy/README.md` §0.2. The worker itself runs in the backend env (`--role pffdtd`); point `PFFDTD_PYTHON` in `.env` at the `compas-pffdtd` `python.exe`. A `CompasWorkerPffdtd` service still has to be added to `config.psd1` / the `compas` CLI. `compas deps` never touches this env. |
| Services | `CompasApi`, `CompasWorkerGpu`, `CompasWorkerCpu`, `CompasWorkerSa3`, `CompasFrontend` (`next start`), `CompasNginx` (:80), `CompasCloudflared`, `Memurai` |
| Supervisor | Scheduled task `CompasSupervisor` (SYSTEM, at boot) → `compas-supervisor.ps1` |
| Request path | Cloudflare Access → tunnel → nginx :80 → `/api/*` FastAPI :8000, `/` Next :3000 |
| Logs | `C:\compas\logs\`: `supervisor.log`, `<Service>.out.log` / `.err.log`, `frontend-build.log`, `pip-install.log`, `health-state.json` |
| App config | repo-root `.env` / `.env.local` (`CF_ACCESS_*`, API keys) |

## How a deploy happens

Nothing is deployed by hand. Every `DeployPollSeconds`, the supervisor:

1. Runs `git fetch`. If `origin/master` moved, it runs `git pull`.
2. Runs `npm run build` if `frontend/` changed.
3. **Checks Python deps by content.** It filters `requirements.txt` by dropping the
   `PipExcludePackages` lines, hashes the result, and compares it with
   `logs\requirements.sha256`. If they differ, it runs `pip install -r` on the filtered file and
   writes the stamp only on success. The check runs every cycle, so a manual `git pull` or a missed
   cycle is caught too. If the install fails, **services are not restarted**.
4. Restarts the API, the frontend and nginx if the frontend changed, then the workers.

## Rules on this host

- **Never run `uvicorn` or workers by hand.** The services already bind the ports. Use
  `compas restart <api|gpu|cpu|sa3|frontend|nginx|all>`.
- **Never `pip install -r requirements.txt` by hand.** Use `compas deps`, which applies the
  exclusions and writes the stamp.
- **Local editable builds:** `pyroomacoustics` is an editable install from
  `C:\Users\soundisblue\repos\pyroomacoustics`. It's listed in `PipExcludePackages`, so the
  `pyroomacoustics==0.9.0` pin never replaces it. Add any future local build there too.
  The simulation needs the fork's C++ `Wall.two_sided` flag (two-sided thin surfaces). After
  pulling fork changes, rebuild with `python setup.py build_ext --inplace` in the repo
  (compas-soundscape env), then run `compas restart cpu`. A running CPU worker locks
  `pyroomacoustics\libroom*.pyd`, which makes the build's final copy fail. Rename the locked file
  aside first (Windows allows renaming a loaded DLL), then re-run the build. If the flag is
  missing, simulations that need it stop with a "rebuild pyroomacoustics" error.
- **Edits to `C:\compas\*.ps1` / `config.psd1`:** the supervisor reloads them on its next loop
  (it compares file timestamps). If in doubt, run `compas restart supervisor`. `compas restart all`
  restarts only the services, **not** the supervisor loop.
- **Reading `*.err.log`:** the logs are appended across restarts. Check the timestamp before you
  conclude an error is current. `compas status` and `compas logs api -f` show the live state.

## Troubleshooting

- **`ModuleNotFoundError` after a deploy:** the deps step didn't run or failed. Check
  `supervisor.log` for `Installing Python deps` / `pip install FAILED`, then `pip-install.log`. Fix
  it, then run `compas deps` followed by `compas restart api`.
- **A new requirement isn't installed but the supervisor logs nothing about deps:** the supervisor
  is running old code. Run `compas restart supervisor`.
- **An excluded package was replaced:** `supervisor.log` warns `is no longer an editable install`.
  Reinstall it with `pip install -e <path>` in the `compas-soundscape` env.
- Everything else (tunnel, Access, nginx, SA3): see `C:\compas\README.md` § Troubleshooting.

## Research study logging

Study interaction logging is off by default. While it is off, every `/api/study/*` route returns 404 and no server hooks run.

1. Before day 1, check free disk on the host. The audio archive stops copying below `STUDY_ARCHIVE_MIN_FREE_GB` (5 GB).
2. Set `STUDY_LOGGING_ENABLED=1` in the backend `.env`. Optional kill switches (they default to on while the master switch is on): `STUDY_FEATURE_SNAPSHOTS`, `STUDY_FEATURE_STATE_DIFF`, `STUDY_FEATURE_POSE_SAMPLING`, `STUDY_FEATURE_AUDIO_ARCHIVE`, `STUDY_FEATURE_SERVER_JOB_EVENTS`, `STUDY_FEATURE_MOMENT_SCREENSHOT` (`=0` disables one).
3. Run `compas restart backend`. The frontend reads `/api/study/config`, so it does not need a redeploy.
4. During the study, from `backend/`, run `python scripts/export_study_logs.py --summary`. It shows event counts per group and participant (last hour and total), archive size and free disk.
5. After the study, run `python scripts/export_study_logs.py --out <dir> --groups groups.csv` (columns `workspace_id,group_label` or `owner_email,group_label`). Keep `participants_key.csv` (pseudonym → email) apart from the pseudonymised group folders.

The data lives in `backend/data/study/`: `study_log.db`, `audio/` and `moments/`.
