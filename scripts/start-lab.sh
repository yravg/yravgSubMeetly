#!/usr/bin/env bash
# Start Translation Lab server (background). Mac: double-click "Start Lab.command"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lab-lib.sh
source "$ROOT/scripts/lab-lib.sh"

OPEN_BROWSER=1
[[ "${1:-}" == "--no-open" ]] && OPEN_BROWSER=0

if lab_is_running; then
  echo "[lab] Already running → $LAB_URL"
  [[ "$OPEN_BROWSER" == 1 ]] && open "$LAB_URL" 2>/dev/null || true
  exit 0
fi

if [[ ! -d "$ROOT/test/samples" ]] || [[ -z "$(ls -A "$ROOT/test/samples" 2>/dev/null)" ]]; then
  python3 "$ROOT/scripts/gen-samples.py" 2>/dev/null || true
fi
if [[ -x "$ROOT/scripts/start-native.sh" ]]; then
  "$ROOT/scripts/start-native.sh" || echo "[lab] WARN: native helper not ready (cd native && ./run.sh)" >&2
fi

"$ROOT/scripts/ensure-lab.sh"
echo "[lab] Started → $LAB_URL"
echo "[lab] Log: $LAB_LOG"
echo "[lab] Stop:  ./scripts/stop-lab.sh  (or double-click Stop Lab.command)"
[[ "$OPEN_BROWSER" == 1 ]] && open "$LAB_URL" 2>/dev/null || true
