#!/usr/bin/env bash
# Generate test speech WAV files (16 kHz mono) for the translation lab.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$ROOT/scripts/gen-samples.py" "$@"
