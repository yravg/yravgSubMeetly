#!/usr/bin/env bash
# Buat ZIP produksi untuk Chrome Web Store dari dist/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node esbuild.config.mjs || npx --yes esbuild src/sidepanel.js --bundle --outfile=dist/sidepanel.js --format=esm --platform=browser --target=chrome120
# Pastikan aset statis
cp -f src/manifest.json dist/manifest.json
cp -f src/sidepanel.html dist/sidepanel.html
cp -f src/sidepanel.css dist/sidepanel.css
cp -f src/notes-panel.css dist/notes-panel.css 2>/dev/null || true
mkdir -p store/releases
VER=$(node -p "require('./package.json').version")
OUT="store/releases/local-transsub-${VER}.zip"
rm -f "$OUT"
( cd dist && zip -r "../$OUT" . -x '*.map' )
echo "Wrote $OUT"
