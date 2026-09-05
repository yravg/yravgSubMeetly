# Serah terima proyek

## Identitas dan koordinasi

- Diperbarui: 2026-09-05, Asia/Shanghai.
- Plan: `908756ef-363c-43d5-8a2b-bb7f2037295b` — UI Interaktif & Rilis Menyeluruh.
- Workspace: `08b7acf5-2182-429d-a223-5b94ea703f8b`.
- Repo binding: `f8186cc1-132d-4316-8853-600a60adf935`, provider `local`.
- Binding repo yang ada dipertahankan; jangan `connect` ulang atau pindah workspace.

## Posisi sekarang

**Plan selesai: semua task `done` (`task next` → done: true), gate rilis CLEAR.**
Keputusan pengguna 2026-09-05 (a): E2E `--native` dan `e2e-file --browser` yang gagal konsisten
(`Runtime.callFunctionOn timed out`, renderer panel tak merespons CDP) **diterima sebagai residual CWS**
di `scripts/mark-release-priorities.mjs` (`E2E-e2e-native*`, `E2E-e2e-file*`) dengan alasan yang sama
seperti REL-03/REL-04: helper bukan artefak store, jalur `--browser` opsional. Penyebab renderer tetap
dilacak — langkah diagnosis di bagian Verifikasi. Jangan menghapus `test/last-e2e.json` untuk
"membersihkan" gate.

**Final `sync` NgodingPakeAI** menutup siklus + membangun ulang wiki. Ringkasan ditulis per slice oleh
subagen ke `.ngodingpakeai/summaries.part-*.json` lalu digabung ke `summaries.json` sebelum `sync`.
Statusnya dicatat di bagian Verifikasi (baris "Sync").

**Task Windows/Linux (`1c23b894-…`)** dipindahkan pengguna lewat web UI sehingga layer backend terbuka;
panduannya ada di `docs/USER-GUIDE-WINLINUX.md` (diverifikasi dari isi; belum pernah dieksekusi di Windows).

## Selesai di sesi ini

### Fase 4 — backend (7 task)
1. `run.sh` tidak lagi bergantung pada `.venv/bin/activate` (venv dibuat di path lama).
2. Pemilihan runtime CPU/GPU: `GET`/`POST /engine/device` (klien sudah memanggilnya sejak lama,
   server tak pernah mengimplementasikannya). `test/native-device.test.mjs` 9/9.
3. Status Native Messaging: aksi `ping` + `nativeHostConnection()`; diagnostik kini membedakan
   `forbidden`/`crashed`/`not-installed`. `test/native-connection.test.mjs` 9/9.
4. Transkripsi streaming berkas besar (RAM O(jendela)). `test/native-streaming.test.mjs` 9/9.
5. Helper dibatasi ke loopback — sebelumnya `Access-Control-Allow-Origin: *`.
   `test/native-origin.test.mjs` 7/7.
6. Normalisasi ekspor SRT/VTT/TXT — **VTT tanpa baris kosong sesudah header membuat ffmpeg
   membuang cue pertama, dan dengan `NOTE` membuang seluruhnya** (Chrome memaafkannya).
   Juga: stempel waktu `NaN`, cue tak urut. Dua berkas `test/*.test.js` ternyata tidak pernah
   dijalankan — glob `npm test` kini mencakupnya.
7. Dokumentasi instalasi Win/Linux + `native/run.bat`; ditemukan `run.sh` mengekspor model
   **MLX khusus Apple di semua OS** sehingga faster-whisper tidak bisa memuatnya.
8. QA lintas-OS: `npm run smoke:crossos` (9 pemeriksaan, diuji negatif) + `scripts/e2e-crossos.mjs`.
9. Benchmark >2 GiB: pada berkas 2,5 GiB nyata — 51 jendela, 4,23 jam audio, 12,4 dtk,
   **puncak RSS 108 MB vs 110 MB untuk berkas 17× lebih kecil**. Unggah HTTP 2.684.455.278 byte persis.

### Fase 5 — frontend (5 task)
10. **Materi Chrome Web Store.** Screenshot kini ditangkap dari `app.html` (panel produksi),
    bukan harness lama; skripnya menegaskan lebar, gagal bila ada galat halaman, dan membuang
    tangkapan usang. `store/listing.md` + `SUBMIT.md` diperbarui.
11. **Panduan pengguna ekstensi Chrome** — `docs/USER-GUIDE.md`.
12. **Panduan pengguna macOS** — `docs/USER-GUIDE-MACOS.md`.
    Keduanya dibaca `test/guide.html` (satu sumber, dirender `test/mini-markdown.js`) dan
    tertaut dari menu `app.html`. Rute `/docs` dan `/native` ditambahkan ke lab-server.
