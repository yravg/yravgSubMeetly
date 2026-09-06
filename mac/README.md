# yraverageSubMin for macOS

A menu-bar app that puts **live floating subtitles** over any app's audio, transcribes
media files to SRT/VTT, and does **hold-to-talk dictation** into whatever app has focus.

Everything runs on-device. No accounts, no telemetry, nothing uploaded.

## Why a Mac app (vs the browser extension)

| | Extension | Mac app |
|---|---|---|
| Capture | one browser tab, per-tab permission each session | **any app** (browser, Zoom, VLC…) or all system audio, one-time grant |
| Overlay | in-page, fights site CSS, breaks in fullscreen/DRM | real floating window, always on top |
| Dictation | impossible | hold **fn**, paste at cursor |
| Speed to first subtitle | ~28 s (helper) / ~96 s (WASM) | **~0.25 s** |

The extension still works and stays as the cross-platform fallback.

## Engines

- **Speech** — Apple `SpeechAnalyzer` / `SpeechTranscriber` (macOS 26+), on the Neural
  Engine. Models are installed and updated by the system, so there are no multi-gigabyte
  downloads to babysit. Emits live partial results, which is what makes subtitles feel
  instant.
- **Translation** — a strategy ladder, all on-device:
  0. Apple **low-latency** model — instant; the only mode fast enough to translate
     live partial text. Install it from Settings → Permissions → *Install fast model*.
  Then, in order:
  1. Apple's **Translation framework**, high-fidelity (~0.5 s/line, measured).
  2. Apple's **on-device foundation model** (Apple Intelligence) as a fallback — needs no
     packs, but takes seconds per line, so live subtitles only translate finished lines
     with it. If neither is ready the app retries in the background and back-fills.

## If anything misbehaves, run the doctor first

```bash
cd mac && ./doctor.sh
```

It checks the toolchain, the signing identity, the built bundle (stable signature,
correct identifier, icon present) and the real permission state as the app itself sees
it — then prints exactly what to do about anything that is wrong. It never reports a
missing measurement as success.

## Build & run

```bash
cd mac && ./build-app.sh && open "build/yraverageSubMin.app"
```

Requires macOS 26+ and Swift 6 (Command Line Tools are enough — no Xcode needed).

Run this **once** first:

```bash
./make-signing-cert.sh
```

### Why permissions used to keep resetting (and can't any more)

`build-app.sh` now guarantees four things, because each one caused a real regression:

1. **It quits a running copy first.** `codesign` cannot sign a running binary. When that
   failed mid-script, the bundle kept SwiftPM's own ad-hoc signature and lost its icon —
   which silently revoked every macOS permission and left a blank Dock icon.
2. **It builds into a staging directory and swaps atomically**, so a failed build can
   never replace a working app with a broken one.
3. **It verifies the finished bundle** — stable certificate-based signature, correct
   bundle identifier, icon present — and *fails loudly* rather than "succeeding". It also
   refuses to build at all if the signing certificate is missing.
4. **It re-registers with Launch Services** so the Dock picks up the icon.

The underlying rule: an ad-hoc signature's identity is its CDHash, which changes on every
rebuild; a certificate's identity is `identifier + certificate leaf`, which does not.
Check any build with `codesign -d -r- build/yraverageSubMin.app` — it must say
`certificate leaf`, never `cdhash`.

## Permissions to grant (one time)

Open the app window → **Settings → Permissions**, or grant them directly:

| Permission | Needed for | Where |
|---|---|---|
| **Screen Recording** | capturing another app's audio | Privacy & Security → Screen Recording |
| **Input Monitoring** | the dictation hotkey | Privacy & Security → Input Monitoring |
| **Accessibility** | pasting dictated text at the cursor | Privacy & Security → Accessibility |
| **Microphone** | dictation | prompted on first use |

macOS may ask you to quit and reopen the app after granting Input Monitoring — that's
expected.

### Translation language packs (optional)

If System Settings → General → Language & Region → **Translation Languages** offers your
pair, installing it makes translation near-instant. The app cannot install packs itself —
`canRequestDownloads` is false and `prepareTranslation` throws — so this is a manual step,
and it isn't available on every Mac.

Without a pack the app falls back to the on-device foundation model, so translation still
works (just slower). Settings → Permissions → *Check current pair* shows what you have.

## Using it

**Live subtitles** — pick the audio source (a specific app, or all system audio), choose
the spoken language, optionally enable Translate, then **Start subtitles**. Drag the
subtitle window anywhere; it stays above fullscreen video. Export the transcript as
SRT/VTT/TXT when you stop.

**Transcribe a file** — the *Transcribe a file* tab: choose any audio/video file, get
time-stamped lines, export SRT/VTT/TXT.

**Dock icon** — yraverageSubMin is a normal Dock app; launching it opens its window.
Settings → Subtitles → *Hide Dock icon (menu bar only)* moves it to the menu bar instead,
applied immediately without a relaunch.

**Dictation** — hold **fn**, speak, release: the text is inserted at your cursor.
Double-tap **fn** for a hands-free session (tap again to stop; auto-stops after 5
minutes). **Esc** cancels. Filler-word cleanup and "restore my previous clipboard" are
in Settings → Dictation.

## The overlay panel

The floating panel mirrors the browser extension's overlay:

