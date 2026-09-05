@echo off
REM Remove the Native Messaging host registration on Windows.
setlocal
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.localtranssub.helper" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.localtranssub.helper" /f >nul 2>&1
reg delete "HKCU\Software\Chromium\NativeMessagingHosts\com.localtranssub.helper" /f >nul 2>&1
del /q "%LOCALAPPDATA%\yraverageSub\com.localtranssub.helper.json" >nul 2>&1
del /q "%~dp0messaging_host.bat" >nul 2>&1
echo Native Messaging host removed.
endlocal
