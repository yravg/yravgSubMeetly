# Test strategy: yravgSubMeetly

## Scope
- In: the browser surfaces of the extension, served by `scripts/lab-server.py` with the lab mock (`window.__labMock`, `test/chrome-mock.js`):
  - `app.html` lab shell: side panel captions, export TXT/SRT/VTT, settings modal, notes/register, native-helper fallback.
  - `dist/minutes.html` Minutes Register: sample register, add decision/action, filters, search, export MD/CSV/JSON, dock.
  - Rust engine HTTP (`engine-rs`, binary `submeetly-engine`): `/health`, `/notes` round trip, origin and Host refusal.
- Out: real microphone/tab capture, Whisper/Qwen inference (ENG-002/003 not built), the Rust island (`island/`, no browser UI), the macOS app, Chrome Web Store packaging. These need hardware, models or another OS.

## Approach
- End-to-end in a real browser (Playwright, Chrome for Testing from `PUPPETEER_EXECUTABLE_PATH`), one spec per case; test titles start with the case id (TC001 ...).
- No network and no model download: the lab mock answers the helper, subtitles are injected through `__mockEmit`.
- Servers start in `qa/specs/global-setup.mjs` on free ports (never 8799) and stop at teardown. The engine is built with `cargo build` (incremental) unless `QA_ENGINE_BIN` points at a binary.
- Waits are on conditions only, no fixed sleeps. Each case starts from clean storage.
- Each run writes `qa/runs/<run>.json` and its screenshots and videos to `qa/evidence/<run>/` (gitignored).
- Data: fixtures only (Selamat pagi / Good morning, sample register). No real names or project data.

## Environments
- Local, Windows or macOS. Needs `python3` (or `QA_PYTHON`), Node 20+, Rust toolchain for the engine cases.
- Run: `npm run build && npm run qa`.

## Exit criteria
- Every high-priority case passes; no open critical or high defects.
- A case that cannot run (no engine binary, no dist/) shows as skipped with the reason, never as pass.
