#!/usr/bin/env bash
# Export YouTube cookies from your browser into the lab cache (run while signed in).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.lab-cache/youtube-cookies.txt"
mkdir -p "$(dirname "$OUT")"

BROWSER="${1:-chrome}"
echo "[export-cookies] Browser: $BROWSER → $OUT"
echo "Make sure you are signed in to YouTube in that browser first."

if python3 -m yt_dlp --version >/dev/null 2>&1; then
  YTDLP=(python3 -m yt_dlp)
elif command -v yt-dlp >/dev/null; then
  YTDLP=(yt-dlp)
else
  echo "Install yt-dlp: pip install yt-dlp" >&2
  exit 1
fi

"${YTDLP[@]}" --no-check-certificates \
  --cookies-from-browser "$BROWSER" \
  --cookies "$OUT" \
  --skip-download "https://www.youtube.com/"

echo "[export-cookies] Done. Restart lab or upload in UI, then retry YouTube Load."
