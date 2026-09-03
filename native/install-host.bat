@echo off
REM Install Chrome Native Messaging host on Windows.
REM Usage: install-host.bat YOUR_EXTENSION_ID
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Usage: install-host.bat ^<chrome-extension-id^>
  echo Find the ID on chrome://extensions ^(Developer mode^).
  exit /b 1
)

set EXT_ID=%~1
set HOST_PY=%~dp0messaging_host.py
set MANIFEST_DIR=%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts
set MANIFEST=%MANIFEST_DIR%\com.localtranssub.helper.json

if not exist "%MANIFEST_DIR%" mkdir "%MANIFEST_DIR%"

REM Escape backslashes for JSON path
set HOST_JSON=%HOST_PY:\=\\%

> "%MANIFEST%" (
  echo {
  echo   "name": "com.localtranssub.helper",
  echo   "description": "Local TransSub native helper launcher",
  echo   "path": "%HOST_JSON%",
  echo   "type": "stdio",
  echo   "allowed_origins": [
  echo     "chrome-extension://%EXT_ID%/"
  echo   ]
  echo }
)

REM Registry key required on Windows for Chrome to discover the host
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.localtranssub.helper" /ve /t REG_SZ /d "%MANIFEST%" /f >nul

echo Installed Native Messaging host:
echo   %MANIFEST%
echo Reload the extension, then Settings -^> Engine -^> Native helper -^> Start.
endlocal
