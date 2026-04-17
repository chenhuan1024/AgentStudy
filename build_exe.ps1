$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-LastExitCode([string]$stepName) {
  if ($LASTEXITCODE -ne 0) {
    throw "$stepName 失败，exit code=$LASTEXITCODE"
  }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "==> Install backend dependencies"
python -m pip install -r "requirements.txt"
Assert-LastExitCode "安装后端依赖"
python -m pip install pyinstaller
Assert-LastExitCode "安装 pyinstaller"

Write-Host "==> Build frontend static files"
Set-Location "$root/frontend"
npm install
Assert-LastExitCode "安装前端依赖"
npm run build
Assert-LastExitCode "构建前端"

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
Assert-LastExitCode "打包 EXE"

$exePath = Join-Path $root "dist/SiteSelectionTool.exe"
Write-Host "==> Build completed: $exePath"
