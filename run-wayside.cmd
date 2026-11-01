@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-wayside.ps1" %*
exit /b %ERRORLEVEL%
