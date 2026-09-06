#!/bin/bash
# yraverageSubMin doctor — checks everything that has ever broken, and says
# exactly how to fix it. Run this first whenever something misbehaves.
#
#   ./doctor.sh
cd "$(dirname "$0")"

APP_NAME="yraverageSubMin"
BUNDLE_ID="com.yraveragesubmin.app"
CERT_NAME="${CERT_NAME:-yraverageSubMin Dev}"
APP="build/$APP_NAME.app"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n     → %s\n' "$1" "$2"; FAILED=1; }
warn() { printf '  \033[33m!\033[0m %s\n     → %s\n' "$1" "$2"; }
FAILED=0

echo
echo "yraverageSubMin doctor"
echo "──────────────────────────────────────────────"

# --- toolchain --------------------------------------------------------------
echo "Toolchain"
OSV=$(sw_vers -productVersion)
case "${OSV%%.*}" in
    2[6-9]|[3-9][0-9]) ok "macOS $OSV (speech + translation available)" ;;
    *) bad "macOS $OSV" "needs macOS 26+ for on-device speech and translation" ;;
esac
command -v swift >/dev/null && ok "swift $(swift --version 2>/dev/null | head -1 | sed 's/.*version //;s/ .*//')" \
    || bad "swift not found" "install Xcode Command Line Tools: xcode-select --install"

# --- signing identity -------------------------------------------------------
echo
echo "Signing"
if security find-identity -p codesigning 2>/dev/null | grep -q "$CERT_NAME"; then
    ok "certificate '$CERT_NAME' present"
else
    bad "no signing certificate" "run ./make-signing-cert.sh  (without it, every rebuild wipes your permissions)"
fi

# --- the built app ----------------------------------------------------------
echo
echo "App bundle"
if [ ! -d "$APP" ]; then
    bad "$APP not built" "run ./build-app.sh"
else
    ok "$APP exists"

    REQ=$(codesign -d -r- "$APP" 2>&1 | tail -1)
    case "$REQ" in
        *"certificate leaf"*) ok "stable signature (permissions survive rebuilds)" ;;
        *cdhash*) bad "ad-hoc signature" "run ./build-app.sh again — an ad-hoc build revokes all permissions" ;;
        *) warn "could not read signature requirement" "$REQ" ;;
    esac

    GOT_ID=$(codesign -dv "$APP" 2>&1 | sed -n 's/^Identifier=//p')
    [ "$GOT_ID" = "$BUNDLE_ID" ] && ok "identifier $GOT_ID" \
        || bad "identifier is '$GOT_ID', expected '$BUNDLE_ID'" "run ./build-app.sh"

    [ -f "$APP/Contents/Resources/AppIcon.icns" ] && ok "app icon present" \
        || bad "app icon missing (blank Dock icon)" "run ./build-app.sh"

    codesign --verify --strict "$APP" 2>/dev/null && ok "signature verifies" \
        || bad "signature does not verify" "run ./build-app.sh"
fi

# --- permissions ------------------------------------------------------------
echo
echo "Permissions (as seen by the app itself)"
if [ -d "$APP" ]; then
    rm -f /tmp/transsub-perms.txt
    open "$APP" --args --check-perms 2>/dev/null
    echo "  (probing — the translation checks take up to a minute)"
    COMPLETE=0
    for _ in $(seq 1 150); do
        if grep -q "REPORT COMPLETE" /tmp/transsub-perms.txt 2>/dev/null; then
            COMPLETE=1; break
        fi
        sleep 1
    done
    pkill -f "$APP_NAME.app/Contents/MacOS/" 2>/dev/null || true

    if [ -f /tmp/transsub-perms.txt ]; then
        grep -q "screen preflight: true" /tmp/transsub-perms.txt \
            && ok "Screen Recording granted" \
            || bad "Screen Recording not granted" "System Settings → Privacy & Security → Screen Recording → enable yraverageSubMin, then reopen the app"
        grep -q "shareable content: OK" /tmp/transsub-perms.txt \
            && ok "audio capture works ($(sed -n 's/.*OK — \([0-9]*\) targets.*/\1/p' /tmp/transsub-perms.txt) sources)" \
            || warn "capture not verified" "grant Screen Recording, then reopen the app"
        grep -q "accessibility   : true" /tmp/transsub-perms.txt \
            && ok "Accessibility granted (dictation can paste)" \
            || warn "Accessibility not granted" "only affects dictation auto-paste; text still goes to the clipboard"
        # Tri-state on purpose: a missing line means "not measured", never "fine".
        if [ "$COMPLETE" != "1" ]; then
            warn "translation checks did not finish" "re-run ./doctor.sh; the first probe can be slow while the model warms up"
        else
            PAIRS=$(sed -n 's/.*INSTALLED PAIRS (\([0-9]*\)).*/\1/p' /tmp/transsub-perms.txt)
            if [ -z "$PAIRS" ]; then
                warn "translation pack status unknown" "re-run ./doctor.sh"
            elif [ "$PAIRS" = "0" ]; then
                warn "no Apple translation language packs" "optional — translation falls back to the on-device model (slower but works)"
            else
                ok "$PAIRS Apple translation pairs installed (fast path)"
            fi

            if grep -q "on-device LLM availability: available" /tmp/transsub-perms.txt; then
                ok "on-device model available (translation fallback)"
            elif grep -q "on-device LLM availability:" /tmp/transsub-perms.txt; then
                warn "on-device model not ready right now" "it loads on demand; the app retries by itself during a session"
            else
                warn "on-device model status unknown" "re-run ./doctor.sh"
            fi
        fi
    else
        warn "could not collect permission report" "open the app once, then re-run ./doctor.sh"
    fi
else
    warn "skipped" "build the app first"
fi

echo
echo "──────────────────────────────────────────────"
if [ "$FAILED" = "1" ]; then
    echo "Some checks failed — follow the → hints above."
    exit 1
fi
echo "All good. Run:  open \"$APP\""