| Control | What it does |
|---|---|
| **Refine** | after the fast model puts a line on screen, the on-device model re-translates it for quality |
| **Dual line** | shows the original above the translation |
| **Force translate** | re-run translation over *all* lines, *selected* lines, or only *untranslated* ones |
| **Auto scroll** | follows the newest line |
| **—** / **✕** | minimise to a compact caption bar / hide (reopen from the menu bar) |

Each row has a checkbox (feeds *Force translate → Selected*), a timestamp, and the
source/translation pair; the live line shows as a dimmed interim row. The panel is
draggable by its toolbar and resizable, and its frame is remembered.

## Getting to instant subtitles

Measured on this Mac (`--bench-translate`, en → zh-Hans):

| Model | Warm latency | First call |
|---|---|---|
| `.lowLatency` | **75 ms** avg (35–110) | 1.7 s |
| `.highFidelity` | 490 ms avg (451–507) | 6.2 s |

Live, end to end: first translated text on screen at **1.15 s**, with **15 updates**
during a single spoken sentence.

Two independent things make subtitles feel fast:

1. **Translate while the sentence is still being spoken.** The session keeps exactly
   one translation in flight and always picks up the newest partial text, so it
   self-paces to whatever the model can sustain instead of queueing or thrashing.
   Measured end to end: first translated text on screen at **1.59 s** with **12 live
   updates** during one sentence, versus 2.87 s when only finished lines were
   translated.
2. **Install the low-latency model** — Settings → **Languages** shows, per pair, which
   of the two models is installed, with an *Install fast model* button and a shortcut to
   System Settings → General → Language & Region → Translation Languages. The low-latency
   variant is a separate download that only an app can request (via
   `preferredStrategy: .lowLatency`); the System Settings sheet installs the standard one.

Chinese output is normalised to the requested script: the low-latency model occasionally
answers a `zh-Hans` request in Traditional, so translations run through an ICU
`Hant-Hans` transform (a no-op when the text is already Simplified).

## A note on translation speed

Two separate models exist per language pair and **installing one does not install the
other**. Asking the default (high-fidelity) availability object about a low-latency
session reports "installed" for a pair that then throws `.notInstalled` on every call —
which previously produced *silently empty* subtitles while the UI claimed success. The
engine now queries availability per strategy, verifies a session with a real translation
before adopting it, and never swallows the error.

## Branding

The icon is generated from the yraverage palette — teal `#388F8D`, charcoal
`#302F2C`, cream `#F7F6EE` — sampled from the wordmark:

```bash
swift Tools/make-icon.swift branding/logo.png   # regenerate the icon
./build-app.sh                                   # picks up branding/logo.png automatically
```

`branding/wordmark.png` holds the original logo. Drop any square PNG at
`branding/logo.png` to override the generated icon.

## Layout

```
mac/
├─ Package.swift
├─ build-app.sh                 # builds, makes the icon, signs the .app bundle
├─ make-signing-cert.sh         # one-time: stable identity so permissions persist
├─ doctor.sh                    # diagnoses signing, icon and permission problems
├─ branding/                    # logo.png (icon source) + wordmark.png
├─ Tools/make-icon.swift        # generates the app icon from the palette
└─ Sources/
   ├─ TransSubKit/              # engine core
   │  ├─ AudioCapture.swift     # ScreenCaptureKit per-app / system audio → Float32 PCM
   │  ├─ Transcriber.swift      # SpeechAnalyzer streaming + file transcription
   │  ├─ Translator.swift       # Translation framework, single-owner session
   │  ├─ Subtitles.swift        # SRT / VTT / TXT export
   │  ├─ Languages.swift, Prefs.swift
   ├─ LocalTransSub/            # the app
   │  ├─ App.swift              # menu bar, app controller
   │  ├─ MainWindow.swift, MainView.swift, SettingsView.swift, ViewModels.swift
   │  ├─ OverlayWindow.swift    # floating subtitle panel
   │  └─ DictationController.swift
   ├─ spike-capture/            # probe: per-app audio capture
   └─ spike-engine/             # probe: speech + translation on a file
```

## Probes

Both run headlessly and print what actually happened — useful when something breaks:

```bash
swift run spike-engine ../test/speech.wav en-US   # speech + translation, no permissions needed
swift run spike-capture                            # list capturable apps
swift run spike-capture Safari 8                   # capture 8 s and report audio levels
```

## Notes and gotchas

- `SpeechAnalyzer(inputSequence:modules:)` already attaches its input; calling
  `start(inputSequence:)` as well leaves audio silently unconsumed. Use
  `SpeechAnalyzer(modules:)` + `start(...)`.
- Top-level code in `main.swift` is `@MainActor`-isolated — `Task { }` plus a blocking
  semaphore deadlocks with no output. The spikes use top-level `await`.
- `@State` is a macro in the macOS 26 SDK and its plugin ships only with full Xcode, so
  this project keeps view state in `ObservableObject`s instead.
- A bare CLI binary can't hold privacy permissions; they attach to the signed bundle.
- `SCShareableContent` **blocks forever** when Screen Recording is denied — gate it behind
  `CGPreflightScreenCaptureAccess()` rather than using it as the permission probe.
- `SystemLanguageModel.availability` reports `.notReady` for a model that answers fine a
  moment later, so the engine probes with a real translation instead of trusting it.
