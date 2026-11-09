#!/usr/bin/env bash
# Print the path of the submeetly-engine binary (the helper and the Native
# Messaging host are the same executable). Exit 1 when it is not built.
# Order: $SUBMEETLY_ENGINE, beside this script (packaged layout), then
# engine-rs/target/{release,debug} (also under $CARGO_TARGET_DIR).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
NAME="submeetly-engine"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) NAME="submeetly-engine.exe" ;; esac

for candidate in \
  "${SUBMEETLY_ENGINE:-}" \
  "$HERE/$NAME" \
  "${CARGO_TARGET_DIR:+$CARGO_TARGET_DIR/release/$NAME}" \
  "$ROOT/engine-rs/target/release/$NAME" \
  "${CARGO_TARGET_DIR:+$CARGO_TARGET_DIR/debug/$NAME}" \
  "$ROOT/engine-rs/target/debug/$NAME"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    echo "$candidate"
    exit 0
  fi
done

echo "submeetly-engine is not built. Run:  cargo build --release -p submeetly-engine --manifest-path engine-rs/Cargo.toml" >&2
exit 1
