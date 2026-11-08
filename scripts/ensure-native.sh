#!/usr/bin/env bash
# One-shot setup: install the Chrome native launcher + start the helper (Rust engine).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
EXT_ID="$(node -e "const h=require('crypto').createHash('sha256').update(require('path').resolve(process.argv[1])).digest();console.log([...h.subarray(0,16)].map(b=>'abcdefghijklmnop'[b>>4]+'abcdefghijklmnop'[b&15]).join(''))" "$DIST")"

echo "[ensure-native] Extension id: ${EXT_ID}"
"$ROOT/native/install-host.sh" "$EXT_ID"
"$ROOT/scripts/start-native.sh"
"$ROOT/scripts/ensure-lab.sh" || echo "[ensure-native] WARN: lab server not ready" >&2
