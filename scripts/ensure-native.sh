#!/usr/bin/env bash
# One-shot setup: install the Chrome native launcher + start the helper server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
EXT_ID="$(python3 -c "import hashlib, os; path=os.path.abspath('$DIST'); h=hashlib.sha256(path.encode()).digest(); a='abcdefghijklmnop'; print(''.join(a[b>>4]+a[b&0xF] for b in h[:16]))")"

echo "[ensure-native] Extension id: ${EXT_ID}"
"$ROOT/native/install-host.sh" "$EXT_ID"
"$ROOT/scripts/start-native.sh"
"$ROOT/scripts/ensure-lab.sh" || echo "[ensure-native] WARN: lab server not ready" >&2
