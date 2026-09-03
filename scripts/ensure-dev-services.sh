#!/usr/bin/env bash
# Idempotent: native helper (17865) + Translation Lab (8799). Safe to run after every build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/start-native.sh"
"$ROOT/scripts/ensure-lab.sh" || echo "[ensure-dev-services] WARN: lab not ready" >&2
