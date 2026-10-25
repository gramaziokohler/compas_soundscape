# compas: Windows build of the PFFDTD CUDA engine (replaces the Linux Makefile).
#
# Requires: CUDA toolkit (nvcc), Visual Studio 2022 C++ build tools (vcvars64.bat),
# and the compas-pffdtd mamba env (supplies HDF5 headers/libs).
#
# Usage (from any shell):
#   powershell -ExecutionPolicy Bypass -File backend\pffdtd_backend\c_cuda\build_engine.ps1 [-Arch sm_89] [-EnvPrefix <path>]
#
# Outputs: c_cuda\bin\fdtd_main_gpu_single.exe, c_cuda\bin\fdtd_main_gpu_double.exe
# At run time the env's Library\bin must be on PATH (hdf5.dll and deps); pipeline.py does this.

param(
    [string]$Arch = "sm_89",
    [string]$EnvPrefix = "$env:USERPROFILE\.local\share\mamba\envs\compas-pffdtd",
    [string]$VcVars = ""
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $here "bin"
New-Item -ItemType Directory -Force $bin | Out-Null

if (-not $VcVars) {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $candidates = @(
        "$env:ProgramFiles\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
        "$env:ProgramFiles\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat",
        "$env:ProgramFiles\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    )
    if (Test-Path $vswhere) {
        $inst = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($inst) { $candidates = @("$inst\VC\Auxiliary\Build\vcvars64.bat") + $candidates }
    }
    $VcVars = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $VcVars) { throw "vcvars64.bat not found (install VS 2022 C++ build tools)" }

$inc = Join-Path $EnvPrefix "Library\include"
$lib = Join-Path $EnvPrefix "Library\lib"
if (-not (Test-Path (Join-Path $inc "hdf5.h"))) { throw "hdf5.h not found under $inc" }

$common = "-O3 -arch=$Arch -x cu -I`"$here`" -I`"$inc`" -DUSING_CUDA=1 -DH5_BUILT_AS_DYNAMIC_LIB -D_CRT_SECURE_NO_WARNINGS " +
          "-Xcompiler `"/openmp /W3 /wd4996`" -L`"$lib`" -lhdf5"

foreach ($p in @(@{name="single"; prec=1}, @{name="double"; prec=2})) {
    $out = Join-Path $bin "fdtd_main_gpu_$($p.name).exe"
    $cmd = "`"$VcVars`" >nul && nvcc $common -DPRECISION=$($p.prec) `"$here\fdtd_main.c`" -o `"$out`""
    Write-Host "building $out"
    cmd /c $cmd
    if ($LASTEXITCODE -ne 0) { throw "nvcc failed for $($p.name) precision" }
}
Write-Host "done: $bin"
