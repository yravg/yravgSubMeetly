@echo off
rem Start the yravgSubMeetly helper (the Rust engine) in the foreground.
rem   set PORT=17866  &  run.bat       rem other port
rem   set TRANSLATE=off  &  run.bat    rem skip the translation model
rem   set DEVICE=cpu  &  run.bat       rem auto (default), cpu or cuda
setlocal
set "HERE=%~dp0"
set "ENGINE="
if defined SUBMEETLY_ENGINE if exist "%SUBMEETLY_ENGINE%" set "ENGINE=%SUBMEETLY_ENGINE%"
if not defined ENGINE if exist "%HERE%submeetly-engine.exe" set "ENGINE=%HERE%submeetly-engine.exe"
if not defined ENGINE if defined CARGO_TARGET_DIR if exist "%CARGO_TARGET_DIR%\release\submeetly-engine.exe" set "ENGINE=%CARGO_TARGET_DIR%\release\submeetly-engine.exe"
if not defined ENGINE if exist "%HERE%..\engine-rs\target\release\submeetly-engine.exe" set "ENGINE=%HERE%..\engine-rs\target\release\submeetly-engine.exe"
if not defined ENGINE (
  echo [x] submeetly-engine.exe not built. Run:
  echo     cargo build --release -p submeetly-engine --manifest-path engine-rs\Cargo.toml
  exit /b 1
)
"%ENGINE%" %*
endlocal
