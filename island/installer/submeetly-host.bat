@echo off
REM Chrome starts this as the Native Messaging host (see com.yraveragesubmin.helper.json); it only passes the origin argument, so the engine is told its mode here.
"%~dp0submeetly-engine.exe" native-host
