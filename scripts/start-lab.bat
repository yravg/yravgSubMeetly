@echo off
setlocal
cd /d "%~dp0.."
set LAB_PORT=8799
set LAB_URL=http://127.0.0.1:%LAB_PORT%/lab.html

curl -sf "%LAB_URL%" >nul 2>&1
if %errorlevel%==0 (
  echo [lab] Already running -^> %LAB_URL%
  start "" "%LAB_URL%"
  exit /b 0
)

where python >nul 2>&1
if errorlevel 1 (
  echo ERROR: python not found in PATH
  exit /b 1
)

python -c "import yt_dlp" 2>nul || python -m pip install -q yt-dlp

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%LAB_PORT% " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

start /B "" python scripts\lab-server.py >> .lab-server.log 2>&1

timeout /t 2 /nobreak >nul
curl -sf "%LAB_URL%" >nul 2>&1
if errorlevel 1 (
  echo [lab] ERROR: failed to start - see .lab-server.log
  exit /b 1
)

echo [lab] Started -^> %LAB_URL%
start "" "%LAB_URL%"
endlocal
