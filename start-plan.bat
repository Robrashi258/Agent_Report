@echo off
rem ============================================================
rem  Start "SuiShou Plan" (production build, no Node.js needed)
rem  Double-click to launch. Close the app window to exit.
rem ============================================================
cd /d "%~dp0"

rem Clear host-injected env var (Electron would degrade to plain Node)
set "ELECTRON_RUN_AS_NODE="

if not exist "out\main\index.js" (
  echo [ERROR] Build output missing. Run: npm run build
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] Electron binary missing. Run: npm install
  pause
  exit /b 1
)

start "" "node_modules\electron\dist\electron.exe" .
