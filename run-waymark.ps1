#Requires -Version 5.1
<#
.SYNOPSIS
  Launch the local Waymark Web App (and optionally the Wayside AGY Orchestrator) on Windows.

.EXAMPLE
  .\run-waymark.ps1
  .\run-waymark.ps1 -WithWayside
  .\run-waymark.ps1 -Port 3005 -WithWayside
#>

[CmdletBinding()]
param(
  [switch]$WithWayside,
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 3000 }),
  [string]$LedgerId = $(if ($env:WAYSIDE_LEDGER_ID) { $env:WAYSIDE_LEDGER_ID } else { $env:WAYMARK_SHEET_ID })
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Load .env if present
$EnvFile = Join-Path $PSScriptRoot '.env'
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
      $idx = $line.IndexOf('=')
      $key = $line.Substring(0, $idx).Trim()
      $val = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
      if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) {
        [Environment]::SetEnvironmentVariable($key, $val, 'Process')
      }
    }
  }
}

$env:PORT = "$Port"
if ([string]::IsNullOrWhiteSpace($env:GITHUB_SOURCE_LOCAL)) {
  $env:GITHUB_SOURCE_LOCAL = 'true'
}
if ([string]::IsNullOrWhiteSpace($env:AGY_MODEL)) {
  $env:AGY_MODEL = 'gemini-3.8-flash-high'
}

$StartWayside = $WithWayside.IsPresent -or ($env:WITH_WAYSIDE -eq '1')
$WaysideProc = $null

try {
  if ($StartWayside) {
    Write-Host "Starting Wayside AGY Orchestrator in background..." -ForegroundColor Cyan
    $ArgsList = @('scripts\wayside-orchestrator.mjs')
    if (-not [string]::IsNullOrWhiteSpace($LedgerId)) {
      $ArgsList += @('--sheet', $LedgerId)
    }
    $WaysideProc = Start-Process -FilePath 'node' -ArgumentList $ArgsList -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
  }

  Write-Host "Starting Waymark local server at http://localhost:$Port (GITHUB_SOURCE_LOCAL=$($env:GITHUB_SOURCE_LOCAL))..." -ForegroundColor Green
  & node server\index.js
  exit $LASTEXITCODE
} finally {
  if ($WaysideProc -and -not $WaysideProc.HasExited) {
    Write-Host "Stopping Wayside Orchestrator (PID $($WaysideProc.Id))..." -ForegroundColor Yellow
    Stop-Process -Id $WaysideProc.Id -Force -ErrorAction SilentlyContinue
  }
}
