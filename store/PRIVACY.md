# Privacy Policy — yraverageSubMin (yraverageSubMin)

**Effective:** 5 September 2026
**Applies to:** the Chrome extension *yraverageSubMin*, the optional Native Helper
(`native/`, bound to `127.0.0.1`), and the optional macOS app.

## Summary

yraverageSubMin does **not** collect, sell, share, or upload your audio, transcripts,
meeting minutes, or personal content to any server we operate. There is no account,
no analytics, no advertising, and no cloud inference. Speech recognition and
translation run **on your device** once model files are present locally.

Everything below is the long form of that one sentence.

## What the software processes, and where it stays

| Data | Why it is processed | Where it lives | How long |
| --- | --- | --- | --- |
| Tab, screen, microphone, or file audio **you start capturing** | Speech recognition (Whisper in the browser via WASM/WebGPU, or the local helper) | In memory during the session; audio is not written to disk by the extension | Discarded when the session ends |
| Transcript and subtitle lines | Live overlay, side-panel transcript, exports | `chrome.storage.local` (session history, at most 50 sessions) and a transcript cache | Until you delete a session or clear extension data |
| Files you drop for offline transcription | Decoding and chunked staging for large files | Origin Private File System (OPFS) inside the extension | Removed after processing / on clear |
| Meeting minutes (decisions, action items, owners, flagged moments, pasted Teams transcripts) | The Notes / Minutes Register feature | `chrome.storage.local` (at most 500 meetings). If you press **Sync** or use the macOS app, the same minutes are written to `~/.yraveragesubmin/notes.json` on your machine | Until you delete the meeting |
| Training progress (XP, levels, achievements, streaks, quiz answers) | The Training / gamification panel | `chrome.storage.local` key `learningProgress` | Until you clear extension data |
| Preferences (languages, engine, device, theme, overlay position, project type, export options) | Remembering your settings | `chrome.storage.local`; the helper keeps `device.json`, `engine-mode.json`, `ui-prefs.json` under `~/.yraveragesubmin/` | Until changed or cleared |
| Model weights | Running recognition/translation offline | Browser cache (extension) and `~/.cache/huggingface/hub` (helper) | Until you delete them from the model manager |

The **sample library** (200+ example transcripts) is synthetic, generated
deterministically inside the extension. It contains no real people, meetings, or
recordings.

## Network activity — none of it is "our cloud"

The extension makes network requests only in these cases, all initiated by you:

- **Model downloads** from `huggingface.co` or, if you choose it, `hf-mirror.com`,
  when you pick a model. Weights are cached locally and never re-uploaded.
- **Chrome's built-in Translator** language packs (Chrome 138+), fetched by the
  browser itself from Google's on-device translation infrastructure when you use that
  path. This is Chrome's feature, not a yraverageSubMin backend.
- **Loopback only** — `http://127.0.0.1:17865` for the optional Native Helper.
  The helper accepts connections from this machine only, rejects web pages by
  origin, checks the `Host` header against DNS rebinding, and refuses to start on a
  network-reachable address unless you explicitly force it.

There are **no** requests to a yraverageSubMin server, no telemetry, no crash
reporting, no advertising SDKs, and no remote code loading (ONNX runtime and VAD
assets ship inside the package).

The development lab page (`127.0.0.1:8799`) can load CC0 test clips from your own
machine. That path is inert in the packaged extension.

## Permissions, honestly

| Permission | What it is used for |
| --- | --- |
| `tabCapture`, `desktopCapture` | Capturing the audio of the tab or window you choose to caption |
| `activeTab`, `tabs`, `scripting`, host access `<all_urls>` | Injecting the subtitle overlay into **the page you are captioning** and reading that tab's title/URL for the session record. The extension does not read or scrape pages you are not captioning |
| `offscreen` | Running the audio pipeline in an offscreen document (MV3 requirement) |
| `storage`, `unlimitedStorage` | Settings, session history, minutes, training progress, model cache |
| `sidePanel`, `contextMenus` | The side-panel UI and its context-menu entries |
| `nativeMessaging` | Starting/stopping the optional local helper without a terminal |

## Your control

- **See** everything stored: side panel → History and Notes; register → Minutes Register.
- **Delete** a session or meeting from those screens, delete models from Settings →
  Model Files, or remove all extension data via `chrome://extensions` → Details →
  *Clear data* / uninstall.
- **Helper files** are plain JSON under `~/.yraveragesubmin/`; delete the folder to
  remove them. `~/.cache/huggingface/hub` holds downloaded weights.
- **Exports** (SRT/VTT/TXT/MD/CSV/JSON) go only where you save them.

## Children, sale of data, third parties

The software is not directed at children and collects no personal data from anyone.
We do not sell, rent, or transfer data because we never receive it. No third-party
service processes your content on our behalf.

## Chrome Web Store data-usage disclosure

For the store's *Privacy practices* form, the accurate answers are: the extension
does **not** collect or transmit user data to the developer; it does not sell data;
it does not use data for purposes unrelated to its single purpose; it does not use
data to determine creditworthiness or for lending. Audio and text are processed
locally and stored only on the user's device.

## Contact and changes

This is an open-source project. For privacy questions, open an issue on the source
repository you obtained the extension from. Material changes to this policy are
recorded in the changelog and reflected on the store listing.

---

## Ringkasan (Bahasa Indonesia)

yraverageSubMin **tidak** mengumpulkan, menjual, atau mengunggah audio, transkrip,
notulen, maupun konten pribadi Anda ke server kami. Tidak ada akun, analitik, iklan,
atau inferensi awan. Pengenalan suara dan terjemahan berjalan di perangkat Anda.
Yang tersimpan — riwayat sesi, notulen, kemajuan latihan, preferensi, bobot model —
ada di penyimpanan lokal ekstensi atau folder `~/.yraveragesubmin/` dan
`~/.cache/huggingface/hub` di komputer Anda, dan bisa Anda hapus sendiri. Koneksi
jaringan hanya untuk unduhan model yang Anda minta (Hugging Face / HF-Mirror), paket
bahasa Translator milik Chrome, dan helper lokal di `127.0.0.1`.
