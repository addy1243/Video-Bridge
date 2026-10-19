@echo off
title VideoBridge Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. See the error above.
)
echo.
pause