13. **Layout Side Panel transkripsi** — diverifikasi lengkap (5 kartu) dan dijaga tes.
14. **Penerima segmen & status transkrip** — diverifikasi: interim → final, tag arah dua arah,
    status pipeline dan galat. Kontrak bidangnya `source`/`translation`, **bukan** `src`/`tgt`.

### Fase 5 — 9 task terakhir (sesi lanjutan, pengguna pergi 2 jam)
Semua ditutup dengan verifikasi perilaku di `app.html`, dijaga `test/app-surfaces.test.mjs` (12 tes):
15. **Overlay subtitel di-host `app.html`** — `test/app.html` memuat `dist/content.js`; mock meneruskan
    `{target:'content'}` dan `chrome.tabs.sendMessage`. Catatan kontrak: final dari offscreen **tanpa**
    bidang `interim`; `interim:false` = sinyal hapus draf (demo `overlay-test.html` lama salah, diperbaiki).
16. **`window.__labMock`** di `chrome-mock.js`: `helper.mode` passthrough/offline/fixture, `latencyMs`,
    `failNext`, log permintaan — membuka pengujian helper mati / fixture tanpa jaringan.
17. Pemilihan Native Helper, status mesin (fixture), indikator cadangan (helper mati → peringatan model),
    prioritas perangkat CPU/CUDA + mode manual (MLX → tombol dikunci).
18. Halaman berkas (unggah → staging chunked OPFS), status & Batalkan (`offline-cancel` terkirim),
    hasil + ekspor TXT/SRT/VTT lewat normalizer (VTT punya baris kosong; SRT diawali cue metadata 1 ms —
    desain lama yang disengaja).
19. **Gate rilis dibuka.** E2E realtime gagal karena `scripts/e2e*.mjs` default ke Google Chrome bermerek,
    yang sejak Chrome 137 mengabaikan `--load-extension` → SW tak pernah muncul → timeout 20 dtk.
    Kini default Chrome for Testing (override `PUPPETEER_EXECUTABLE_PATH`). `npm run e2e` PASS (subtitel
    setelah 90 dtk, overlay terinjeksi). `npm run release:gate` → **CLEAR**.
20. `PROJECT-CONTEXT.md` dibuat; `guide.html` menampilkan ketiga panduan (`?doc=`), termasuk
    `USER-GUIDE-WINLINUX.md`; perender kini mendukung kutipan `>`.

### Permintaan langsung pengguna (di luar plan NgodingPakeAI) — sesi ini
21. **Tipe proyek pada notulen** — `projectType` di `createMeeting` (14 nilai, `PROJECT_TYPES` di
    `notes-schema.js`), pemilih di kartu rekam (`#notes-project-type`), preferensi terakhir
    (`notesProjectType`), diwariskan `startNextMeeting`, tampil di ekspor MD/TXT, register punya
    filter `#pt-filter` + optgroup di `#m-switch` + badge `#m-ptype`.
22. **"End & draft" menghasilkan draf dari baris sesi** — dulu hanya berhenti & buka register; kini
    `draftFromSession` di `notes-panel.js` memakai `generateNotesFromTranscript` (jalur yang sama
    dengan tempel-Teams) dan menggabungkan bendera yang sudah ada.
23. **Pustaka 214 transkrip** (`src/lib/sample-library.js`, generator deterministik, 13 bidang,
    26 seri mingguan = 76%, indeks 29 KB) — diimpor per seri lewat pipeline asli. Tes 9/9.
24. **Training/gamify ala DCS_DocConSystem** — `learning-progress.js` (XP/level 7 tingkat/21
    achievement/pemahaman/rentetan, idempoten per kunci event), `learning-tours.js` (3 tur, target
    `data-tour`), `learning-quiz.js` (5 jenis pertanyaan). UI di `src/minutes-extras.js` (overlay
    Library + Training, tour spotlight), dipasang dari `minutes.js`; XP saat `acceptWithXp` dan
    `doIssue`. Tes: learning 19, `test/register-extras.test.mjs` (Puppeteer) 5.
    Catatan kontrak: `recordQuizAnswer(state, questionId, correct)` memberi XP sendiri —
    jangan dipanggil bersama `awardEvent`.

### Fase 5 — layer backend (23 task, sesi lanjutan)
Dibuka setelah pengguna mengubah status task Windows di web UI. Penutupan per task dan buktinya:

