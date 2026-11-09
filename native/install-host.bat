@echo off
REM Install the Chrome/Edge Native Messaging host on Windows.
REM Usage: install-host.bat YOUR_EXTENSION_ID [path\to\submeetly-engine.exe]
REM
REM The host is the Rust engine itself: Chrome starts submeetly-engine.exe with
REM the calling origin as first argument and the engine switches to host mode.
REM The manifest alone is not enough on Windows: Chrome/Edge only discover the
REM host through a registry key under HKCU.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if "%~1"=="" (
  echo Usage: install-host.bat ^<chrome-extension-id^> [path\to\submeetly-engine.exe]
  echo Find the ID on chrome://extensions ^(Developer mode^) or edge://extensions.
  exit /b 1
)

set "EXT_ID=%~1"

REM --- locate the engine ---------------------------------------------------
set "ENGINE=%~2"
if not defined ENGINE if exist "%~dp0submeetly-engine.exe" set "ENGINE=%~dp0submeetly-engine.exe"
if not defined ENGINE if defined CARGO_TARGET_DIR if exist "%CARGO_TARGET_DIR%\release\submeetly-engine.exe" set "ENGINE=%CARGO_TARGET_DIR%\release\submeetly-engine.exe"
if not defined ENGINE if exist "%~dp0..\engine-rs\target\release\submeetly-engine.exe" set "ENGINE=%~dp0..\engine-rs\target\release\submeetly-engine.exe"
if not defined ENGINE (
  echo ERROR: submeetly-engine.exe not found. Build it first:
  echo   cargo build --release -p submeetly-engine --manifest-path engine-rs\Cargo.toml
  exit /b 1
)
for %%I in ("%ENGINE%") do set "ENGINE=%%~fI"
if not exist "%ENGINE%" (
  echo ERROR: %ENGINE% does not exist.
  exit /b 1
)

REM --- manifest ------------------------------------------------------------
set "MANIFEST_DIR=%LOCALAPPDATA%\yraverageSubMin"
if not exist "%MANIFEST_DIR%" mkdir "%MANIFEST_DIR%"
set "MANIFEST=%MANIFEST_DIR%\com.yraveragesubmin.helper.json"
del /q "%MANIFEST_DIR%\com.localtranssub.helper.json" >nul 2>&1

REM JSON needs backslashes escaped.
set "ENGINE_JSON=%ENGINE:\=\\%"

> "%MANIFEST%" (
  echo {
  echo   "name": "com.yraveragesubmin.helper",
  echo   "description": "yravgSubMeetly native helper launcher",
  echo   "path": "%ENGINE_JSON%",
  echo   "type": "stdio",
  echo   "allowed_origins": [
  echo     "chrome-extension://%EXT_ID%/"
  echo   ]
  echo }
)

REM --- registry: Chrome, Edge, Chromium ------------------------------------
call :register "HKCU\Software\Google\Chrome\NativeMessagingHosts" "Google Chrome"
call :register "HKCU\Software\Microsoft\Edge\NativeMessagingHosts" "Microsoft Edge"
call :register "HKCU\Software\Chromium\NativeMessagingHosts" "Chromium"

echo.
echo Manifest: %MANIFEST%
echo Engine  : %ENGINE%
echo Reload the extension, then Settings -^> Engine -^> Native helper -^> Start.
endlocal
exit /b 0

:register
reg add "%~1\com.yraveragesubmin.helper" /ve /t REG_SZ /d "%MANIFEST%" /f >nul 2>&1
rem Sisa pendaftaran dari nama lama dibuang supaya tidak ada dua host.
reg delete "%~1\com.localtranssub.helper" /f >nul 2>&1
if errorlevel 1 (
  echo   - %~2: skipped
) else (
  echo   + %~2: registered
)
exit /b 0
