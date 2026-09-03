#!/usr/bin/env bash
# Shared helpers for Translation Lab start/stop scripts.
LAB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAB_PORT="${LAB_PORT:-8799}"
LAB_URL="http://127.0.0.1:${LAB_PORT}/lab.html"
LAB_PID_FILE="$LAB_ROOT/.lab-cache/lab-server.pid"
LAB_LOG="$LAB_ROOT/.lab-server.log"

lab_kill_port() {
  local pids
  pids=$(lsof -ti :"$LAB_PORT" 2>/dev/null || true)
  [[ -z "$pids" ]] || kill $pids 2>/dev/null || true
}

lab_is_running() {
  curl -sf "$LAB_URL" >/dev/null 2>&1
}

lab_pid_alive() {
  [[ -f "$LAB_PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$LAB_PID_FILE" 2>/dev/null)" || return 1
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

lab_cleanup_stale() {
  if lab_is_running; then
    return 0
  fi
  if [[ -f "$LAB_PID_FILE" ]]; then
    local pid
    pid="$(cat "$LAB_PID_FILE" 2>/dev/null || true)"
    [[ -z "$pid" ]] || kill "$pid" 2>/dev/null || true
    rm -f "$LAB_PID_FILE"
  fi
  pkill -f "scripts/lab-server.py" 2>/dev/null || true
  lab_kill_port
}

lab_ensure_ytdlp() {
  if python3 -c "import yt_dlp" 2>/dev/null || command -v yt-dlp >/dev/null 2>&1; then
    return 0
  fi
  echo "[lab] Installing yt-dlp for YouTube support…"
  python3 -m pip install -q yt-dlp || echo "[lab] WARN: pip install yt-dlp failed" >&2
}

lab_start_bg() {
  mkdir -p "$(dirname "$LAB_PID_FILE")"
  lab_cleanup_stale
  sleep 0.2
  lab_ensure_ytdlp
  nohup python3 "$LAB_ROOT/scripts/lab-server.py" >>"$LAB_LOG" 2>&1 &
  echo $! >"$LAB_PID_FILE"
  for _ in 1 2 3 4 5 6 7 8 10 11 12 13 14 15 16; do
    sleep 0.25
    if lab_is_running && lab_pid_alive; then
      return 0
    fi
  done
  echo "[lab] ERROR: server did not start (see $LAB_LOG)" >&2
  tail -5 "$LAB_LOG" 2>/dev/null >&2 || true
  lab_cleanup_stale
  return 1
}

lab_stop() {
  if [[ -f "$LAB_PID_FILE" ]]; then
    kill "$(cat "$LAB_PID_FILE")" 2>/dev/null || true
    rm -f "$LAB_PID_FILE"
  fi
  pkill -f "scripts/lab-server.py" 2>/dev/null || true
  lab_kill_port
}
