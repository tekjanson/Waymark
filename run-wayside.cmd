@echo off
setlocal
cd /d "%~dp0"

if "%AGY_MODEL%"=="" set "AGY_MODEL=gemini-3.8-flash-high"

set "LEDGER_ID=%~1"
if "%LEDGER_ID%"=="" set "LEDGER_ID=%WAYSIDE_LEDGER_ID%"
if "%LEDGER_ID%"=="" set "LEDGER_ID=%WAYMARK_SHEET_ID%"

if not "%LEDGER_ID%"=="" (
  node scripts\wayside-orchestrator.mjs --sheet "%LEDGER_ID%"
) else (
  node scripts\wayside-orchestrator.mjs
)
exit /b %ERRORLEVEL%
