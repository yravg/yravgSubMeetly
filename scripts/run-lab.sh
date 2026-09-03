#!/usr/bin/env bash
# Translation Lab — test server + native helper + browser UI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${LAB_PORT:-8799}"
LAB_URL="http://127.0.0.1:${PORT}/lab.html"
SERVER_PID=""

cleanup() {
  [[ -z "$SERVER_PID" ]] || kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

kill_port() {
  local pids
  pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  [[ -z "$pids" ]] || kill $pids 2>/dev/null || true
}

start_server() {
  kill_port
  sleep 0.2
  # Lab server: static files + YouTube audio proxy (yt-dlp)
  if ! python3 -c "import yt_dlp" 2>/dev/null && command -v yt-dlp >/dev/null 2>&1; then
    : # yt-dlp CLI available
  elif ! python3 -c "import yt_dlp" 2>/dev/null; then
    echo "[run-lab] Installing yt-dlp for YouTube support…"
    python3 -m pip install -q yt-dlp || echo "[run-lab] WARN: pip install yt-dlp failed" >&2
  fi
  python3 "$ROOT/scripts/lab-server.py" >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in 1 2 3 4 5 6 7 8; do
    sleep 0.25
    curl -sf "$LAB_URL" >/dev/null 2>&1 && return 0
  done
  echo "[run-lab] ERROR: could not start test server on port $PORT" >&2
  exit 1
}

echo "[run-lab] Generating speech samples if needed…"
python3 "$ROOT/scripts/gen-samples.py" 2>/dev/null || echo "[run-lab] WARN: gen-samples failed" >&2

if [[ -x "$ROOT/scripts/start-native.sh" ]]; then
  "$ROOT/scripts/start-native.sh" || echo "[run-lab] WARN: native helper not ready — run: cd native && ./run.sh" >&2
fi

start_server
echo "[run-lab] Lab UI: $LAB_URL"
echo "[run-lab] Index:  http://127.0.0.1:${PORT}/"
echo "[run-lab] Headless: python3 scripts/bench-lab.py --json test/last-bench.json"

if [[ "${1:-}" == "--bench-only" ]]; then
  python3 "$ROOT/scripts/bench-lab.py" --json "$ROOT/test/last-bench.json"
  exit $?
fi

if [[ "${1:-}" == "--no-open" ]]; then
  echo "[run-lab] Server running (Ctrl+C to stop)"
  wait "$SERVER_PID"
else
  open "$LAB_URL" 2>/dev/null || echo "[run-lab] Open in browser: $LAB_URL"
  wait "$SERVER_PID"
fi
