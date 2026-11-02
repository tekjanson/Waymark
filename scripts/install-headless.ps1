#Requires -Version 5.1
<#
.SYNOPSIS
  Windows Installer for Waymark and The Wayside AGY Autonomous Orchestrator.

.DESCRIPTION
  Installs dependencies, compiles all 42 AGY workspace skills & catalog,
  registers Waymark + Google Sheets MCP servers for AGY on Windows,
  verifies or runs Google OAuth2 setup, generates Windows launchers,
  and optionally registers a background Windows Scheduled Task.

.EXAMPLE
  # Run from inside the Waymark repository:
  powershell -ExecutionPolicy Bypass -File .\scripts\install-headless.ps1

  # Run non-interactively and register background Scheduled Task:
  powershell -ExecutionPolicy Bypass -File .\scripts\install-headless.ps1 -NonInteractive -InstallTask

  # One-liner from PowerShell on a fresh Windows machine:
  irm https://raw.githubusercontent.com/tekjanson/Waymark/main/scripts/install-headless.ps1 | iex
#>

[CmdletBinding()]
param(
  [string]$WaymarkDir = $env:WAYMARK_DIR,
  [string]$Branch = $(if ($env:WAYMARK_BRANCH) { $env:WAYMARK_BRANCH } else { 'main' }),
  [string]$SheetId = $env:WAYMARK_SHEET_ID,
  [switch]$NonInteractive,
  [switch]$InstallTask
)

$ErrorActionPreference = 'Stop'

$IsNonInteractive = $NonInteractive.IsPresent -or ($env:NON_INTERACTIVE -eq '1')
$ShouldInstallTask = $InstallTask.IsPresent -or ($env:INSTALL_TASK -eq '1')

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Waymark + Wayside AGY Orchestrator — Windows Installer" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Detect Target Directory
$TargetDir = $WaymarkDir
if ([string]::IsNullOrWhiteSpace($TargetDir)) {
  $PkgPath = Join-Path (Get-Location).Path 'package.json'
  if (Test-Path $PkgPath) {
    $PkgRaw = Get-Content $PkgPath -Raw -ErrorAction SilentlyContinue
    if ($PkgRaw -match '"name"\s*:\s*"waymark"') {
      $TargetDir = (Get-Location).Path
      Write-Host "[OK] Detected existing Waymark workspace at: $TargetDir" -ForegroundColor Green
    }
  }
  if ([string]::IsNullOrWhiteSpace($TargetDir)) {
    $TargetDir = Join-Path $HOME 'Waymark'
  }
}

# 2. Check System Prerequisites
Write-Host "`n-> [1/6] Checking Windows system prerequisites..." -ForegroundColor Blue

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "[ERROR] git is not installed. Install Git for Windows (winget install Git.Git) and rerun." -ForegroundColor Red
  exit 1
}
$GitVer = (& git --version) -replace 'git version ', ''
Write-Host "  [OK] git $GitVer" -ForegroundColor Green

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
  Write-Host "[ERROR] Node.js is not installed. Node.js >= 18 is required (winget install OpenJS.NodeJS.LTS)." -ForegroundColor Red
  exit 1
}
$NodeVer = (& node -v).TrimStart('v')
$NodeMajor = [int]($NodeVer.Split('.')[0])
if ($NodeMajor -lt 18) {
  Write-Host "[ERROR] Node.js v$NodeVer is too old. Please upgrade to Node.js 18 or higher." -ForegroundColor Red
  exit 1
}
Write-Host "  [OK] Node.js v$NodeVer" -ForegroundColor Green

$NpmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $NpmCmd) {
  Write-Host "[ERROR] npm is not installed." -ForegroundColor Red
  exit 1
}
$NpmVer = (& npm -v)
Write-Host "  [OK] npm v$NpmVer" -ForegroundColor Green

$AgyCmd = Get-Command agy -ErrorAction SilentlyContinue
$LocalAgyExe = Join-Path $HOME '.local\bin\agy.exe'
if ($AgyCmd -or (Test-Path $LocalAgyExe)) {
  Write-Host "  [OK] agy CLI is installed" -ForegroundColor Green
} else {
  Write-Host "  [WARN] agy CLI was not found in PATH." -ForegroundColor Yellow
  Write-Host "         Ensure Antigravity CLI (agy.exe) is installed and in PATH before running orchestrator tasks." -ForegroundColor Yellow
}

# 3. Clone or Update Repository
Write-Host "`n-> [2/6] Preparing repository at $TargetDir..." -ForegroundColor Blue
$GitMarker = Join-Path $TargetDir '.git'
if (Test-Path $GitMarker) {
  Write-Host "  Updating existing git repository..."
  Push-Location $TargetDir
  try {
    & git fetch origin 2>$null | Out-Null
  } catch {}
} else {
  Write-Host "  Cloning Waymark repository (branch: $Branch)..."
  & git clone -b $Branch https://github.com/tekjanson/Waymark.git $TargetDir
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Push-Location $TargetDir
}

