#!/usr/bin/env bash
# Cabut pendaftaran Native Messaging host (macOS/Linux).
set -euo pipefail
NAME="com.localtranssub.helper"
removed=0
for dir in \
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \
  "$HOME/.config/google-chrome/NativeMessagingHosts" \
  "$HOME/.config/chromium/NativeMessagingHosts" \
  "$HOME/.config/microsoft-edge/NativeMessagingHosts" \
  "$HOME/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts" \
  "$HOME/.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts" \
  "$HOME/.var/app/com.microsoft.Edge/config/microsoft-edge/NativeMessagingHosts"; do
  if [ -f "$dir/$NAME.json" ]; then
    rm -f "$dir/$NAME.json"
    echo "✓ dihapus: $dir/$NAME.json"
    removed=$((removed + 1))
  fi
done
[ "$removed" -eq 0 ] && echo "Tidak ada manifest yang terpasang."
exit 0
