param(
    [string]$Config = "Release"
)

# Build the net48 GHA plugin and drop the assembly into Grasshopper's
# Libraries folder. GH 8 loads a bare .gha (a dll renamed to .gha with no
# zip manifest) directly from this folder.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$libs = Join-Path $env:APPDATA "Grasshopper\Libraries"

Write-Host "== Building CompasAcoustics (net48, $Config) =="
dotnet build (Join-Path $root "CompasAcoustics.csproj") -c $Config --nologo
if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }

$bin = Join-Path $root "bin\$Config\net48"
if (-not (Test-Path $libs)) { New-Item -ItemType Directory -Path $libs | Out-Null }

$dll = Join-Path $bin "CompasAcoustics.dll"
$gha = Join-Path $libs "CompasAcoustics.gha"
Copy-Item $dll $gha -Force
Write-Host "== Copied to $gha =="

# Remove any stale DLL from a previous install so GH does not load it twice.
$stale = Join-Path $libs "CompasAcoustics.dll"
if (Test-Path $stale) { Remove-Item $stale -Force; Write-Host "Removed stale $stale" }

Write-Host "Done. Restart Grasshopper to load the component (COMPAS > Acoustics)."
