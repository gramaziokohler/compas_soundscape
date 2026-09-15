# auto-deploy-watcher.ps1
#
# Watches the compas_soundscape git repo. When new commits appear on origin
# that were NOT authored by you, it pulls and runs the redeploy sequence:
#   stop nginx -> stop frontend -> stop backend -> [npm run build, only if
#   frontend/ files changed] -> start all 3
#
# Run it with:
#   powershell -ExecutionPolicy Bypass -File auto-deploy-watcher.ps1
# Leave the window open. Press Ctrl+C to stop it.

$RepoPath     = "C:\Users\tbouizargan\repos\compas_soundscape"
$FrontendPath = Join-Path $RepoPath "frontend"
$PollSeconds  = 60
$LogFile      = Join-Path $RepoPath "auto-deploy-watcher.log"

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

function Get-NssmStatus {
    param([string]$Service)
    $out = nssm status $Service 2>&1
    $text = ($out -join " ") -replace "`0", ""
    return $text.Trim()
}

function Wait-ServiceState {
    param(
        [string]$Service,
        [string]$TargetState,   # "SERVICE_STOPPED" or "SERVICE_RUNNING"
        [int]$TimeoutSeconds = 30
    )
    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        if ((Get-NssmStatus -Service $Service) -eq $TargetState) { return $true }
        Start-Sleep -Seconds 2
        $elapsed += 2
    }
    return $false
}

function Stop-NssmServiceSafely {
    param([string]$Service)
    Write-Log "Stopping $Service..."
    nssm stop $Service | Out-Null
    if (Wait-ServiceState -Service $Service -TargetState "SERVICE_STOPPED" -TimeoutSeconds 30) {
        Write-Log "$Service stopped."
    } else {
        Write-Log "WARNING: $Service still not SERVICE_STOPPED after 30s (e.g. stop-pending). Continuing anyway."
    }
}

function Start-NssmServiceSafely {
    param([string]$Service)
    Write-Log "Starting $Service..."
    nssm start $Service | Out-Null
    if (Wait-ServiceState -Service $Service -TargetState "SERVICE_RUNNING" -TimeoutSeconds 30) {
        Write-Log "$Service started."
    } else {
        Write-Log "WARNING: $Service did not report SERVICE_RUNNING within 30s."
    }
}

function Invoke-Deploy {
    param([bool]$RunBuild)

    Write-Log "=== Deploy sequence starting (build: $RunBuild) ==="

    Stop-NssmServiceSafely "soundisblue-nginx"
    Stop-NssmServiceSafely "soundisblue-frontend"
    Stop-NssmServiceSafely "soundisblue-backend"

    if ($RunBuild) {
        Write-Log "frontend/ files changed -> running npm run build in $FrontendPath ..."
        Push-Location $FrontendPath
        try {
            $buildOutput = npm run build 2>&1
            $buildOutput | ForEach-Object { Write-Log "  $_" }
            if ($LASTEXITCODE -ne 0) {
                Write-Log "ERROR: npm run build failed (exit code $LASTEXITCODE). Services will still be restarted."
            } else {
                Write-Log "npm run build completed successfully."
            }
        } finally {
            Pop-Location
        }
    } else {
        Write-Log "No frontend/ files changed -> skipping npm run build."
    }

    Start-NssmServiceSafely "soundisblue-nginx"
    Start-NssmServiceSafely "soundisblue-frontend"
    Start-NssmServiceSafely "soundisblue-backend"

    Write-Log "=== Deploy sequence finished ==="
}

# Determine "me" so we can filter out my own commits
Push-Location $RepoPath
$MyEmail = (git config user.email).Trim()
Pop-Location

if (-not $MyEmail) {
    Write-Log "WARNING: could not read local git user.email. All incoming commits will be treated as from other users."
}

Write-Log "Watcher started. Repo: $RepoPath | Me: $MyEmail | Polling every $PollSeconds s"

while ($true) {
    try {
        Push-Location $RepoPath

        $Branch = (git rev-parse --abbrev-ref HEAD).Trim()
        git fetch origin $Branch *> $null

        $LocalHash  = (git rev-parse HEAD).Trim()
        $RemoteHash = (git rev-parse "origin/$Branch").Trim()

        if ($LocalHash -ne $RemoteHash) {
            Write-Log "New commit(s) on origin/$Branch ($LocalHash -> $RemoteHash)."

            $authors = git log --format="%ae" "$LocalHash..origin/$Branch"
            $fromOthers = $false
            foreach ($a in $authors) {
                if ($a.Trim() -ne $MyEmail) { $fromOthers = $true; break }
            }

            if ($fromOthers) {
                Write-Log "At least one commit is from another author. Checking changed files..."

                $changedFiles = git diff --name-only "$LocalHash" "origin/$Branch"
                $frontendChanged = $false
                foreach ($f in $changedFiles) {
                    if ($f -match '^frontend/') { $frontendChanged = $true; break }
                }

                Write-Log "Pulling..."
                git pull origin $Branch

                if ($LASTEXITCODE -eq 0) {
                    Invoke-Deploy -RunBuild $frontendChanged
                } else {
                    Write-Log "ERROR: git pull failed (exit code $LASTEXITCODE). Skipping deploy this cycle."
                }
            } else {
                Write-Log "New commit(s) are all mine ($MyEmail). Fast-forwarding without redeploying."
                git merge "origin/$Branch" --ff-only *> $null
            }
        }
    } catch {
        Write-Log "ERROR in watch loop: $($_.Exception.Message)"
    } finally {
        Pop-Location
    }

    Start-Sleep -Seconds $PollSeconds
}