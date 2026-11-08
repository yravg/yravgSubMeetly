#!/usr/bin/env bash
# Stop then start the native helper (use after rebuilding the engine).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/stop-native.sh" || true
"$ROOT/scripts/start-native.sh"
