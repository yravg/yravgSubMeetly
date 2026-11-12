#!/bin/bash
# Build "yravgSubMeetly.app" and its DMG from the island's Mac binaries. Runs on a Mac (lipo, codesign, hdiutil).
#
#   tools/make_mac_app.sh <arm64 binary> <x86_64 binary | -> <yravgSubMeetly.icns | -> <out dir>
#
# The app is ad-hoc signed (no Apple Developer ID yet), so macOS asks once, in System Settings >
# Privacy & Security > Open Anyway, before it first opens. The DMG is named like a release's
# (yravgSubMeetly-<version>-mac.dmg), which is what make_update_feed.py looks for. When an Apple
# Developer ID exists, sign with it (--options runtime, installer/mac/poni.entitlements) and notarize.
set -euo pipefail

arm="$1"; intel="$2"; icns="$3"; out="$4"
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cargo metadata --no-deps --format-version 1 --manifest-path "$root/Cargo.toml" \
  | python3 -c 'import sys, json; print(next(p["version"] for p in json.load(sys.stdin)["packages"] if p["name"] == "poni"))')"

mkdir -p "$out"
app="$out/yravgSubMeetly.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

# One binary for Apple Silicon and Intel Macs.
if [ "$intel" != "-" ]; then
  lipo -create -output "$app/Contents/MacOS/poni" "$arm" "$intel"
else
  cp "$arm" "$app/Contents/MacOS/poni"
fi
chmod +x "$app/Contents/MacOS/poni"
lipo -info "$app/Contents/MacOS/poni"

sed "s/@VERSION@/$version/g" "$root/installer/mac/Info.plist" > "$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist"
printf 'APPL????' > "$app/Contents/PkgInfo"
if [ "$icns" != "-" ]; then
  cp "$icns" "$app/Contents/Resources/yravgSubMeetly.icns"
fi

# The local engine (captions, translation, the model library): the island starts it from Contents/MacOS
# (services/engine.rs) and stops it on quit. ENGINE_ARM / ENGINE_INTEL are its release binaries
# (engine-rs, `cargo build -p submeetly-engine --release --target ...`). Without ENGINE_ARM the app has
# no engine and says "Engine not found".
if [ -n "${ENGINE_ARM:-}" ]; then
  if [ -n "${ENGINE_INTEL:-}" ]; then
    lipo -create -output "$app/Contents/MacOS/submeetly-engine" "$ENGINE_ARM" "$ENGINE_INTEL"
  else
    cp "$ENGINE_ARM" "$app/Contents/MacOS/submeetly-engine"
  fi
  chmod +x "$app/Contents/MacOS/submeetly-engine"
  lipo -info "$app/Contents/MacOS/submeetly-engine"
else
  echo "warning: no ENGINE_ARM given, the app is built without its engine" >&2
fi

# What plays, from macOS's own now playing (browsers, Spotify, Music): the MediaRemote adapter's framework
# and script (third_party/mediaremote-adapter), which /usr/bin/perl runs for the app
# (crates/poni/src/mac/services/mediaremote.rs). MEDIAREMOTE_BUILD is its CMake build directory
# (release.yml); without it the app reads Music and Spotify only.
if [ -n "${MEDIAREMOTE_BUILD:-}" ]; then
  mkdir -p "$app/Contents/Frameworks"
  cp -R "$MEDIAREMOTE_BUILD/MediaRemoteAdapter.framework" "$app/Contents/Frameworks/"
  cp "$root/third_party/mediaremote-adapter/bin/mediaremote-adapter.pl" "$app/Contents/Resources/"
  lipo -info "$app/Contents/Frameworks/MediaRemoteAdapter.framework/MediaRemoteAdapter"
else
  echo "warning: no MEDIAREMOTE_BUILD given, the app is built without macOS's now playing reader" >&2
fi

# The main window: the native SwiftUI app (mac/build-app.sh), shipped inside this one and opened by
# the menu's "Open yravgSubMeetly" / "Open Minutes register" (mac/app.rs). MAIN_APP = its .app.
if [ -n "${MAIN_APP:-}" ]; then
  cp -R "$MAIN_APP" "$app/Contents/Resources/yravgSubMeetly-window.app"
else
  echo "warning: no MAIN_APP given, the app is built without its main window" >&2
fi

# Ad-hoc signature: seals the bundle, the adapter's framework too (Apple Silicon refuses unsigned code outright).
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict --verbose=2 "$app"

dmg="$out/yravgSubMeetly-$version-mac.dmg"
bash "$root/tools/make_mac_dmg.sh" "$app" "$dmg" test
shasum -a 256 "$dmg"
echo "built $dmg"
