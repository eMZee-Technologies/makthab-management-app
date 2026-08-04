@echo off
rem Bring up the Makthab app locally (install, build, migrate, start dev servers).
rem This is a thin wrapper -- see scripts\run.ps1 for the actual steps, or run:
rem   run.bat -Help
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" %*
exit /b %ERRORLEVEL%
