#!/usr/bin/env bash
# Start the yraverageSubMin native helper (creates a venv on first run).
#   TRANSLATE=off ./run.sh     → skip the translation LLM
#   WHISPER_MODEL=mlx-community/whisper-small-mlx ./run.sh  → smaller/faster model
#   DRAFT_WHISPER_MODEL=mlx-community/whisper-base-mlx ./run.sh  → fast live drafts (default)
set -euo pipefail
cd "$(dirname "$0")"

# Apple Silicon: prefer /opt/homebrew over broken Intel /usr/local binaries.
if [[ "$(uname -m)" == "arm64" && -d /opt/homebrew/bin ]]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi

PY="${PYTHON:-python3}"
if [ ! -d .venv ]; then
  echo "▸ creating virtualenv (.venv)…"
  "$PY" -m venv .venv
fi

# HuggingFace's Xet/CAS transfer backend is unreliable on some networks
# (CAS Client Error / SSL EOF mid-download). Classic HTTP downloads resume
# cleanly, so default to them unless the user opts back in.
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"
export HF_HUB_ENABLE_HF_TRANSFER="${HF_HUB_ENABLE_HF_TRANSFER:-0}"

IS_MAC_ARM=false
if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then IS_MAC_ARM=true; fi

# Model bawaan HANYA untuk Apple Silicon (mlx-whisper). Windows/Linux memakai
# faster-whisper, yang tidak bisa memuat bobot MLX — mengekspornya di sana
# membuat helper mati saat memuat model. Biarkan server.py memilih sendiri
# ("large-v3-turbo", format CTranslate2).
#   WHISPER_MODEL        — ucapan final (akurat)
#   DRAFT_WHISPER_MODEL  — draf subtitel langsung saat berbicara (cepat)
if $IS_MAC_ARM; then
  export WHISPER_MODEL="${WHISPER_MODEL:-mlx-community/whisper-large-v3-turbo}"
  export DRAFT_WHISPER_MODEL="${DRAFT_WHISPER_MODEL:-mlx-community/whisper-base-mlx}"
  export TRANSLATE_MODEL="${TRANSLATE_MODEL:-mlx-community/Qwen2.5-3B-Instruct-4bit}"
fi
# shellcheck disable=SC1091
# JANGAN memakai `source .venv/bin/activate`: skrip itu menyimpan path absolut
# saat venv dibuat, sehingga rusak diam-diam begitu folder proyek dipindah atau
# di-rename (PATH menunjuk direktori yang tidak ada → "python: not found").
# Memanggil interpreter venv lewat path relatif selalu benar.
# Windows (Git Bash/MSYS) menaruh interpreter di .venv/Scripts, bukan .venv/bin.
venv_python() {
  if [ -x ".venv/bin/python" ]; then echo "$(pwd)/.venv/bin/python"
  elif [ -x ".venv/Scripts/python.exe" ]; then echo "$(pwd)/.venv/Scripts/python.exe"
  else echo ""; fi
}
VENV_PY="$(venv_python)"
if [ -z "$VENV_PY" ]; then
  echo "▸ virtualenv rusak atau dibuat di lokasi lain — membuat ulang…"
  rm -rf .venv
  "$PY" -m venv .venv
  rm -f .venv/.deps-installed
  VENV_PY="$(venv_python)"
  if [ -z "$VENV_PY" ]; then
    echo "✖ gagal membuat virtualenv dengan '$PY'. Pasang Python 3.10+ lalu ulangi." >&2
    exit 1
  fi
fi
export VIRTUAL_ENV="$(pwd)/.venv"
export PATH="$(dirname "$VENV_PY"):$PATH"
DEPS_STAMP=".venv/.deps-installed"
if [ ! -f "$DEPS_STAMP" ] || [ "${0}" -nt "$DEPS_STAMP" ]; then
  "$VENV_PY" -m pip install -q --upgrade pip
  if $IS_MAC_ARM; then
    echo "▸ Apple Silicon → installing mlx-whisper"
    "$VENV_PY" -m pip install -q "mlx-whisper>=0.4" numpy
    if [[ "${TRANSLATE:-on}" != "off" ]]; then
      "$VENV_PY" -m pip install -q "mlx-lm>=0.20" || echo "⚠ mlx-lm install failed — translation will use the browser engine"
    fi
  else
    echo "▸ installing faster-whisper (CPU/CUDA)"
    "$VENV_PY" -m pip install -q faster-whisper numpy
    export TRANSLATE=off
  fi
  touch "$DEPS_STAMP"
fi

exec "$VENV_PY" server.py
