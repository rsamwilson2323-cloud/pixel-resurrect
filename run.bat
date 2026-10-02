@echo off
setlocal
title PIXEL RESURRECT - Image Restoration Studio

cd /d "%~dp0"

echo ==========================================
echo       PIXEL RESURRECT - IMAGE RESTORATION
echo ==========================================
echo Project: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    echo Install Node.js LTS from https://nodejs.org/
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found.
    echo Reinstall Node.js with npm included.
    pause
    exit /b 1
)

if not exist "package.json" (
    echo [ERROR] package.json not found.
    echo Place run.bat beside package.json.
    pause
    exit /b 1
)

echo Node.js:
node --version

echo npm:
call npm --version
echo.

if not exist "node_modules" (
    echo [INFO] Installing PIXEL RESURRECT dependencies...
    call npm install

    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Dependencies already installed.
)

echo.
echo [INFO] Starting PIXEL RESURRECT...
echo [INFO] Keep this window open.
echo.

call npm run dev

echo.
echo [INFO] PIXEL RESURRECT development server stopped.
pause

endlocal
