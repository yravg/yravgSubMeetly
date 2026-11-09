@echo off
REM Remove the Native Messaging host registration on Windows.
setlocal
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.yraveragesubmin.helper" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.yraveragesubmin.helper" /f >nul 2>&1
reg delete "HKCU\Software\Chromium\NativeMessagingHosts\com.yraveragesubmin.helper" /f >nul 2>&1
del /q "%LOCALAPPDATA%\yraverageSubMin\com.yraveragesubmin.helper.json" >nul 2>&1
echo Native Messaging host removed.
endlocal
