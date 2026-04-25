$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

function Test-PythonTk {
  param([string]$Candidate)

  & $Candidate -c "import tkinter as tk; root = tk.Tk(); root.withdraw(); root.destroy()" *> $null
  return $LASTEXITCODE -eq 0
}

$pythonCandidates = @()
if ($env:PYTHON -and (Test-Path -LiteralPath $env:PYTHON)) {
  $pythonCandidates += $env:PYTHON
}

$systemPython = Get-Command python -ErrorAction SilentlyContinue
if ($systemPython -and $systemPython.Source -notlike "*\WindowsApps\python.exe") {
  $pythonCandidates += $systemPython.Source
}

$codexPython = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if (Test-Path -LiteralPath $codexPython) {
  $pythonCandidates += $codexPython
}

$python = $null
foreach ($candidate in $pythonCandidates) {
  & $candidate --version | Out-Null
  if ($LASTEXITCODE -eq 0 -and (Test-PythonTk $candidate)) {
    $python = $candidate
    break
  }
  Write-Warning "Skipping Python without working tkinter/Tcl/Tk: $candidate"
}

if (-not $python) {
  throw "Python with tkinter/Tcl/Tk was not found. Install Python 3.11+ from python.org with the 'tcl/tk and IDLE' option, then rerun this script or set PYTHON to that python.exe."
}

$pythonRoot = Split-Path -Parent $python
$tclRoot = Join-Path $pythonRoot "tcl"
$tclLibrary = Join-Path $tclRoot "tcl8.6"
$tkLibrary = Join-Path $tclRoot "tk8.6"
if ((Test-Path -LiteralPath $tclLibrary) -and (Test-Path -LiteralPath $tkLibrary)) {
  $env:TCL_LIBRARY = $tclLibrary
  $env:TK_LIBRARY = $tkLibrary
}

& $python -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install desktop build requirements."
}

& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --windowed `
  --name "DFT-Automation-Workbench" `
  "dft_automation_workbench.py"
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller build failed."
}

Write-Host "Built: $scriptDir\dist\DFT-Automation-Workbench.exe"
