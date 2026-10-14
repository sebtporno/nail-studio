@echo off
chcp 65001 >nul
title Nail studio - local server
cd /d "%~dp0server"

set "PORTABLE=C:\Users\eblo\AppData\Local\Temp\opencode\node-portable\node-v24.21.0-win-x64"

rem --- use system Node.js if present, otherwise the portable copy ---
where node >nul 2>nul
if errorlevel 1 if exist "%PORTABLE%\node.exe" set "PATH=%PORTABLE%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found.
  echo   Install it from https://nodejs.org  ^(LTS button^), then run this file again.
  echo.
  pause
  exit /b 1
)

rem --- first run: install dependencies ---
if not exist "node_modules" (
  echo.
  echo   First run: installing components, please wait 1-2 minutes...
  echo.
  call npm install --no-audit --no-fund
)

echo.
echo   Starting... the browser will open in a few seconds.
echo.
echo     Site:   http://localhost:3000
echo     Admin:  http://localhost:3000/admin.html
echo.
echo   Do not close this window while using the site.
echo.

rem --- open the browser a little later, after the server is up ---
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 4; Start-Process 'http://localhost:3000'"

node src/server.js

echo.
echo   Server stopped.
pause
