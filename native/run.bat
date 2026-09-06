@echo off
rem Jalankan Native Helper di Windows tanpa Git Bash / WSL.
rem run.sh adalah skrip bash dan memakai tata letak venv POSIX; di Windows
rem interpreter venv ada di .venv\Scripts\python.exe, jadi Windows punya
rem peluncurnya sendiri di sini.
rem
rem   set TRANSLATE=off  &  run.bat        rem lewati LLM terjemahan
rem   set WHISPER_MODEL=base  &  run.bat   rem model lebih kecil/cepat
rem   set DEVICE=cuda  &  run.bat          rem paksa GPU NVIDIA
setlocal
cd /d "%~dp0"

rem Cari Python: peluncur `py` lebih dipercaya daripada `python` di PATH,
rem karena Windows memasang stub Microsoft Store bernama python.exe.
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo [x] Python 3 tidak ditemukan. Pasang dari https://www.python.org/downloads/
  echo     dan centang "Add python.exe to PATH".
  exit /b 1
)

set "VENV_PY=%CD%\.venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
  echo [*] membuat virtualenv ^(.venv^)...
  %PY% -m venv .venv || (echo [x] gagal membuat virtualenv & exit /b 1)
  if exist ".venv\.deps-installed" del ".venv\.deps-installed"
)
if not exist "%VENV_PY%" (
  echo [x] virtualenv dibuat tapi %VENV_PY% tidak ada.
  exit /b 1
)

rem Unduhan Xet/CAS Hugging Face sering putus di sebagian jaringan; HTTP klasik
rem bisa dilanjutkan. Samakan dengan run.sh.
if not defined HF_HUB_DISABLE_XET set "HF_HUB_DISABLE_XET=1"
if not defined HF_HUB_ENABLE_HF_TRANSFER set "HF_HUB_ENABLE_HF_TRANSFER=0"

rem JANGAN menyetel WHISPER_MODEL ke repo mlx-community di sini: Windows memakai
rem faster-whisper (CTranslate2) yang tidak bisa memuat bobot MLX. Biarkan
rem server.py memilih "large-v3-turbo".
if not defined TRANSLATE set "TRANSLATE=off"

if not exist ".venv\.deps-installed" (
  echo [*] memasang faster-whisper ^(CPU/CUDA^)...
  "%VENV_PY%" -m pip install -q --upgrade pip
  "%VENV_PY%" -m pip install -q faster-whisper numpy || (echo [x] pemasangan dependensi gagal & exit /b 1)
  echo ok> ".venv\.deps-installed"
)

"%VENV_PY%" server.py
endlocal
