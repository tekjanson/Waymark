#Requires -Version 5.1
<#
.SYNOPSIS
  Launch the Waymark Wayside AGY Autonomous Orchestrator on Windows.

.EXAMPLE
  .\run-wayside.ps1
  .\run-wayside.ps1 -LedgerId "1AbCdEf..."
#>

[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$LedgerId = $(if ($env:WAYSIDE_LEDGER_ID) { $env:WAYSIDE_LEDGER_ID } else { $env:WAYMARK_SHEET_ID }),
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ExtraArgs
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

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

if ([string]::IsNullOrWhiteSpace($env:AGY_MODEL)) {
  $env:AGY_MODEL = 'gemini-3.8-flash-high'
}

if ($ExtraArgs -and $ExtraArgs.Count -gt 0) {
  if (-not $ExtraArgs[0].StartsWith('-') -and [string]::IsNullOrWhiteSpace($LedgerId)) {
    $FirstId = $ExtraArgs[0]
    $Rest = if ($ExtraArgs.Count -gt 1) { $ExtraArgs[1..($ExtraArgs.Count - 1)] } else { @() }
    & node scripts\wayside-orchestrator.mjs --sheet $FirstId @Rest
  } elseif (-not [string]::IsNullOrWhiteSpace($LedgerId) -and ($ExtraArgs -notcontains '--sheet')) {
    & node scripts\wayside-orchestrator.mjs --sheet $LedgerId @ExtraArgs
  } else {
    & node scripts\wayside-orchestrator.mjs @ExtraArgs
  }
} elseif (-not [string]::IsNullOrWhiteSpace($LedgerId)) {
  & node scripts\wayside-orchestrator.mjs --sheet $LedgerId
} else {
  & node scripts\wayside-orchestrator.mjs
}
exit $LASTEXITCODE
