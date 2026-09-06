#!/bin/bash
# Build yraverageSubMin.app.
#
# Design rules this script enforces, so the app cannot regress again:
#
#  1. Stop any running copy first. codesign cannot sign a running binary; when
#     that failed mid-script it left a bundle carrying SwiftPM's own ad-hoc
#     signature and no icon — which silently revoked every macOS permission.
#  2. Assemble into a staging directory and swap it in atomically, so a failed
#     build never replaces a working app with a broken one.
#  3. VERIFY the finished bundle (stable signature, right identifier, icon
#     present) and fail loudly instead of "succeeding" with a broken app.
#  4. Re-register with Launch Services so the Dock picks up the icon.
set -euo pipefail
cd "$(dirname "$0")"

CONFIG="${CONFIG:-release}"
APP_NAME="yraverageSubMin"
# Bundle id deliberately stable: macOS ties Screen Recording / Accessibility /
# Input Monitoring grants to it. Changing it forces the user to re-grant.
BUNDLE_ID="com.localtranssub.app"
CERT_NAME="${CERT_NAME:-yraverageSubMin Dev}"
VERSION="1.0.0"
OUT="${OUT:-build}"
APP="$OUT/$APP_NAME.app"

die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

# --- 1. stop a running copy -------------------------------------------------
if pgrep -f "$APP_NAME.app/Contents/MacOS/" >/dev/null 2>&1; then
    echo "▸ quitting the running app (codesign cannot sign it while it runs)…"
    pkill -f "$APP_NAME.app/Contents/MacOS/" 2>/dev/null || true
    sleep 1
fi

echo "▸ compiling ($CONFIG)…"
swift build -c "$CONFIG" --product LocalTransSub
BIN="$(swift build -c "$CONFIG" --product LocalTransSub --show-bin-path)/LocalTransSub"
[ -x "$BIN" ] || die "compiled binary not found at $BIN"

# --- 2. assemble into staging ----------------------------------------------
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
SAPP="$STAGE/$APP_NAME.app"
mkdir -p "$SAPP/Contents/MacOS" "$SAPP/Contents/Resources"
cp "$BIN" "$SAPP/Contents/MacOS/LocalTransSub"

cat > "$SAPP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>$APP_NAME</string>
    <key>CFBundleDisplayName</key><string>$APP_NAME</string>
    <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleExecutable</key><string>LocalTransSub</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>LSMinimumSystemVersion</key><string>26.0</string>
    <!-- Normal Dock app. "Hide Dock icon" in Settings switches the activation
         policy to .accessory at runtime instead of hard-coding LSUIElement. -->
    <key>NSHighResolutionCapable</key><true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>yraverageSubMin transcribes your voice on-device for dictation. Audio never leaves your Mac.</string>
    <key>NSSpeechRecognitionUsageDescription</key>
    <string>yraverageSubMin uses on-device speech recognition to generate subtitles and dictation. Nothing is uploaded.</string>
</dict>
</plist>
PLIST

# --- icon ------------------------------------------------------------------
LOGO="branding/logo.png"
if [ ! -f "$LOGO" ]; then
    echo "▸ branding/logo.png missing — regenerating from the brand palette…"
    swift Tools/make-icon.swift "$LOGO" >/dev/null || die "could not generate $LOGO"
fi
echo "▸ building app icon…"
ICONSET="$STAGE/AppIcon.iconset"
mkdir -p "$ICONSET"
for sz in 16 32 128 256 512; do
    sips -z $sz $sz "$LOGO" --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null 2>&1 \
        || die "sips failed for ${sz}x${sz}"
    sips -z $((sz * 2)) $((sz * 2)) "$LOGO" --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null 2>&1 \
        || die "sips failed for ${sz}x${sz}@2x"
done
iconutil -c icns "$ICONSET" -o "$SAPP/Contents/Resources/AppIcon.icns" \
    || die "iconutil failed to build AppIcon.icns"

# --- sign ------------------------------------------------------------------
if security find-identity -p codesigning 2>/dev/null | grep -q "$CERT_NAME"; then
    echo "▸ signing with '$CERT_NAME' (stable identity)…"
    codesign --force --deep --sign "$CERT_NAME" --identifier "$BUNDLE_ID" "$SAPP" \
        || die "codesign with '$CERT_NAME' failed"
else
    cat >&2 <<'WARN'

✗ No signing certificate found.

  Without it the app is ad-hoc signed, whose identity is its CDHash — that
  changes on every rebuild, so macOS silently revokes Screen Recording,
  Accessibility and Input Monitoring each time (while still showing the app
  as approved in System Settings).

  Fix it once:   ./make-signing-cert.sh

WARN
    die "refusing to build an app whose permissions would reset"
fi

# --- 3. verify before publishing -------------------------------------------
echo "▸ verifying…"
codesign --verify --strict "$SAPP" || die "signature does not verify"

REQ="$(codesign -d -r- "$SAPP" 2>&1 | tail -1)"
case "$REQ" in
    *"certificate leaf"*) ;;
    *) die "unstable (ad-hoc) signature — permissions would reset on every rebuild:
    $REQ" ;;
esac

GOT_ID="$(codesign -dv "$SAPP" 2>&1 | sed -n 's/^Identifier=//p')"
[ "$GOT_ID" = "$BUNDLE_ID" ] || die "wrong signing identifier: '$GOT_ID' (expected '$BUNDLE_ID')"
[ -f "$SAPP/Contents/Resources/AppIcon.icns" ] || die "AppIcon.icns missing from the bundle"

# --- 4. swap in atomically + refresh Launch Services ------------------------
mkdir -p "$OUT"
rm -rf "$APP.old"
[ -d "$APP" ] && mv "$APP" "$APP.old"
mv "$SAPP" "$APP"
rm -rf "$APP.old"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true
touch "$APP"

echo
echo "✓ built and verified: $APP"
echo "  identity : $GOT_ID"
echo "  signature: stable (survives rebuilds — permissions stay granted)"
echo "  icon     : AppIcon.icns"
echo
echo "Run it:  open \"$APP\""
