#!/usr/bin/env bash
# Install the Chrome Native Messaging host so the extension can start/stop the
# helper from Settings. Run once after loading the extension:
#   cd native && ./install-host.sh YOUR_EXTENSION_ID
#
# Find YOUR_EXTENSION_ID on chrome://extensions (Developer mode → ID column).
set -euo pipefail
cd "$(dirname "$0")"

EXT_ID="${1:-}"
if [ -z "$EXT_ID" ]; then
  echo "Usage: ./install-host.sh <chrome-extension-id>"
  echo ""
  echo "Find the ID on chrome://extensions (enable Developer mode)."
  exit 1
fi

HOST_PY="$(cd "$(dirname "$0")" && pwd)/messaging_host.py"
chmod +x "$HOST_PY"

MANIFEST=$(cat <<EOF
{
  "name": "com.localtranssub.helper",
  "description": "Local TransSub native helper launcher",
  "path": "$HOST_PY",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXT_ID}/"
  ]
}
EOF
)

install_one() {
  local dir="$1"
  local name="$2"
  mkdir -p "$dir"
  echo "$MANIFEST" > "$dir/com.localtranssub.helper.json"
  echo "✓ Installed for $name → $dir/com.localtranssub.helper.json"
}

case "$(uname -s)" in
  Darwin)
    install_one "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" "Google Chrome"
    install_one "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" "Microsoft Edge"
    install_one "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" "Chromium"
    ;;
  Linux)
    install_one "$HOME/.config/google-chrome/NativeMessagingHosts" "Google Chrome"
    install_one "$HOME/.config/chromium/NativeMessagingHosts" "Chromium"
    ;;
  *)
    echo "Unsupported OS — install the manifest manually. See README."
    exit 1
    ;;
esac

echo ""
echo "Done. Reload the extension, then use Settings → Engine → Native helper → Start."
