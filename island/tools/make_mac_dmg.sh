#!/bin/bash
# Wrap an app in a DMG: the app and an Applications shortcut to drag it onto. Runs on a Mac (hdiutil).
#
#   tools/make_mac_dmg.sh <yravgSubMeetly.app> <out.dmg> [test]
#
# "test" (an ad-hoc signed build) adds a short note on Open Anyway next to the app.
set -euo pipefail
app="$1"; dmg="$2"; kind="${3:-release}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/$(basename "$app")"
ln -s /Applications "$stage/Applications"
if [ "$kind" = test ]; then
  cat > "$stage/READ ME FIRST.txt" <<'T'
This build is signed ad hoc (no Apple Developer ID yet).
Drag yravgSubMeetly to Applications. The first time, macOS says it can't verify it:
open System Settings > Privacy & Security, scroll down and press "Open Anyway".
T
fi
rm -f "$dmg"
hdiutil create -volname "yravgSubMeetly" -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$dmg" > /dev/null
echo "made $dmg"
