# Engine goldens

Captured from `native/server.py` (the oracle) by:

```sh
node scripts/gen-engine-golden.mjs
```

The capture harness stubs `faster_whisper` and `ctranslate2` in a throwaway
bootstrap module so the Python helper starts without downloading a Whisper
model. Captured routes are the ones that answer without a model: state,
notes, the heuristic `/notes/generate` and `/notes/summarize`, `/models`
(with `HF_HUB_CACHE` pointed at a copy of `fixtures/hf-cache`), the
`DELETE /models/cache/...` guard, `/models/pull` validation, and the
short-body answers of `/transcribe` and `/draft`. Replay runs with
`TRANSLATE=off`, matching the oracle on a machine without MLX.

ASR is compared separately against real models: `ml/whisper-base.json` comes
from `node scripts/gen-engine-ml-golden.mjs` (faster-whisper `base`) and is
checked by the ignored test `engine-rs/engine/tests/ml_golden.rs` (WER and
segment start times).

Each file is one request:

- `request` — method, path, the headers the capture set, raw body (or null).
- `response` — oracle status and JSON body.
- `mask` — response fields that legitimately vary between machines/engines.
  Dotted paths; they are stripped from the stored body and from the Rust reply
  before comparing, so re-running the capture is byte-stable.

Files replay in filename order against one Rust `App`, because note/device/
mode/UI-pref state carries across requests exactly as it did during capture.

Notes:

- Response numbers are compared by value, not by JSON spelling: the capture
  round-trips through `JSON.parse`/`JSON.stringify`, which prints Python's
  `1.0` as `1`.
- The `GET /health`, device and language goldens mask engine identity
  (`engine`, `model`, `device`, `compute`, `platform`, ML feature flags).
  Everything non-ML (status, `ok`, `engine_mode`, notes/ui features) must
  match exactly.
- `POST /notes` with an empty body masks the generated note id and
  `generatedAt`, which are wall-clock values.
- Replay assumes the default policy and default state file names: do not set
  `ALLOWED_ORIGINS`, `NOTES_PATH`, `ENGINE_MODE_PATH`, `DEVICE_PREF_PATH` or
  `UI_PREFS_PATH` while running `cargo test`.