try {
  # 4. Install Dependencies
  Write-Host "`n-> [3/6] Installing npm dependencies..." -ForegroundColor Blue
  & npm install --no-audit --no-fund --silent
  if ($LASTEXITCODE -ne 0) { throw "Root npm install failed with exit code $LASTEXITCODE" }

  Push-Location (Join-Path $TargetDir 'mcp')
  try {
    & npm install --no-audit --no-fund --silent
    if ($LASTEXITCODE -ne 0) { throw "MCP npm install failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
  Write-Host "  [OK] Dependencies installed successfully." -ForegroundColor Green

  # 5. Compile AGY Skills & Catalog
  Write-Host "`n-> [4/6] Compiling 42 AGY workspace skills & catalog..." -ForegroundColor Blue
  & node scripts/compile-all-agents.mjs --force
  if ($LASTEXITCODE -ne 0) { throw "Skill compilation failed with exit code $LASTEXITCODE" }
  Write-Host "  [OK] 42 skills compiled in .agents\skills\ and catalog generated." -ForegroundColor Green

  # 6. Configure MCP Servers
  Write-Host "`n-> [5/6] Registering Waymark MCP servers in AGY configuration..." -ForegroundColor Blue
  & node scripts/setup-mcp-config.mjs
  if ($LASTEXITCODE -ne 0) { throw "MCP configuration failed with exit code $LASTEXITCODE" }
  Write-Host "  [OK] MCP servers registered (waymark: 12 tools, google-sheets: 11 tools)." -ForegroundColor Green

  # 7. Check / Setup Google Authentication
  Write-Host "`n-> [6/6] Checking Google authentication..." -ForegroundColor Blue
  $AuthOk = $false
  try {
    & node scripts/setup-headless-auth.mjs --check *> $null
    if ($LASTEXITCODE -eq 0) { $AuthOk = $true }
  } catch {}

  if ($AuthOk) {
    Write-Host "  [OK] Google credentials (OAuth and/or Service Account) are verified and ready!" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] Google credentials need configuration." -ForegroundColor Yellow
    if (-not $IsNonInteractive -and [Environment]::UserInteractive) {
      Write-Host "  Launching OAuth2 setup...`n"
      & node scripts/setup-headless-auth.mjs
    } else {
      Write-Host "  To authenticate on this Windows machine, run:"
      Write-Host "    node scripts\setup-headless-auth.mjs`n" -ForegroundColor White
    }
  }

  # 8. Optional Windows Scheduled Task Registration
  if ($ShouldInstallTask) {
    Write-Host "`n-> Registering Windows Scheduled Task 'WaymarkWaysideOrchestrator'..." -ForegroundColor Blue
    $TaskName = 'WaymarkWaysideOrchestrator'
    $NodeExe = $NodeCmd.Source
    $ScriptArgs = "scripts\wayside-orchestrator.mjs"
    if (-not [string]::IsNullOrWhiteSpace($SheetId)) {
      $ScriptArgs = "$ScriptArgs --sheet `"$SheetId`""
    }
    $Action = New-ScheduledTaskAction -Execute $NodeExe -Argument $ScriptArgs -WorkingDirectory $TargetDir
    $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $Settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -RestartCount 999 `
      -RestartInterval (New-TimeSpan -Minutes 1)

    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "  [OK] Scheduled Task '$TaskName' registered and started!" -ForegroundColor Green
  }

  Write-Host ""
  Write-Host "===============================================================" -ForegroundColor Cyan
  Write-Host "  [OK] Windows Installation & Configuration Complete!" -ForegroundColor Green
  Write-Host "===============================================================" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Next Steps:" -ForegroundColor White
  Write-Host "  1. Launch Waymark Web App + Wayside AI together locally:"
  Write-Host "     .\run-waymark.ps1 -WithWayside" -ForegroundColor Cyan
  Write-Host "     (or from cmd.exe: run-waymark.cmd --with-wayside)" -ForegroundColor DarkCyan
  Write-Host ""
  Write-Host "  2. Or launch Wayside Orchestrator standalone (auto-discovers ledger):"
  Write-Host "     .\run-wayside.ps1 [optionalLedgerSpreadsheetId]" -ForegroundColor Cyan
  Write-Host "     (or from cmd.exe: run-wayside.cmd [optionalLedgerSpreadsheetId])" -ForegroundColor DarkCyan
  Write-Host ""
  Write-Host "  3. Or install as a background Windows Scheduled Task:"
  Write-Host "     powershell -ExecutionPolicy Bypass -File .\scripts\install-headless.ps1 -InstallTask -NonInteractive" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  4. Test AGY directly with Gemini Flash:"
  Write-Host "     node scripts\agy-agent-runner.mjs -m `"List all my waymark files`"" -ForegroundColor Cyan
  Write-Host ""
} finally {
  Pop-Location
}
