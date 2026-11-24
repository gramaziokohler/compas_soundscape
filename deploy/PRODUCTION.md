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
| Config | `C:\compas\config.psd1`: paths, service names, ports, intervals, `EnableAutoDeploy`, `Pffdtd*` / `Cuda*` |
| Backend Python env | `PythonExe` = `…\miniconda3\envs\compas-soundscape\python.exe` (**not** `compas-toy`) |
| Stable Audio 3 env | `Sa3PythonExe` = `…\miniconda3\envs\compas-sa3\python.exe`. `compas deps` never touches it: its worker packages (`redis python-dotenv scipy librosa`, deploy/README.md §0.1) come from `Install-CompasSa3Env` in `compas-lib.ps1`. A new SA3 worker dependency is installed by hand (ask first, see AGENTS.md) and added to that function. |
| PFFDTD env | `PffdtdPythonExe` = `…\miniconda3\envs\compas-pffdtd\python.exe` (from `backend/pffdtd_backend/environment.yml`). The worker runs in the backend env (`--role pffdtd`) and calls this interpreter. The services get `PFFDTD_PYTHON` from `config.psd1` through nssm, so it is **not** set in `.env`. `compas deps` never touches this env. |
| PFFDTD engine | `backend/pffdtd_backend/c_cuda/bin/*.exe`, built for `PffdtdCudaArch` = `sm_75` (RTX 2080 Ti) with `nvcc` from the `compas-cuda` conda env (`cuda-nvcc` 13.3, the driver's max CUDA). There is no system CUDA toolkit, so no installer can touch the display driver. VS 2026 Build Tools provide `cl.exe`. |
| Services | `CompasApi`, `CompasWorkerGpu`, `CompasWorkerCpu`, `CompasWorkerSa3`, `CompasWorkerPffdtd`, `CompasFrontend` (`next start`), `CompasNginx` (:80), `CompasCloudflared`, `Memurai` |
| Supervisor | Scheduled task `CompasSupervisor` (SYSTEM, at boot) → `compas-supervisor.ps1` |
| Request path | Cloudflare Access → tunnel → nginx :80 → `/api/*` FastAPI :8000, `/` Next :3000 |
| Logs | `C:\compas\logs\`: `supervisor.log`, `<Service>.out.log` / `.err.log`, `frontend-build.log`, `pip-install.log`, `pyroomacoustics-build.log`, `pffdtd-build.log`, `pffdtd-setup.log`, `health-state.json`, `*.stamp` / `*.failed` |
| App config | repo-root `.env` / `.env.local` (`CF_ACCESS_*`, API keys) |

## How a deploy happens

Nothing is deployed by hand. Every `DeployPollSeconds`, the supervisor:

1. Runs `git fetch`. If `origin/master` moved, it runs `git pull`.
2. Runs `npm run build` if `frontend/` changed.
3. **Checks Python deps by content.** It filters `requirements.txt` by dropping the
   the requirements file, hashes the result, and compares it with
   `logs\requirements.sha256`. If they differ, it runs `pip install -r` on the filtered file and
   writes the stamp only on success. The check runs every cycle, so a manual `git pull` or a missed
   cycle is caught too. If the install fails, **services are not restarted**.
4. **Keeps PFFDTD in sync.** It updates the `compas-pffdtd` env when `environment.yml` changed, and
   rebuilds the CUDA engine when the `c_cuda/` sources, the arch or the CUDA version changed. Both
   checks compare content hashes in `logs\pffdtd-*.stamp`.
6. Restarts the API, the frontend and nginx if the frontend changed, then the workers (GPU, CPU,
   SA3, PFFDTD).

Step 4 moves loaded `.exe` files aside before building (Windows allows renaming them, not
overwriting them). If a build fails, the old files are put back. A failure is recorded in
`logs\*.failed`, and that input is not retried every cycle: it retries on a new commit or on
`compas pffdtd-build`. `supervisor.log` says which.

## Rules on this host

- **Never run `uvicorn` or workers by hand.** The services already bind the ports. Use
  `compas restart <api|gpu|cpu|sa3|pffdtd|frontend|nginx|all>`.
- **Never `pip install -r requirements.txt` by hand.** Use `compas deps`, which applies the
  exclusions and writes the stamp.
- **Room acoustics dependencies:** `compas deps` installs both `compas_acoustics` (no extras;
  it always brings pyFDN and `compas_pb`) non-editably and its compatible
  `pyroomacoustics>=0.10.1` dependency into the `compas-soundscape` environment. Neither package
  is excluded from the requirements file. `compas_pb` needs protobuf >= 6.31, so TensorFlow is
  pinned to 2.20 (2.18/2.19 cap protobuf below 6). The first `compas deps` after the 2.18 -> 2.20
  bump must start from an env without 2.18: run
  `python -m pip uninstall -y tensorflow tensorflow_intel tf_keras` in `compas-soundscape` first
  (2.18's Windows files belong to `tensorflow_intel`, which pip would otherwise leave behind).
  To fall back to the legacy engine, set `ACOUSTICS_ENGINE=pyroomacoustics` in `.env` and restart
  `api` and `cpu`.
- **PFFDTD:** provisioned with `compas pffdtd-setup` (CUDA compiler env, `compas-pffdtd` env,
  engine, worker service; idempotent). To force an engine rebuild, run `compas pffdtd-build`. For a
  different GPU, change `PffdtdCudaArch` in `config.psd1`; the next cycle rebuilds.
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
- **A room-acoustics package is missing or stale:** run `compas deps`, then
  `compas restart api`, `compas restart cpu` and `compas restart pffdtd` (the pffdtd worker runs
  the hybrid jobs, which import compas_acoustics).
- **Updating compas_acoustics:** `requirements.txt` pins one commit of the fork's
  `engine-integration` branch, not the branch. Pushing a new commit there changes nothing in
  production; bumping the pin on `master` does: the file's hash changes, so the auto-deploy
  reinstalls CA in the same cycle as the app code that needs it, then restarts the services.
  Run `compas deps` and the three restarts above only to repair an install.
- Everything else (tunnel, Access, nginx, SA3): see `C:\compas\README.md` § Troubleshooting.

## Public share links

`/share/<share_id>` is a read-only, embeddable player that works without a login. To enable it:

1. Create a Speckle personal access token with only `streams:read`, on the account that owns the
   models. Set `SPECKLE_SHARE_TOKEN=<token>` in the backend `.env`, then run
   `compas restart api`. Without it, share links answer 503. Do not reuse `SPECKLE_TOKEN`: the share page hands its token to every visitor, and the server token can write to Speckle.
2. In Cloudflare Zero Trust → Access, add **self-hosted applications** on `soundisblue.com` for
   these paths, each with a **Bypass / Everyone** policy:
   - `share` (the page)
   - `api/public` (the filtered soundscape plus its audio and IRs)
   - `_next` (JS/CSS bundles)
   - `assets` (`frontend/public/assets/`: audio worklets, the listener model, the app icon).
     Any `frontend/public` file the player loads must live under `assets/`, so this one
     bypass keeps covering it. `/favicon.ico` stays behind Access; a share viewer just gets no
     tab icon.

   Path applications take precedence over the root one, so everything else stays behind Access.
   Do **not** bypass `/soundscapes` or `/static`: the share page never uses them.
3. Embedding: `SHARE_FRAME_ANCESTORS` (frontend env, default `*`) sets
   `Content-Security-Policy: frame-ancestors` on `/share/*`. Make sure nginx does not add
   `X-Frame-Options` on that path.

Share viewers hear sources omnidirectionally, because directivity balloons are behind the
authenticated API.

## Research study logging

Study interaction logging is off by default. While it is off, every `/api/study/*` route returns 404 and no server hooks run.

1. Before day 1, check free disk on the host. The audio archive stops copying below `STUDY_ARCHIVE_MIN_FREE_GB` (5 GB).
2. Set `STUDY_LOGGING_ENABLED=1` in the backend `.env`. Optional kill switches (they default to on while the master switch is on): `STUDY_FEATURE_SNAPSHOTS`, `STUDY_FEATURE_STATE_DIFF`, `STUDY_FEATURE_POSE_SAMPLING`, `STUDY_FEATURE_AUDIO_ARCHIVE`, `STUDY_FEATURE_SERVER_JOB_EVENTS`, `STUDY_FEATURE_MOMENT_SCREENSHOT` (`=0` disables one).
3. Run `compas restart backend`. The frontend reads `/api/study/config`, so it does not need a redeploy.
4. During the study, from `backend/`, run `python scripts/export_study_logs.py --summary`. It shows event counts per group and participant (last hour and total), archive size and free disk.
5. After the study, run `python scripts/export_study_logs.py --out <dir> --groups groups.csv` (columns `workspace_id,group_label` or `owner_email,group_label`). Keep `participants_key.csv` (pseudonym → email) apart from the pseudonymised group folders.

The data lives in `backend/data/study/`: `study_log.db`, `audio/` and `moments/`.

## Data backups

`backend/scripts/backup_data.py` snapshots everything needed to rebuild every model from its
Speckle version: `data/soundscapes/` (soundscape.json, audio, IRs, analysis, results per model),
`data/directivities/`, `data/bug_reports/`, `data/study/` and `app.db`. Not included: `temp/`
(loading a soundscape restores its IRs from `ir_files/`), the ML weights in `data/models` and
`data/tfhub_modules` (downloadable), and the load-test folders `loadtest-*`. The Speckle geometry
itself stays on Speckle; each snapshot's `models.json` lists the server, project and version
every soundscape was built on.

**Schedule.** The `CompasBackup` task (SYSTEM) runs `compas backup run` every night at
`BackupTime` (02:00). It snapshots only when one is due:

| Change since the last snapshot | Snapshot? |
| --- | --- |
| none | no |
| any `soundscape.json`, `*_results.json`, directivity `.npz` or `app.db` row (login sessions excepted) | yes, whatever the size |
| `BackupMinChangeMB` (50 MB) or more of audio / IRs / study data | yes |
| smaller bulk changes | not yet: they add up until one of the rules above fires, or until the last snapshot is `BackupMaxAgeDays` (7) old |

Each snapshot is a full tree in `BackupDir\snapshots\<yyyymmdd-hhmmss>\`, but unchanged files are
NTFS hardlinks to the previous snapshot, so a snapshot costs only the changed bytes. SQLite files
are copied with the online backup API, so they are consistent while the API runs. Retention keeps
the newest snapshot of each of the last 14 days, 8 weeks and 12 months. Snapshot files are
read-only: never edit them in place, since every hardlinked snapshot would change.

**Offsite.** `BackupDir` is on `C:`, like the data, so it does not survive a disk failure. Set
`BackupOffsiteDir` (for example a Google Drive folder on `G:`) and rerun `compas backup-setup`: the
`CompasBackupOffsite` task then mirrors the latest snapshot there at `BackupOffsiteTime` as the
logged-on user (SYSTEM cannot see the Drive mount), plus a zip of the small state files per
snapshot in `history/`. `study/` (participant data) is left out unless
`BackupOffsiteIncludeStudy = $true`. Snapshots contain `app.db` (user emails) and the Speckle
tokens stored in `soundscape.json`, so keep the offsite folder private.

```
compas backup-setup                    # once, elevated: registers the task(s)
compas backup                          # last run, snapshot count, schedule (also in `compas status`)
compas backup now                      # snapshot now, whatever the rules say
compas backup list
compas backup restore latest --workspace <ws> --model <model>              # copy to BackupDir\restores\
compas backup restore latest --workspace <ws> --model <model> --in-place   # live folder moved aside first
compas backup restore <snapshot>       # whole snapshot to a folder; to put it back: compas stop,
                                       # copy over backend\data\, compas start
```

Logs: `BackupDir\backup.log` and `last-run.json`. A failed run is written to `supervisor.log` and the
Windows event log (source `CompasSupervisor`).