| Task | Bukti |
| --- | --- |
| Kebijakan privasi CWS | `store/PRIVACY.md` ditulis ulang sesuai kode (izin, storage, notulen, learning, retensi, formulir data-usage); `SUBMIT.md` langkah 3 |
| Paket MV3 CWS | `npm run pack:store` (31 MB, 35 berkas); `test/store-package.test.mjs` 4/4 (MV3, versi, tanpa junk, izin ↔ MV3-AUDIT) |
| Uji cepat 26 sub-fitur | `npm run smoke -- --crossos` 26/26 + 9/9 |
| Uji alur penuh lintas platform | `npm run e2e:crossos` 10/10 (ffmpeg membaca ulang ekspor) |
| Tolok ukur lab | `bench-lab.py` diperbaiki (dekode ffmpeg; MP3 CC0 tanpa bidang `text`) — lihat catatan |
| Panduan build / QA / checklist rilis | `docs/DEVELOPMENT.md`, `docs/QA.md`, `docs/RELEASE-CHECKLIST.md` |
| Deteksi ketersediaan mesin; state manager failover; konfigurasi prioritas | `test/engine-tier.test.mjs` 9/9 (engine-tier, device-tier, engine-session dengan fetch distub); settings via `chrome.storage.local` dibuktikan E2E (`e2e-native-engine`) |
| Tangkap audio tab; VAD + transkripsi lokal; kirim hasil & status ke UI; overlay | `npm run e2e` PASS (tabCapture → VAD → Whisper → `subtitle` → overlay terinjeksi); `test/app-surfaces.test.mjs` penerima segmen |
| Terjemahan lokal segmen | `test/translation-utils.test.mjs`, `src/lib/opus.js`, jalur Translator API; smoke MT |
| Native messaging audio/transkrip; protokol stream | `test/native-connection.test.mjs` 9/9 (framing 4-byte nyata), `native-protocol.js` |
| Native host terima chunk; pipeline transkripsi helper; progres & batal | `test/native-streaming.test.mjs` 9/9, `test/native-file-job.test.mjs`, job E2E crossos |
| Terjemahan lokal output di helper | `/translate`, `/draft`, `/translate_refine` (mlx-lm Qwen2.5) — dipakai bench-lab |
| Penyedia inferensi browser WebGPU | `src/lib/asr.js` pickDevice/hasWebGPU; `engine-tier` tes tier WebGPU; E2E berjalan WASM (WebGPU tak tersedia headless) |

**Residual yang jujur:** REL-03 (E2E `--native`) GAGAL hari ini: status "Listening" tercapai tapi `Waiting failed`
<2 menit (timeout 5 menit) — target kemungkinan ter-detach, bukan habis waktu; sisi server bersih
(POST `/transcribe` dengan Origin ekstensi → 200). Diulang dengan keluaran penuh setelah bench.

### Permintaan pengguna terakhir (2026-09-05 malam)
25. **Tab Performance** — `src/lib/perf-log.js` (sampel, p50/p95/RTF, impor bench, laporan), `src/lib/perf-charts.js`
    (SVG murni: bar ≤24px ujung membulat, scatter r=4 + cincin, garis 2px, grid hairline, teks token teks; palet
    `--viz-1..3` divalidasi `dataviz/validate_palette.js` untuk #1e1e1e dan terang), `src/perf-panel.js` (filter,
    KPI, chart/tabel, float/dock, ekspor/impor). Offscreen memancarkan `perf-sample` di 8 titik; background
    menyimpan `perfSamples` (≤3000) dan meneruskannya ke panel. Tes: `test/perf-log.test.mjs` 6, app-surfaces +2.
    Catatan kontrak bench: tahap `draft 0.35s` (spasi), platform dari `health.device`.
26. Kartu Native Helper collapsible (tertutup default, `uiCollapsed`); Install/Troubleshooting collapsible di
    `helper-guide.js` (`ui.open` kunci `sec:install`/`sec:ts`); `#helper-export` dipindah ke `#export-mount` di History
    oleh `mountHelperStatusCard`; default `srcLang` **zh** (sidepanel, interpreter, chrome-mock; tes export-browser
    mengharap `zh-en`).

### Bug UI nyata yang ditemukan lewat app.html dan diperbaiki
- **Modal Pengaturan rusak total.** Satu `</div>` berlebih di `src/sidepanel.html` menutup
  `.modal-card` terlalu awal → `#settings-modal` punya 17 anak langsung; karena `.modal` adalah
  flex-row, 16 baris pengaturan berjajar dan meluber ke x = −701. Terjadi juga di ekstensi
  sungguhan, bukan hanya lab.
- **Tombol lebar app.html berhenti bekerja** setelah panel notulen me-render ulang:
  `transition: max-width` mengunci nilai lama meski `--shell-w` sudah berubah.
