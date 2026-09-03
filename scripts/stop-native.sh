#!/usr/bin/env bash
# Stop the native helper on 127.0.0.1:17865 (graceful shutdown, then force if needed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-17865}"
URL="http://127.0.0.1:${PORT}"

if curl -sf "${URL}/health" >/dev/null 2>&1; then
  echo "[stop-native] Sending shutdown to ${URL}…"
  curl -sf -X POST "${URL}/shutdown" >/dev/null 2>&1 || true
fi

for _ in $(seq 1 30); do
  if ! curl -sf "${URL}/health" >/dev/null 2>&1; then
    if ! lsof -ti "tcp:${PORT}" >/dev/null 2>&1; then
      echo "[stop-native] Stopped."
      exit 0
    fi
  fi
  sleep 0.25
done

if PIDS="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"; then
  if [ -n "$PIDS" ]; then
    echo "[stop-native] Force-killing listener(s) on port ${PORT}: ${PIDS}"
    kill -TERM $PIDS 2>/dev/null || true
    sleep 0.5
  fi
fi

echo "[stop-native] Done (check: curl -sf ${URL}/health)"
