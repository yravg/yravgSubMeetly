# yraverageSub

Live subtitles, transcription and translation that run **entirely on your device**.
No accounts, no telemetry — no audio, video or text ever leaves your machine.

This repo holds two clients built on that same idea:

| Client | What it does |
|---|---|
| **Browser extension** (`src/`) | Realtime floating subtitles over any Chrome/Edge tab, plus file transcription to SRT/VTT. Documented below. |
| **macOS app** (`mac/`) | Menu-bar app putting subtitles over *any* application's audio — not just a browser tab — with file transcription and hold-to-talk dictation. See **[mac/README.md](mac/README.md)**. |

An optional **native helper** (`native/`) runs Whisper large-v3-turbo on the Apple
Silicon GPU via MLX, giving both clients a faster and more accurate engine.

Inspired by the "Local AI Subtitle" extension, rebuilt from scratch on an open stack.

---

## The browser extension

A fully-offline Chrome extension that generates **realtime floating subtitles** for any
browser tab, and transcribes/translates **uploaded audio/video files** to SRT/VTT — with
every AI model running **locally on your device**.

## Features

- **Realtime mode** — capture the audio of the current tab (YouTube, courses, streams…),
  transcribe it with Whisper, optionally translate it, and show a draggable floating
  subtitle overlay right on the video (fullscreen supported). The tab stays audible.
- **Offline mode** — drop an mp3/wav/m4a/mp4/webm/ogg file, get timestamped lines, and
  export **SRT / VTT / TXT**.
- **Task modes** — Transcribe only, or Transcribe + Translate (with optional dual-line
  original + translation display).
- **Translation, tiered and always local**:
  1. *Any language → English*: Whisper's built-in speech translation (no extra model).
  2. Chrome's built-in on-device Translator API (Chrome 138+), when available.
  3. Helsinki-NLP **Opus-MT** ONNX models (~115 MB per language pair, downloaded once).
- **Two engines** (Settings → Engine):
  - *Browser* — everything inside the extension via transformers.js. Models: Whisper
    Tiny / Base / Small (WASM or WebGPU), **Whisper Large v3 Turbo** (~565 MB, WebGPU)
    and **Voxtral Mini 3B** (~2.7 GB, WebGPU, the model the original extension uses).
  - *Native helper* — a tiny localhost server (`native/`) running **Whisper Large v3
    Turbo on the Apple Silicon GPU via MLX** (faster-whisper on other machines). This
    is by far the fastest and most accurate option (≈10–20× realtime), and it adds an
    on-device **LLM translator** (Qwen2.5) for high-quality en ↔ zh / ja translation.
    See *Native helper* below.
- **Model manager** — download / delete browser models with per-model progress bars
  (several at once); HuggingFace or HF-Mirror download source; WebGPU/WASM device
  selection; English/中文 UI.
- **History** — recent realtime sessions and offline jobs, exportable as SRT/TXT.
- Voice-activity detection (Silero VAD) gates the audio so silence and music don't
  reach Whisper — faster, cheaper, and it suppresses the classic "Thank you for
  watching" hallucinations (a blocklist catches the rest).

## Install (Load unpacked)

1. Build (only needed after code changes — `dist/` is checked in after a build):

   ```bash
   npm install
   npm run build
   ```

2. **Chrome**: open `chrome://extensions`, enable **Developer mode** (top right).
   **Edge**: open `edge://extensions`, enable **Developer mode** (left sidebar).
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin "Local TransSub" and click its icon — the side panel opens (in Edge it opens
   in the sidebar).

Requires Chrome 120+ or Edge 120+ (any recent Chromium browser with the sidePanel,
offscreen, and tabCapture APIs). WebGPU inference needs a GPU-capable machine;
otherwise WASM is used automatically. Note: Chrome's built-in Translator API needs a
newer browser (Chrome 138+/Edge 148+) — on older versions the Opus-MT fallback is
used automatically, so translation still works fully offline.

## First run

1. Open the ⚙️ settings → **Model Files** → download **Whisper Base** (~80–210 MB
   depending on device) — or just press **Start Task** and it downloads on demand.
2. For translation to languages other than English, download the language-pair model
   the warning banner suggests (e.g. `en → zh`, ~121 MB).
3. Models are cached in browser storage — after the first download everything runs
   **fully offline**.

## Native helper (recommended on a Mac — fastest & most accurate)

The browser engine is limited to single-threaded WASM or WebGPU. The native helper
runs the best Whisper model on your machine's GPU and the extension talks to it over
`http://127.0.0.1:17865` — still 100 % local, nothing leaves the computer.

