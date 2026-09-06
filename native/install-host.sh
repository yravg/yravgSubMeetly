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
    # Di Linux host .py bisa dieksekusi langsung asalkan punya shebang dan bit
    # executable (dipasang di atas) — tidak perlu pembungkus seperti Windows.
    command -v python3 >/dev/null 2>&1 || {
      echo "⚠ python3 tidak ditemukan di PATH — host tidak akan bisa dijalankan browser."
    }
    install_one "$HOME/.config/google-chrome/NativeMessagingHosts" "Google Chrome"
    install_one "$HOME/.config/chromium/NativeMessagingHosts" "Chromium"
    install_one "$HOME/.config/microsoft-edge/NativeMessagingHosts" "Microsoft Edge"
    # Paket Flatpak menyimpan konfigurasinya terpisah; tanpa ini pemasangan
    # "berhasil" tapi browser Flatpak tetap tidak menemukan host.
    [ -d "$HOME/.var/app/com.google.Chrome" ] &&
      install_one "$HOME/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts" "Google Chrome (Flatpak)"
    [ -d "$HOME/.var/app/org.chromium.Chromium" ] &&
      install_one "$HOME/.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts" "Chromium (Flatpak)"
    [ -d "$HOME/.var/app/com.microsoft.Edge" ] &&
      install_one "$HOME/.var/app/com.microsoft.Edge/config/microsoft-edge/NativeMessagingHosts" "Microsoft Edge (Flatpak)"
    ;;
  *)
    echo "Unsupported OS — install the manifest manually. See README."
    exit 1
    ;;
esac

echo ""
echo "Done. Reload the extension, then use Settings → Engine → Native helper → Start."
