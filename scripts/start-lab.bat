@echo off
rem Usage: start-lab.bat [lab]  (default opens app.html, "lab" opens lab.html)
rem Siblings: stop-lab.bat, LAB_PORT default in lab-server.py, _launchers yraverage SubMeetly*.vbs
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "APP_PORT=8799"
set "PID_FILE=.lab-server.pid"
set "LOG_FILE=.lab-server.log"
set "PAGE=app.html"
if /i "%~1"=="lab" set "PAGE=lab.html"
set "LAB_URL=http://127.0.0.1:%APP_PORT%/%PAGE%"

where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: python not found in PATH
    exit /b 1
)

if exist "%PID_FILE%" (
    set "old_pid="
    set /p "old_pid="<"%PID_FILE%"
    for /f "delims=0123456789" %%a in ("!old_pid!") do set "old_pid="
    if defined old_pid taskkill /F /T /PID !old_pid! >nul 2>&1
    del /Q "%PID_FILE%" >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr /R /C:":%APP_PORT% .*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
ping -n 2 127.0.0.1 >nul

python -c "import yt_dlp" 2>nul || python -m pip install -q --disable-pip-version-check yt-dlp

set "PYTHONUNBUFFERED=1"
set "PYTHONUTF8=1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$wd=(Get-Location).Path; $cmd='python scripts\lab-server.py >> %LOG_FILE% 2>&1'; $p=Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/s','/c',$cmd) -WorkingDirectory $wd -WindowStyle Hidden -PassThru; Set-Content -LiteralPath (Join-Path $wd '%PID_FILE%') -Value $p.Id -Encoding ASCII"

ping -n 3 127.0.0.1 >nul
for /L %%i in (1,1,10) do (
    netstat -ano -p tcp | findstr /R /C:":%APP_PORT% .*LISTENING" >nul
    if not errorlevel 1 goto ready
    if not %%i==10 ping -n 2 127.0.0.1 >nul
)
echo Failed on port %APP_PORT%. See %LOG_FILE%; run stop-lab.bat if it is empty.
exit /b 1
:ready
start "" "%LAB_URL%"
echo Running at %LAB_URL%
exit /b 0
