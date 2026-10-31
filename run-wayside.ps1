#Requires -Version 5.1
<#
.SYNOPSIS
  Launch the Waymark Wayside AGY Autonomous Orchestrator on Windows.

.EXAMPLE
  .\run-wayside.ps1
  .\run-wayside.ps1 -LedgerId "1AbCdEf..."
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$LedgerId = $(if ($env:WAYSIDE_LEDGER_ID) { $env:WAYSIDE_LEDGER_ID } else { $env:WAYMARK_SHEET_ID })
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($env:AGY_MODEL)) {
  $env:AGY_MODEL = 'gemini-3.8-flash-high'
}

if (-not [string]::IsNullOrWhiteSpace($LedgerId)) {
  & node scripts\wayside-orchestrator.mjs --sheet $LedgerId
} else {
  & node scripts\wayside-orchestrator.mjs
}
exit $LASTEXITCODE
