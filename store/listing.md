# Chrome Web Store listing copy — Local TransSub 1.1.1

Paste into the Developer Dashboard. Keep English as the primary locale; Indonesian is optional.

## Name
Local TransSub

## Short description (≤132 characters)
Realtime subtitles & translation on-device. No accounts — audio stays on your device after models download.

Character count check (English above): ~110.

### Short description (Indonesian, optional)
Subtitel & terjemahan real-time di perangkat. Tanpa akun — audio tetap lokal setelah model terunduh.

## Detailed description (English)

Local TransSub adds live and offline subtitles to Chrome tabs and media files using on-device AI:

- Transcription with Whisper in the browser (WASM/WebGPU) or an optional Native Helper
- Layered translation: Whisper-direct, Chrome Translator (when available), Opus-MT, local LLM via helper
- Shadow DOM overlay + Side Panel controls
- Export SRT / WebVTT / TXT
- Optional Windows / Linux / macOS helper for larger files and faster ASR
- Meeting notes stub panel (schema + local export helpers)

**Privacy:** Recognition and translation run on your device. We do not operate cloud inference. Model weights download once when you choose a model (e.g. Hugging Face) and are cached locally afterward. See the Privacy Policy linked on this listing.

**Permissions:** Tab/desktop audio capture, storage for prefs and caches, offscreen document for the audio pipeline, scripting to inject the subtitle overlay on the tab you capture, and optional native messaging to start a local helper on 127.0.0.1.

## Detailed description (Indonesian, optional)

Local TransSub menambahkan subtitel langsung pada tab Chrome dan berkas offline dengan AI di perangkat:

- Transkripsi Whisper di browser (WASM/WebGPU) atau Native Helper opsional
- Terjemahan berjenjang: Whisper-direct, Chrome Translator, Opus-MT, LLM lokal
- Overlay Shadow DOM + Side Panel
- Ekspor SRT / WebVTT / TXT
- Helper opsional Win/Linux/macOS untuk berkas besar & ASR lebih cepat

Inferensi berjalan di perangkat. Bobot model diunduh sekali atas permintaan Anda, lalu di-cache lokal. Lihat Kebijakan Privasi di listing.

## Category
Productivity (Accessibility also acceptable)

## Language
Primary UI: English, Chinese (中文). Listing may also offer Indonesian copy.

## Assets

- Icons: `store/icons/` (16 / 48 / 128)
- Screenshots: `store/screenshots/` — 1280×800, dihasilkan `npm run pack:store:screens`

  | Berkas | Yang ditampilkan |
  | --- | --- |
  | `01-sidepanel-realtime.png` | Side Panel: subtitel langsung + pilihan bahasa |
  | `02-notes-minutes.png` | Notulen rapat dari transkrip sesi |
  | `03-settings-helper.png` | Pengaturan mesin, sumber unduhan, model |

  Ditangkap dari `app.html`, yang memuat side panel produksi (`dist/`) — jadi
  screenshot selalu menunjukkan UI yang benar-benar dikirim. Jangan menyunting
  PNG-nya dengan tangan; jalankan ulang skripnya setelah UI berubah.
  `store/screenshots/captions.json` mencatat sumber, ukuran, dan waktu tangkap.

- Promo tile 440×280: **belum ada** — opsional di Chrome Web Store; listing bisa
  dikirim tanpa itu.
