#!/usr/bin/env bash
# Stop Translation Lab server. Mac: double-click "Stop Lab.command"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lab-lib.sh
source "$ROOT/scripts/lab-lib.sh"

if lab_is_running; then
  lab_stop
  sleep 0.3
fi

if lab_is_running; then
  echo "[lab] ERROR: still running on port $LAB_PORT" >&2
  exit 1
fi

echo "[lab] Stopped (port $LAB_PORT free)"
