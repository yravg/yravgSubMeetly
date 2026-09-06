# Panduan lingkungan & build

Tiga komponen, tiga toolchain. Semuanya berjalan lokal; tidak ada langkah yang butuh
akun atau layanan awan.

| Komponen | Folder | Toolchain | Keluaran |
| --- | --- | --- | --- |
| Ekstensi Chrome (MV3) | `src/` | Node 20+ (diuji Node 24), esbuild | `dist/` |
| Native Helper | `native/` | Python 3.10+, ffmpeg; mlx-whisper (Apple Silicon) / faster-whisper | server HTTP di `127.0.0.1:17865` |
| Aplikasi macOS | `mac/` | macOS 26+, Swift 6 (Command Line Tools cukup) | `mac/build/yraverageSubMin.app` |

---

## Ekstensi Chrome

```bash
npm install
npm run build          # → dist/ (bersih tiap kali: rm -rf dist lalu bundel ulang)
npm run watch          # bundel ulang saat berkas berubah
```

`esbuild.config.mjs` membundel `background.js`, `offscreen.js`, `ai-worker.js`,
`sidepanel.js`, `minutes.js` (ESM) dan `content.js` (IIFE), menyalin HTML/CSS/ikon,
serta **menyalin semua varian** ONNX Runtime WASM dan aset VAD ke `dist/` — MV3
melarang memuat kode dari CDN, jadi semuanya harus ada di paket.

Memuat ke Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`.
ID ekstensi yang muncul dibutuhkan installer Native Messaging host.

### Lab (halaman uji di browser)

```bash
./scripts/start-lab.sh     # http://127.0.0.1:8799  (server: scripts/lab-server.py)
./scripts/stop-lab.sh
```

- `http://127.0.0.1:8799/app.html` — **side panel produksi** (`dist/`) dipasang di satu
  halaman dengan `chrome.*` tiruan (`test/chrome-mock.js`), termasuk overlay subtitel.
  Ini permukaan verifikasi utama: setiap perubahan UI dicek di sini.
- `window.__labMock` di app.html: `helper.mode` (`passthrough` | `offline` | `fixture`),
  `latencyMs`, `failNext`, log permintaan — untuk memicu keadaan helper mati/lambat.
- `/src/minutes.html` (Minutes Register), `/guide.html` (panduan pengguna), `/lab.html`
  (Translation Lab), `/helper-guide.html`, `/models.html`, dan lainnya di menu app.html.
- Server lab menyajikan `/dist`, `/src`, `/docs`, `/native` dari root repo dengan
  `Cache-Control: no-store` supaya build terbaru selalu yang tampil.

`npm run dev:browser` membangun lalu membuka Chrome for Testing dengan ekstensi termuat
dan profil sekali pakai (`.dev-profile/`).

---

## Native Helper

```bash
cd native
./run.sh                 # macOS/Linux: buat .venv, pasang dependensi, unduh model, jalankan
run.bat                  # Windows (Command Prompt)
./install-host.sh <EXT_ID>   # daftarkan Native Messaging host (Windows: install-host.bat)
```

Atau dari root repo: `./scripts/start-native.sh`, `./scripts/stop-native.sh`,
`./scripts/restart-native.sh`, `./scripts/ensure-dev-services.sh` (helper + lab, idempoten).

Catatan yang menggigit:

- `run.sh` **tidak** memakai `source .venv/bin/activate` — skrip aktivasi menyimpan path
  absolut dan rusak begitu folder dipindah. Interpreter venv dipanggil langsung, dan venv
  dibuat ulang bila interpreternya hilang.
- Model bawaan `run.sh` adalah bobot **MLX khusus Apple Silicon**; di Linux/Windows
  faster-whisper memakai `large-v3-turbo` (CTranslate2). Jangan menyilangkannya.
- Variabel: `WHISPER_MODEL`, `ENGINE=mlx|faster`, `DEVICE=cpu|cuda`, `COMPUTE=int8|float16`,
  `TRANSLATE=off`, `PORT`, `HOST` (menolak non-loopback kecuali `ALLOW_REMOTE=1`),
  `ALLOWED_ORIGINS`, `STREAM_CHUNK_SEC`, `STREAM_OVERLAP_SEC`, `STREAM_MIN_BYTES`.
- Berkas helper: `~/.localtranssub/{device,engine-mode,ui-prefs,notes}.json`,
  bobot di `~/.cache/huggingface/hub`.

Rincian per OS: [`native/SETUP.md`](../native/SETUP.md).

---

## Aplikasi macOS

```bash
cd mac
./make-signing-cert.sh   # SEKALI: sertifikat penanda tangan lokal
./build-app.sh           # build, tanda tangan, verifikasi, pasang bundel
./doctor.sh              # toolchain, tanda tangan, ikon, izin
open build/yraverageSubMin.app
```

Kenapa sertifikat itu wajib: tanda tangan ad-hoc berubah tiap build, dan macOS
menyimpan izin Screen Recording / Accessibility / Input Monitoring per identitas —
setiap rebuild diam-diam mencabut semua izin. `build-app.sh` menolak membangun tanpa
sertifikat, dan **memverifikasi** hasilnya (identifier `com.yraveragesubmin.app`, ikon
ada, requirement mengandung `certificate leaf`) sebelum menukar bundel.

Tanpa Xcode penuh: macro `@State` tidak tersedia dengan Command Line Tools, jadi
state view memakai `ObservableObject` yang dimiliki `AppController`.

Probe CLI untuk memeriksa perilaku tanpa GUI: `--focus-probe`, `--hotkey-probe`,
`--dictation-probe --expect <bundle-id>` (menolak menempel bila aplikasi target
tidak di depan).

---

## Konvensi repo

- ESM di mana-mana (`"type": "module"`); tes = `node:test` (`npm test`, serial:
  `--test-concurrency=1` karena tes Puppeteer paralel saling mengganggu).
- Teks antarmuka lewat tabel i18n (en/id), bukan literal di markup.
- `HANDOFF.md` = konteks pekerjaan yang belum selesai; `PROJECT-CONTEXT.md` = baseline
  proyek; NgodingPakeAI = status task (`npx ngodingpakeai …`, lihat `AGENTS.md`).
