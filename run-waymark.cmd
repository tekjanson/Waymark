@echo off
setlocal
cd /d "%~dp0"

set "PS_ARGS="
:parse_args
if "%~1"=="" goto run_ps
if /I "%~1"=="--with-wayside" (
  set "PS_ARGS=%PS_ARGS% -WithWayside"
  shift
  goto parse_args
)
if /I "%~1"=="-w" (
  set "PS_ARGS=%PS_ARGS% -WithWayside"
  shift
  goto parse_args
)
if /I "%~1"=="-WithWayside" (
  set "PS_ARGS=%PS_ARGS% -WithWayside"
  shift
  goto parse_args
)
shift
goto parse_args

:run_ps
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-waymark.ps1"%PS_ARGS%
exit /b %ERRORLEVEL%
