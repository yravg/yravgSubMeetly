#!/usr/bin/env bash
# Open Chrome with the unpacked extension for DevTools / inspect testing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
PROFILE="$ROOT/.dev-profile"
PORT=8799
LAB_URL="http://127.0.0.1:$PORT/lab.html"
TEST_URL="http://127.0.0.1:$PORT/audio-page.html"
# shellcheck source=lab-lib.sh
source "$ROOT/scripts/lab-lib.sh"

# Rebuild dist when npm is missing from PATH (common on fresh shells).
if ! command -v node >/dev/null 2>&1; then
  if [[ -x "$ROOT/scripts/build.sh" ]]; then
    echo "[dev-browser] node not found — rebuilding with scripts/build.sh"
    "$ROOT/scripts/build.sh"
  fi
fi

mkdir -p "$PROFILE"

test_page_ok() {
  curl -sf "$TEST_URL" >/dev/null 2>&1
}

ensure_lab_server() {
  if lab_is_running; then
    echo "[dev-browser] Lab server OK -> $LAB_URL"
    return 0
  fi
  echo "[dev-browser] Starting Translation Lab server on port ${PORT}…"
  if [[ ! -d "$ROOT/test/samples" ]] || [[ -z "$(ls -A "$ROOT/test/samples" 2>/dev/null)" ]]; then
    python3 "$ROOT/scripts/gen-samples.py" 2>/dev/null || true
  fi
  lab_start_bg
  echo "[dev-browser] Lab server OK -> $LAB_URL"
}

ensure_lab_server
if ! test_page_ok; then
  echo "[dev-browser] ERROR: lab server failed to serve test pages on port $PORT" >&2
  exit 1
fi

"$ROOT/scripts/ensure-dev-services.sh" || echo "[dev-browser] WARN: native helper not ready — run: ./scripts/ensure-native.sh" >&2

# Install native messaging host once (lets Settings → Start work from the extension).
EXT_ID="$(python3 -c "import hashlib, os; path=os.path.abspath('$DIST'); h=hashlib.sha256(path.encode()).digest(); a='abcdefghijklmnop'; print(''.join(a[b>>4]+a[b&0xF] for b in h[:16]))")"
echo "[dev-browser] Installing native launcher for extension id ${EXT_ID}"
"$ROOT/native/install-host.sh" "$EXT_ID" >/dev/null 2>&1 || echo "[dev-browser] WARN: native launcher install failed" >&2
echo "[dev-browser] Extension id: ${EXT_ID}"

CHROME_APP=""
for app in "Google Chrome" "Google Chrome Canary" "Chromium"; do
  if [[ -d "/Applications/${app}.app" ]]; then CHROME_APP="$app"; break; fi
done
if [[ -z "$CHROME_APP" ]]; then
  echo "[dev-browser] ERROR: Google Chrome not found in /Applications" >&2
  exit 1
fi

CHROME_BIN="/Applications/${CHROME_APP}.app/Contents/MacOS/${CHROME_APP}"
if [[ -x "$CHROME_BIN" ]]; then
  echo "[dev-browser] $( "$CHROME_BIN" --version 2>/dev/null | head -1 )"
fi
echo "[dev-browser] Extension: $DIST"
echo "[dev-browser] Profile:   $PROFILE"
echo "[dev-browser] Open chrome://extensions -> yravgSubMeetly -> side panel icon"
echo "[dev-browser] Right-click the side panel -> Inspect"

  open -na "$CHROME_APP" --args \
  --user-data-dir="$PROFILE" \
  --disable-extensions-except="$DIST" \
  --load-extension="$DIST" \
  --autoplay-policy=no-user-gesture-required \
  --no-first-run \
  "http://127.0.0.1:$PORT/lab.html"

echo "[dev-browser] Lab UI: http://127.0.0.1:$PORT/lab.html"
echo "[dev-browser] Headless bench: python3 scripts/bench-lab.py"
