@echo off
setlocal
cd /d "%~dp0.."
set LAB_PORT=8799

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%LAB_PORT% " ^| findstr LISTENING') do (
  echo [lab] Stopping PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

taskkill /F /IM python.exe /FI "WINDOWTITLE eq lab-server*" >nul 2>&1
echo [lab] Stopped (port %LAB_PORT%)
endlocal
