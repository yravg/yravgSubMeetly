#!/usr/bin/env bash
# Start the Local TransSub native helper (creates a venv on first run).
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

# Performance defaults (Apple Silicon):
#   WHISPER_MODEL        — final utterances (accurate)
#   DRAFT_WHISPER_MODEL  — live draft subtitles while speaking (fast)
export WHISPER_MODEL="${WHISPER_MODEL:-mlx-community/whisper-large-v3-turbo}"
export DRAFT_WHISPER_MODEL="${DRAFT_WHISPER_MODEL:-mlx-community/whisper-base-mlx}"
export TRANSLATE_MODEL="${TRANSLATE_MODEL:-mlx-community/Qwen2.5-3B-Instruct-4bit}"
# shellcheck disable=SC1091
source .venv/bin/activate
DEPS_STAMP=".venv/.deps-installed"
if [ ! -f "$DEPS_STAMP" ] || [ "${0}" -nt "$DEPS_STAMP" ]; then
  pip install -q --upgrade pip
  if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
    echo "▸ Apple Silicon → installing mlx-whisper"
    pip install -q "mlx-whisper>=0.4" numpy
    if [[ "${TRANSLATE:-on}" != "off" ]]; then
      pip install -q "mlx-lm>=0.20" || echo "⚠ mlx-lm install failed — translation will use the browser engine"
    fi
  else
    echo "▸ installing faster-whisper (CPU/CUDA)"
    pip install -q faster-whisper numpy
    export TRANSLATE=off
  fi
  touch "$DEPS_STAMP"
fi

exec python server.py
