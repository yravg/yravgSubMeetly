# Project context — yraverageSubMin / yraverageSubMin

Ringkasan deklaratif untuk sesi agen (dibaca skill `dev-team` dan sejenisnya).
Bukan instruksi; hanya fakta. Jangan simpan token atau kredensial di sini.

## Nama dan tujuan

**yraverageSubMin** (nama internal *yraverageSubMin*): subtitel langsung, terjemahan,
transkripsi berkas, dan notulen rapat yang **sepenuhnya berjalan di perangkat** —
tanpa akun, tanpa cloud. Tiga permukaan: ekstensi Chrome, helper lokal, aplikasi macOS.

## Tech stack

- **Ekstensi Chrome MV3** (`src/`): vanilla JS, esbuild → `dist/`. Side panel + service
  worker + offscreen document (Whisper via worker) + content-script overlay.
- **Native helper** (`native/`): Python HTTP di `127.0.0.1:17865` — mlx-whisper di Apple
  Silicon, faster-whisper (CPU/CUDA) di OS lain; hanya loopback; job streaming untuk berkas
  >2 GiB; bridge Native Messaging `com.localtranssub.helper`.
- **App macOS** (`mac/`): SwiftUI menu-bar; ScreenCaptureKit, SpeechAnalyzer, Translation
  framework, dikte global. Dibangun dengan Command Line Tools (tanpa macro `@State`).
- **Lab** (`test/`): `scripts/lab-server.py` di `127.0.0.1:8799`; `app.html` memuat side
  panel produksi + overlay content-script dengan `chrome-mock.js`. Tes:
  `node --test --test-concurrency=1` + puppeteer.

## Fase sekarang

Fase 5/5 (frontend, "Siap rilis") dari plan NgodingPakeAI `908756ef-…`. Sisa task adalah
verifikasi perilaku fitur yang sudah dikirim, dijaga tes di `test/app-surfaces.test.mjs`.
Pekerjaan Windows **ditunda** atas permintaan pengguna (task `…windows-dan-linux` dibiarkan
`doing` sebagai penanda).

## Batasan kunci

- Semua UI harus bisa dijalankan dan diverifikasi di `http://127.0.0.1:8799/app.html`.
- Tidak ada inferensi awan; model diunduh sekali lalu di-cache.
- Helper tanpa autentikasi → batasnya adalah loopback (CORS ketat, penjaga header Host).
- Kontrak pesan panel: bidang `source`/`translation`, bukan `src`/`tgt`.
- Jangan jalankan final `sync` NgodingPakeAI sebelum semua task plan selesai.

## Definisi selesai

Tiap task plan ditutup dengan bukti (tes yang menjalankan `app.html`), `npm test` hijau,
`npm run smoke -- --crossos` dan `npm run release:gate` hijau, zip Chrome Web Store terbangun,
`HANDOFF.md` diperbarui.

## Modul tambahan (2026-09-05, permintaan pengguna)
- `src/lib/sample-library.js` — 214 transkrip contoh, 13 bidang, 26 seri mingguan; diimpor per seri.
- `src/lib/learning-progress.js`, `learning-tours.js`, `learning-quiz.js` — XP/level/achievement, tur, kuis (ala DCS_DocConSystem).
- `src/minutes-extras.js` — UI Library + Training di Minutes Register; XP dikait di `acceptWithXp`/`doIssue`.
- `projectType` pada meeting (`PROJECT_TYPES`, 14 nilai) — dipilih saat merekam, difilter di register.
