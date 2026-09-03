#!/usr/bin/env bash
# Linux-only installer for Chrome/Chromium Native Messaging host.
# Usage: ./install-host-linux.sh <chrome-extension-id>
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script is for Linux. On macOS use ./install-host.sh"
  exit 1
fi

EXT_ID="${1:-}"
if [[ -z "$EXT_ID" ]]; then
  echo "Usage: ./install-host-linux.sh <chrome-extension-id>"
  exit 1
fi

exec ./install-host.sh "$EXT_ID"