- **`export-browser.test.mjs` flaky** — kartu me-render ulang seluruh DOM saat checkbox diklik,
  klik kedua mendarat di simpul yang sudah dilepas.

Ketiganya dijaga `test/app-surfaces.test.mjs`.

## Verifikasi

- **Sync final NgodingPakeAI 2026-09-05** → `234 summarized, 235 sections, 34 unchanged` (run
  `aaeb8108-…`); siklus plan ditutup, wiki dibangun ulang otomatis. Tautan yang dicetak CLI:
  https://www.ngodingpakeai.com/workspace/08b7acf5-2182-429d-a223-5b94ea703f8b?plan=2f0a7eb0-348d-4904-9f14-77c68c89cb5f
- `npm test` → **242/242 lulus** (satu suite Puppeteer flaky hanya saat dijalankan bersamaan dengan beban lain) (termasuk sample-library 9, learning 19, register-extras 5, mini-markdown 11).
- `mac/`: `swift build` bersih; `./doctor.sh` ✓ sertifikat/tanda tangan/identifier/ikon (laporan izin butuh aplikasi dibuka).
- `npm run e2e` → PASS (headed, Chrome for Testing). `npm run release:gate` → CLEAR.
- `npm run smoke -- --crossos` → 26/26 Fase 1 + 9/9 lintas-OS.
- `npm run e2e:crossos` → 10/10. `npm run bench:bigfile --upload` → 5/5.
- **Tolok ukur lab 2026-09-05 22:42** (`bench-lab.py`, mlx-whisper large-v3-turbo, 50 sampel CC0):
  200 panggilan draft, **111/200 ≤ 500 ms (56%)**, min 62 / p50 485 / maks 2349 / rata 599 ms —
  snapshot 22 Agustus (0/16, p50 828) sudah usang. `BENCH-COMPARE.md` baris native: pass.
  Catatan: `bench-lab.py` rusak sejak sampel jadi MP3 (modul `wave` + bidang `text` hilang); diperbaiki
  dengan dekode ffmpeg dan sumber MT dari hasil ASR.
- `npm run e2e:native` → **GAGAL 3×, konsisten.** Status "Listening" tercapai (helper dipakai untuk draft),
  lalu Puppeteer gagal dengan `Runtime.callFunctionOn timed out` (protocolTimeout 180 dtk): **renderer halaman
  side panel berhenti merespons CDP** hanya di mode native — mode browser lulus di jalur yang sama. Yang sudah
  disingkirkan: sisi server (POST `/transcribe` dengan Origin ekstensi → 200, tak ada 403), dialog modal (tidak
  ada `confirm/prompt/alert`), loop gambar-ulang panduan (`onRecheck` hanya dari tombol). Pengukuran lag di
  app.html TIDAK valid — tab latar dithrottle ke 1 tick/dtk di kedua mode. Langkah berikut yang disarankan:
  jalankan E2E native dengan `--headed` + DevTools performance trace pada halaman panel, atau tambahkan
  `PerformanceObserver('longtask')` ke panel saat `?e2e=1`. Sampai itu, REL-03 = residual `accepted`.
- `npm run build` → bersih. Sapuan seluruh halaman lab: tanpa galat JS, tanpa overflow horizontal.

## Catatan yang perlu diketahui

- Paket CWS (`store/releases/local-transsub-1.1.1.zip`, 31 MB / 114 MB tak terkompresi) mengirim
  ONNX Runtime **dua kali**: `ort/` (20 MB) dan `vad/ort/` (5 varian WASM, ~75 MB). Bukan blocker
  rilis, tapi peluang pemangkasan ±60 MB bila VAD dibuat memakai runtime yang sama.
- `store/local-transsub-1.0.0.zip` dan `1.1.0.zip` masih ada di root `store/` — jangan diunggah;
  `SUBMIT.md` sudah memperingatkan. Belum dihapus karena itu artefak rilis.

- Installer Windows, `run.bat`, dan panduan Win/Linux **belum pernah dieksekusi di Windows**.
  Jalankan `npm run smoke:crossos` + `npm run e2e:crossos` di mesin sungguhan sebelum rilis.
- `npm test` mencakup `test/*.test.js` juga. Jangan kembalikan globnya.
- `app.html` satu-satunya permukaan yang diminta pengguna untuk selalu bisa dijalankan
  (`http://127.0.0.1:8799/app.html`). Verifikasi UI lewat sana.
- Sync: `sync --if-changed --plan` (metadata saja). **Jangan** jalankan final `sync` sampai
  seluruh task plan selesai.
