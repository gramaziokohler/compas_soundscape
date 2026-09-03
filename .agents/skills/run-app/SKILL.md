---
name: run-app
description: >-
  Start the COMPAS FastAPI backend (port 8000) and Next.js frontend (port 3000)
  when they are not already running. Use only when the user asks to start the
  app, or when debugging a live bug that requires a running instance. Do not
  start the app after routine UI or code edits, and do not start it as a default
  post-edit verification step.
---

# Run App — compas_soundscape

Start the app only when a live instance is actually needed (debugging, or the
user asked). Check whether ports 8000 and 3000 already respond before launching
anything. If they do, skip this skill.

## 1. Stop Any Existing Servers

Verify ports are free:

```powershell
netstat -ano | Select-String -Pattern ":(8000|3000)\s.*LISTENING"
```

No output means both ports are free. Stale TCP entries (zombie sockets with no running process)
may persist for 10–30 seconds but do not block rebinding.

If ports are not free, run this first. On Windows, uvicorn spawns `multiprocessing.spawn` worker children that
survive after the parent is killed. Run all three commands in order:

```powershell
# Step A — kill uvicorn parent process
Get-Process -Name "uvicorn" -ErrorAction SilentlyContinue | Stop-Process -Force
```

```powershell
# Step B — kill orphaned uvicorn multiprocessing worker children
Get-WmiObject Win32_Process -Filter "Name = 'python.exe' AND CommandLine LIKE '%spawn_main%'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```

```powershell
# Step C — kill the node process listening on port 3000 (Next.js dev server)
$p = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -First 1
if ($p -and (Get-Process -Id $p -ErrorAction SilentlyContinue)) { Stop-Process -Id $p -Force }
```

## 2. Launch Backend (FastAPI, port 8000)

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'Backend'; mamba run -n compas-toy uvicorn main:app --reload" -WorkingDirectory "C:\Users\tbouizargan\repos\compas_soundscape\backend"
```

## 3. Launch Frontend (Next.js, port 3000)

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'Frontend'; mamba run -n compas-toy cmd /c 'pnpm dev'" -WorkingDirectory "C:\Users\tbouizargan\repos\compas_soundscape\frontend"
```
## 4. Wait and verify

Wait and verify frontend:

```powershell
Start-Sleep -Seconds 10; curl.exe -s -o NUL -w "%{http_code}" http://localhost:8000/api/speckle/models
```

Should return `200`.

Wait and verify backend :

```powershell
Start-Sleep -Seconds 12; curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000
```

Should return `200`.

## 5. Final Verification

```powershell
curl.exe -s -o NUL -w "backend: %{http_code}\n" http://localhost:8000/api/speckle/models
curl.exe -s -o NUL -w "frontend: %{http_code}\n" http://localhost:3000
```

Both should return `200`. The app is at:

- Backend:  `http://localhost:8000`
- Frontend: `http://localhost:3000`

## 6. Stop When Done

Repeat the three commands from step 1, then close the two terminal windows manually (they have
`-NoExit` so they persist after the process stops).

## Troubleshooting

**Port still shows LISTENING but curl returns `000`:** A stale TCP socket from a killed uvicorn
worker. It releases within 30 seconds. If it blocks restart, kill orphaned workers again with
step 1B.

**Launch command opens a window but the server never becomes reachable:** Ensure the mamba
environment is activated. Test manually:

```powershell
mamba run -n compas-toy python -c "from main import app; print('OK')"
```
(WorkingDirectory: `backend`)
