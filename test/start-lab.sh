#!/usr/bin/env bash
# Start Translation Lab from any directory (opens http://127.0.0.1:8799/lab.html).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/start-lab.sh" "$@"
