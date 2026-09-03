#!/usr/bin/env bash
# Build dist/ without requiring Node/npm on PATH (uses bundled esbuild binary).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ESB="$ROOT/node_modules/.bin/esbuild"
if [[ ! -x "$ESB" ]]; then
  echo "esbuild not found. Run: npm install" >&2
  exit 1
fi

cp src/manifest.json dist/manifest.json
cp src/offscreen.html dist/offscreen.html
cp src/sidepanel.html dist/sidepanel.html
cp src/sidepanel.css dist/sidepanel.css
cp -R icons dist/icons 2>/dev/null || true

"$ESB" src/background.js --bundle --outfile=dist/background.js --format=esm --platform=browser --target=chrome120
"$ESB" src/offscreen.js --bundle --outfile=dist/offscreen.js --format=esm --platform=browser --target=chrome120
"$ESB" src/sidepanel.js --bundle --outfile=dist/sidepanel.js --format=esm --platform=browser --target=chrome120
"$ESB" src/content.js --bundle --outfile=dist/content.js --format=iife --platform=browser --target=chrome120
"$ESB" src/ai-worker.js --bundle --outfile=dist/ai-worker.js --format=esm --platform=browser --target=chrome120

echo "build complete → dist/"
"$ROOT/scripts/ensure-dev-services.sh" || echo "WARN: native/lab not ready — run ./scripts/ensure-native.sh" >&2
