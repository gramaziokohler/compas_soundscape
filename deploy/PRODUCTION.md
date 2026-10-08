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
