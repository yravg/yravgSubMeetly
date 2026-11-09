#!/usr/bin/env bash
# Start the yravgSubMeetly helper (the Rust engine) in the foreground.
#   PORT=17866 ./run.sh        # other port
#   TRANSLATE=off ./run.sh     # skip the translation model
#   WHISPER_MODEL=base ./run.sh  # smaller, faster speech model
#   DEVICE=cpu ./run.sh        # auto (default), cpu or cuda
# Models download on first use into the Hugging Face cache.
set -euo pipefail
exec "$(bash "$(dirname "$0")/engine-path.sh")" "$@"
