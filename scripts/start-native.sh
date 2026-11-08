#!/usr/bin/env bash
# Start the native helper (the Rust engine) if it is not already listening on 127.0.0.1:17865.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
PORT="${PORT:-17865}"
URL="http://127.0.0.1:${PORT}/health"

if curl -sf "$URL" >/dev/null 2>&1; then
  echo "[start-native] Already running -> $URL"
  "$ROOT/scripts/ensure-lab.sh" 2>/dev/null || echo "[start-native] WARN: lab server not ready (run ./scripts/ensure-lab.sh)" >&2
  exit 0
fi

if lsof -ti "tcp:${PORT}" >/dev/null 2>&1; then
  echo "[start-native] Port ${PORT} busy — stopping stale listener…"
  "$ROOT/scripts/stop-native.sh" || true
fi

echo "[start-native] Starting native helper (Rust engine) on port ${PORT}…"
ENGINE="$(bash "$NATIVE/engine-path.sh")"
PORT="$PORT" nohup "$ENGINE" >>"$ROOT/.native-server.log" 2>&1 &

for _ in $(seq 1 120); do
  if curl -sf "$URL" >/dev/null 2>&1; then
    echo "[start-native] Ready -> $URL"
    "$ROOT/scripts/ensure-lab.sh" 2>/dev/null || echo "[start-native] WARN: lab server not ready (run ./scripts/ensure-lab.sh)" >&2
    exit 0
  fi
  sleep 1
done

echo "[start-native] ERROR: helper did not become ready within 120s (see .native-server.log)" >&2
exit 1
