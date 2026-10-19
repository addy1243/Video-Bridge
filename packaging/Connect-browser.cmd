@echo off
title Connect VideoBridge to your browser
echo VideoBridge is installed. Connect the extension once:
echo.
echo 1. Open chrome://extensions or edge://extensions
echo 2. Turn on Developer mode and click Load unpacked.
echo 3. Select this folder (also opened in Explorer):
echo    %~dp0extension
echo 4. Copy the extension ID, then paste it when asked below.
echo.
start "" explorer.exe "%~dp0extension"
call "%~dp0Setup.cmd"
