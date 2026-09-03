# Translation Lab

Self-contained benchmark UI and headless runner for **Refine** draft speed and quality across language pairs — no extension UI required.

## Quick start

**Mac (double-click):** `Start Lab.command` / `Stop Lab.command` in the project folder.

**Terminal:**
```bash
./scripts/start-lab.sh    # opens http://127.0.0.1:8799/lab.html
./scripts/stop-lab.sh
./scripts/lab-status.sh
```

**Windows:** `scripts\start-lab.bat` / `scripts\stop-lab.bat`

Or full setup with native helper:

## What it tests

| Stage | Endpoint | Target |
|-------|----------|--------|
| Live draft | `POST /draft` | ≤500 ms total (ASR + fast MT) |
| Final ASR | `POST /transcribe` | Full utterance accuracy |
| Fast MT | `POST /translate?fast=1` | Draft translation |
| Refine | `POST /translate_refine` | Semantic correction at sentence end |

Language pairs (built-in samples):

- **zh → en** — Chinese → English  
- **en → zh** — English → Chinese  
- **ja → en** — Japanese → English  
- **en → ja** — English → Japanese  

Samples are macOS TTS speech (`scripts/gen-samples.py`). Regenerate with:

```bash
./scripts/gen-samples.sh
```

### YouTube videos

Paste a YouTube link in the lab. The server tries to extract audio with **yt-dlp** (cached under `.lab-cache/youtube/`).

If download fails (YouTube bot check / cookies):

1. **Recommended:** `./scripts/dev-browser.sh` → open the YouTube tab → extension **Start capture**
2. Download with `yt-dlp URL` and **upload the file** in the lab
3. Export cookies and set `YT_DLP_COOKIES_FILE=/path/to/cookies.txt`

Requires `yt-dlp` (`pip install yt-dlp`) and `ffmpeg`. Restart lab after install: `./scripts/run-lab.sh`

## Lab UI features

- **Media player** — built-in samples, file upload, **YouTube URLs** (via local yt-dlp proxy), or direct URL (CORS permitting)
- **Live refine simulator** — polls `/draft` every 300 ms while audio plays
- **Run all language pairs** — fills results table + exports JSON
- **Native health** — shows engine, draft model, feature flags

## Interpreting results

- **Draft ≤500 ms** — on-target for Rokid-style live captions (native engine, warm models)
- **First draft after cold start** — often 1–3 s; warmup pass in `bench-lab.py` reduces this
- **Browser WASM path** — slower; use **Engine → Native** in the extension for production refine

Latest automated run is saved to `test/last-bench.json` when using `--json`.

## Browser-tab app

Open the main side-panel UI in a normal tab with **real on-device Whisper** (same stack as the extension browser engine):

```text
http://127.0.0.1:8799/app.html
```

Requires a built `dist/` (`npm run build`). Lab serves `/dist/` (UI, `offscreen.js`, `ai-worker.js`, ORT/VAD assets).

**How it works:** `chrome-mock.js` acts as a mini background; the page loads `/dist/offscreen.js`, which spawns `/dist/ai-worker.js` (transformers.js Whisper via `src/lib/asr.js`). Offline file jobs stage to OPFS and run decode → VAD → ASR → optional MT, like the extension.

**Limits**

- Realtime **tabCapture** / desktopCapture — Chrome extension only
- First Offline run downloads Whisper (and MT models if translating) from Hugging Face; then Cache API / offline
- Native messaging launcher unavailable in a plain tab (HTTP native helper still usable if Engine → Native and helper is running)
- Notes panel still uses local stub generation unless wired to a live transcript

## Other test pages

| URL | Purpose |
|-----|---------|
| `/app.html` | Side-panel UI in a normal browser tab |
| `/index.html` | Test page index |
| `/audio-page.html` | Tab audio loop for extension e2e |
| `/lab.html` | Translation Lab (this doc) |
