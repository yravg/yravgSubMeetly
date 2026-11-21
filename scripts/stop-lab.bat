@echo off
rem Siblings: start-lab.bat, LAB_PORT default in lab-server.py
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."
set "APP_PORT=8799"
set "PID_FILE=.lab-server.pid"
set "stopped=0"

if exist "%PID_FILE%" (
    set "server_pid="
    set /p "server_pid="<"%PID_FILE%"
    for /f "delims=0123456789" %%a in ("!server_pid!") do set "server_pid="
    if defined server_pid (
        taskkill /F /T /PID !server_pid! >nul 2>&1
        if not errorlevel 1 set "stopped=1"
    )
    del /Q "%PID_FILE%" >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr /R /C:":%APP_PORT% .*LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    if not errorlevel 1 set "stopped=1"
)

if "!stopped!"=="1" (echo Stopped port %APP_PORT%.) else (echo Port %APP_PORT% is not running.)
exit /b 0
