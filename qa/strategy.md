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

## Live cases (TC024-TC028)
- Real engine, real Whisper weights, real audio. No mocked helper. Each spec starts its own engine on a free port with `HF_HUB_OFFLINE=1`, so a missing model fails fast and never downloads.
- Needs: `QA_ENGINE_BIN` (built `submeetly-engine`), `QA_HF_HOME` (a hub cache that holds `openai/whisper-base`, 290 MB), `QA_PYTHON`. TC027 also needs `QA_ISLAND_EXE` (built `poni.exe`). TC025 needs `Qwen/Qwen2.5-0.5B-Instruct` in the same cache.
- A case whose model or binary is missing is skipped with the reason, never passed. The suite never downloads models.
- whisper-base translation quality is poor; the cases assert that the pipeline works and the text reads as English, not that it is good.
- Not covered: full-extension tabCapture end to end (`npm run e2e`, `e2e:native`) and a picture of the island pill (DirectComposition window, PrintWindow returns black).

## Environments
- Local, Windows or macOS. Needs `python3` (or `QA_PYTHON`), Node 20+, Rust toolchain for the engine cases.
- Run: `npm run build && npm run qa`.

## Exit criteria
- Every high-priority case passes; no open critical or high defects.
- A case that cannot run (no engine binary, no dist/) shows as skipped with the reason, never as pass.