```bash
cd native && ./run.sh
```

First run creates a virtualenv, installs `mlx-whisper` (+ `mlx-lm` for translation)
and downloads `whisper-large-v3-turbo` (~1.6 GB) into `~/.cache/huggingface`. Then in the extension:
**Settings → Engine → Native helper** — the status dot shows online/offline, and you
can **Start / Stop / Restart** the helper (after a one-time launcher install):

```bash
cd native && ./install-host.sh YOUR_EXTENSION_ID
```

(Find `YOUR_EXTENSION_ID` on `chrome://extensions` with Developer mode on.)

Or start manually: `cd native && ./run.sh` and leave the terminal open.

- Offline (file) mode decodes audio in the browser and streams PCM to the helper, so
  **no ffmpeg is required**.
- Options: `TRANSLATE=off ./run.sh` skips the translation LLM (~1.8 GB, downloaded on
  first translation); `WHISPER_MODEL=mlx-community/whisper-small-mlx ./run.sh` for a
  smaller model; `PORT=… ./run.sh` to change the port (update it in Settings).
- Requires Python 3.9+ and macOS 13.5+ on Apple Silicon. On Intel/Linux/Windows the
  script installs `faster-whisper` instead (CPU/CUDA).

## Usage

**Realtime**: open a video page → open the side panel → pick source language and
target → **Start Task**. Subtitles appear over the page; drag them anywhere. **End
Task** stops capture and saves the transcript to History.

If Chrome refuses automatic tab capture ("extension has not been invoked"), either
**right-click the page → "Start Local TransSub on this page"**, or use **Pick tab /
window manually** — a screen-share-style picker; choose the Chrome tab and tick
*"Also share tab audio"* (window/screen system audio isn't available on macOS).

**Offline**: switch the toggle to *Offline* → drop a media file → **Start Task** →
watch lines stream in → export SRT/VTT/TXT.

## Architecture

```
side panel (UI) ──► service worker ── tabCapture streamId ──► offscreen document
                                                              │  getUserMedia(tab)
                                                              │  AudioContext passthrough (tab stays audible)
                                                              │  Silero VAD → utterances
                                                              │  Whisper (transformers.js, WebGPU/WASM)
                                                              │  Translation (Chrome API / Opus-MT WASM)
                                                              ▼
                              content script ◄── subtitles ── service worker
                              (Shadow-DOM overlay, fullscreen reparenting)
```

- MV3 service workers can't touch audio or the DOM, so the whole pipeline lives in an
  **offscreen document**.
- ONNX Runtime WASM binaries, the VAD worklet, and Silero models ship inside the
  package (MV3 forbids CDN scripts); model *weights* download at runtime and are
  cached via the browser Cache API (`unlimitedStorage`).
- Offline files are handed to the pipeline through OPFS (same-origin private FS).

## Dev notes

- `npm run watch` — rebuild on change.
- **`./scripts/run-lab.sh`** — Translation Lab at `http://127.0.0.1:8799/lab.html` (media player + automated zh↔en / ja↔en benchmark against the native helper). See `test/README.md`.
- `python3 scripts/bench-lab.py --json test/last-bench.json` — headless benchmark (no browser).
- `node scripts/smoke.mjs` — Node smoke test of the exact transformers.js calls
  (model IDs, dtypes, output shapes) used by the extension.
- `test/overlay-test.html`, `test/panel-test.html` — visual harnesses that run the real
  built UI with a mocked `chrome.*` API (serve the repo root, e.g.
  `python3 -m http.server 8799`).
- Known constraints: one tab captured at a time; capture stops if the tab navigates;
  DRM sites may block capture; `mkv` files aren't decodable by Chrome's
  `decodeAudioData`.

## Open-source components

| Component | License |
|---|---|
| OpenAI Whisper (onnx-community exports) | MIT |
| Mistral Voxtral Mini (onnx-community export) | Apache 2.0 |
| Apple MLX · mlx-whisper · mlx-lm (native helper) | MIT |
| Qwen2.5 Instruct (native translation LLM) | Apache 2.0 |
| Hugging Face transformers.js | Apache-2.0 |
| Microsoft ONNX Runtime Web | MIT |
| Helsinki-NLP Opus-MT models (Xenova exports) | CC BY 4.0 |
| Silero VAD | MIT |
| @ricky0123/vad-web | ISC |

All processing is on-device. Model weights' copyrights belong to their original
authors and institutions.
