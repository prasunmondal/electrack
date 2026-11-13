# Starts the WBSEDCL Bill Tracker locally (backend API + frontend static server).
# Any process already listening on either port is killed first.
#
# Usage:  .\run-local.ps1 [-BackendPort 3000] [-FrontendPort 8080] [-NoBrowser]
param(
  [int]$BackendPort = 3000,
  [int]$FrontendPort = 8080,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

function Stop-PortOwner([int]$port) {
  $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    if ($procId -le 4) { continue }  # never touch System / Idle
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) {
      Write-Host "Port ${port}: stopping $($p.ProcessName) (PID $procId)" -ForegroundColor Yellow
      Stop-Process -Id $procId -Force -Confirm:$false
    }
  }
  # Wait for the port to be released
  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "Port $port is still in use."
}

function Wait-Http([string]$url, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { Start-Sleep -Milliseconds 500 }
  }
  return $false
}

# 1. Kill previous servers
Stop-PortOwner $BackendPort
Stop-PortOwner $FrontendPort

# 2. First-run setup
if (-not (Test-Path (Join-Path $backend "node_modules"))) {
  Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
  Push-Location $backend
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    npx playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw "playwright install failed" }
  } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $backend ".env"))) {
  Copy-Item (Join-Path $backend ".env.example") (Join-Path $backend ".env")
}

# 3. Start servers, each in its own window (close the window or re-run this script to stop)
$env:PORT = "$BackendPort"
$env:FRONTEND_ORIGIN = "http://localhost:$FrontendPort"
Start-Process powershell -WorkingDirectory $backend -ArgumentList @(
  "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'WBSEDCL backend :$BackendPort'; npm start"
)
Start-Process powershell -WorkingDirectory $frontend -ArgumentList @(
  "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'WBSEDCL frontend :$FrontendPort'; npx -y http-server -p $FrontendPort -c-1"
)

# 4. Wait until both respond
$apiUrl = "http://localhost:$BackendPort/api/health"
$webUrl = "http://localhost:$FrontendPort"
if (Wait-Http $apiUrl 30) { Write-Host "Backend  ready: http://localhost:$BackendPort" -ForegroundColor Green }
else { Write-Host "Backend did not respond on $apiUrl - check its window." -ForegroundColor Red }
if (Wait-Http $webUrl 90) { Write-Host "Frontend ready: $webUrl" -ForegroundColor Green }
else { Write-Host "Frontend did not respond on $webUrl - check its window." -ForegroundColor Red }

if ($BackendPort -ne 3000) {
  Write-Host "Note: frontend/config.js points at port 3000; update API_BASE_URL to use port $BackendPort." -ForegroundColor Yellow
}
if (-not $NoBrowser) { Start-Process $webUrl }
