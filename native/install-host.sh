#!/usr/bin/env bash
# Install the Chrome Native Messaging host so the extension can start/stop the
# helper from Settings. Run once after loading the extension:
#   cd native && ./install-host.sh YOUR_EXTENSION_ID [path/to/submeetly-engine]
#
# Find YOUR_EXTENSION_ID on chrome://extensions (Developer mode → ID column).
set -euo pipefail
cd "$(dirname "$0")"

EXT_ID="${1:-}"
if [ -z "$EXT_ID" ]; then
  echo "Usage: ./install-host.sh <chrome-extension-id> [path/to/submeetly-engine]"
  echo ""
  echo "Find the ID on chrome://extensions (enable Developer mode)."
  exit 1
fi

# The Native Messaging host is the Rust engine itself: Chrome starts it with the
# calling origin as first argument and the engine switches to host mode.
ENGINE="${2:-$(bash "$(dirname "$0")/engine-path.sh")}"
[ -x "$ENGINE" ] || { echo "Engine not found or not executable: $ENGINE" >&2; exit 1; }

MANIFEST=$(cat <<EOF
{
  "name": "com.yraveragesubmin.helper",
  "description": "yravgSubMeetly native helper launcher",
  "path": "$ENGINE",
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
  echo "$MANIFEST" > "$dir/com.yraveragesubmin.helper.json"
  echo "✓ Installed for $name → $dir/com.yraveragesubmin.helper.json"
  # Manifest dari nama lama dibuang setelah yang baru ditulis. Kalau ditinggal,
  # ekstensi bisa terus memakai host lama lewat fallback-nya dan pemasangan ini
  # tidak pernah benar-benar terpakai.
  if [ -f "$dir/com.localtranssub.helper.json" ]; then
    rm -f "$dir/com.localtranssub.helper.json"
    echo "  · manifest lama com.localtranssub.helper.json dibuang"
  fi
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
