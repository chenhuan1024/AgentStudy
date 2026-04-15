$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "==> Install backend dependencies"
python -m pip install -r "requirements.txt"
python -m pip install pyinstaller

Write-Host "==> Build frontend static files"
Set-Location "$root/frontend"
npm install
npm run build

Set-Location $root
Write-Host "==> Package EXE"
pyinstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name "SiteSelectionTool" `
  --add-data "frontend/build;frontend_build" `
  --collect-all duckdb `
  "run_app.py"

$exePath = Join-Path $root "dist/SiteSelectionTool.exe"
Write-Host "==> Build completed: $exePath"
