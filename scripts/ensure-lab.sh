#!/usr/bin/env bash
# Start Translation Lab if it is not already listening on 127.0.0.1:8799.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lab-lib.sh
source "$ROOT/scripts/lab-lib.sh"

if lab_is_running; then
  echo "[ensure-lab] Already running → $LAB_URL"
  exit 0
fi

if [[ ! -d "$ROOT/test/samples" ]] || [[ -z "$(ls -A "$ROOT/test/samples" 2>/dev/null)" ]]; then
  python3 "$ROOT/scripts/gen-samples.py" 2>/dev/null || true
fi

lab_start_bg
echo "[ensure-lab] Started → $LAB_URL"
