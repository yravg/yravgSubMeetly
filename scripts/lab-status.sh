#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lab-lib.sh
source "$ROOT/scripts/lab-lib.sh"

if lab_is_running; then
  echo "[lab] running → $LAB_URL"
  [[ -f "$LAB_PID_FILE" ]] && echo "[lab] pid $(cat "$LAB_PID_FILE")"
  exit 0
fi

if [[ -f "$LAB_PID_FILE" ]]; then
  echo "[lab] stopped (stale pid file — run ./scripts/start-lab.sh)"
else
  echo "[lab] stopped"
fi
exit 1
