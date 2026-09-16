# Serah terima proyek

## Identitas dan koordinasi

- Diperbarui: 2026-09-05, Asia/Shanghai.
- Plan: `908756ef-363c-43d5-8a2b-bb7f2037295b` — UI Interaktif & Rilis Menyeluruh.
- Workspace: `08b7acf5-2182-429d-a223-5b94ea703f8b`.
- Repo binding: `f8186cc1-132d-4316-8853-600a60adf935`, provider `local`.
- Binding repo yang ada dipertahankan; jangan `connect` ulang atau pindah workspace.

## Posisi sekarang

**Plan NgodingPakeAI selesai** (semua task `done`), **gate rilis CLEAR**, dan final `sync`
sudah dijalankan (234 ringkasan, wiki dibangun ulang).

**Peringatan yang masih berlaku:** `dist/` pernah menjadi satu-satunya tempat fitur dock
hidup. Sumbernya kini ada di `src/` (lihat butir 27), jadi `npm run build` aman. Kalau kelak
menemukan fitur yang hanya ada di `dist/`, jangan build sebelum sumbernya dipulihkan —
build menyalin `src/` menimpa `dist/`.

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

### Animasi dok tampilan (2026-09-06, permintaan pengguna)
27. **Cincin tunggu menggantikan spinner.** Hover di tombol dok mini mengisi lingkaran SVG
    (`.viewdock-arm`, `stroke-dashoffset` 125,7 → 0) sampai penuh lalu dok membuka, jadi sisa
    waktunya terlihat. Durasi animasi dan timer memakai angka yang sama: JS memasang
    `--dock-arm-ms` di elemen dok, CSS membacanya.
28. **Buka/tutup dianimasikan dan berarah.** Menutup menyapu **kanan → kiri** menuju ikon,
    membuka **kiri → kanan**; sapuannya `clip-path` (bukan `scale`) supaya teks tidak gepeng.
    Setelah mengecil, outline hijau menelusuri keliling ikon sekali — dicerminkan
    (`rotate(-90deg) scaleX(-1)`) agar arah tempuhnya ikut kanan → kiri.
29. **Bisa diatur di panel Pengaturan (gigi kanan atas):** lama hover (Off/1s/**1,5s**/2s/3s,
    `dockArmMs`), gaya animasi (**Wipe**/Slide/Fade/Scale, `dockAnim` → atribut `data-anim`),
    dan kecepatan (Slow 1,6× / **Normal** / Fast 0,6× → `dockSpeed`, memasang `--dock-out-ms`
    dan `--dock-in-ms` yang juga dipakai `setTimeout`). Semua tersimpan di `ltsMinutesLayout`.
    `.settings-pop .seg2` kini membagi lebar rata (Density ikut rapi).
    Dijaga `test/dock-motion.test.mjs` (7 tes, Puppeteer di `dist/minutes.html`).
    Catatan: dok hidup di dalam `#workspace` yang **tersembunyi saat register kosong** —
    tes apa pun harus mengisi register dulu, kalau tidak `#dock-mini` berukuran 0×0.
30. **Panel Pengaturan terpotong di layar pendek.** Setelah tiga baris baru tingginya 803 px
    dengan `top: 38px` tetap, jadi di jendela lebih pendek dari ~860 px baris terakhir
    (kecepatan animasi, Reset layout) jatuh di luar layar dan **tidak bisa diklik sama sekali**.
    `.settings-pop` kini `max-height: calc(100vh - 58px)` + `overflow-y: auto`
    (`overscroll-behavior: contain`, scrollbar tipis). Dijaga tes pada tinggi 950/800/700/650:
    panel harus muat dan `#btn-layout-reset` harus lolos `elementFromPoint` setelah digulir.
31. **Meluber mendatar di bawah ~1070 px (lama, akhirnya diperbaiki).** Penyebabnya khusus appbar —
    isi halaman sendiri sudah muat; `scrollWidth` mentok 1070 karena deretan tombol toolbar tidak
    pernah menyusut. Akibatnya seluruh halaman menggulir mendatar dan popover yang ditambatkan
    `right: 0` (termasuk panel Pengaturan) jatuh di luar jendela. Pelipatan bertahap:
    ≤1100 px label tombol `.collapsible` (Add item, Export, Amend, Library, Training) dilipat jadi
    ikon; ≤880 px label pil On-device hilang dan `.mswitch` dibatasi 130 px; ≤720 px nama brand,
    label Issue MoM dan `#learn-pill` ikut disembunyikan. Dok dibatasi `max-width: calc(100vw - 16px)`
    dan **hanya `#tabs`** yang diberi `overflow-x` — bagian lain dok memuat popover yang akan
    terpotong kalau ikut jadi kontainer gulir.
    `paintStaticStrings()` kini juga menerapkan `data-t-title` (atribut itu sudah lama ada di markup
    tapi tidak pernah dipasang), supaya tombol yang tinggal ikon tetap punya tooltip yang diterjemahkan.
    Terukur bersih 1400 → 520 px; tes menjaga 1400/1100/1000/900/800/700/640.
32. **Wordmark dan jalan pulang di appbar (2026-09-07).** Ikon generik + teks "yraverageSubMin"
    diganti wordmark **yraverageSubMin**, memakai markup dan geometri yang sama dengan panel sisi
    (`.brand-word` + `.brand-pill`, lekuk kiri dari mask lingkaran) tapi dengan token minutes.css;
    di bawah 720 px hanya pilnya yang tersisa, dan mask dilepas supaya tetap terbaca sebagai kapsul.
    Remah **"Minutes" kini tautan ke halaman utama.** Perhatikan: `#crumbs` **ditimpa seluruhnya**
    tiap render rapat (dulu `$('#crumbs').innerHTML = …`), jadi tautannya akan hilang begitu ada
    rapat aktif — sekarang hanya `#crumb-trail` yang ditulis ulang dan `#crumb-home` bertahan.
    Media query ≤1100 px juga diubah: yang disembunyikan `#crumb-trail`, bukan `.crumbs`, supaya
    jalan pulang tetap ada di layar sempit. Tujuannya ditentukan saat boot — `/app.html` di lab,
    `sidepanel.html` saat `location.protocol === 'chrome-extension:'` karena **app.html tidak ikut
    dipaket** (`dist/` hanya berisi minutes/offscreen/sidepanel).
33. **Popover appbar tercetak di bawah halaman pada tema Coretax.** `html[data-theme="coretax"] .appbar`
    memakai `backdrop-filter`, dan itu **membuat stacking context**; `z-index: 60` pada `#settings-pop`
    dan `#export-menu` karena itu hanya berlaku *di dalam* appbar, yang sendirinya `position: static`
    tanpa z-index — seluruh popover jatuh ke belakang konten. Tema gelap lolos hanya karena
    `--glass-blur` di sana kosong, jadi bugnya tergantung tema. `.appbar` kini `position: relative;
    z-index: 55` — eksplisit di atas dok (45) dan toast (50), di bawah `.lt-overlay` (60) supaya
    overlay Library/Training tetap menutupi appbar. Tes menguji kedua tema untuk `#settings-pop`,
    `#export-menu`, dan urutan overlay; sudah diperiksa **gagal** kalau z-index-nya dilepas.

### Penyebab flaky `export-browser` akhirnya ketemu (2026-09-06)
Bukan beban mesin. Toast umpan balik (`.toast-stack`, fixed, bawah-tengah) memberi
`pointer-events: auto` pada **seluruh badan toast**, sehingga toast dari toggle pertama
menutupi checkbox opsi kedua: klik `bom` mendarat di `BUTTON.toast-close`. Diagnosis:
`elementFromPoint` pada titik klik saat waitForFunction habis waktu. Perbaikan di
`src/sidepanel.css` — badan toast `pointer-events: none`, hanya `.toast-close` yang `auto`.
Ini bug produk nyata: pengguna yang menyalakan dua opsi beruntun kehilangan klik kedua.
Setelah itu suite lulus 3/3 berturut-turut dalam ~2,5 dtk (dulu 5–32 dtk).

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

### Pemulihan dock workspace Minutes (permintaan pengguna)
27. **Dock hanya ada di build lama.** `id="viewdock"` tidak pernah ter-commit di
    `src/minutes.html` (dibuktikan `git log -S` di semua cabang), `minutes.js` tak pernah
    memanggil `mountDock()`, CSS-nya nihil, dan `src/minutes-dock.js` menganggur tanpa pemakai.
    Dipulihkan dari build yang menyimpannya (esbuild menyalin apa adanya): HTML 164→320 baris,
    CSS 672→913 baris, 102 kunci i18n per bahasa, pemasangan `mountDock()`, dan `state.tgt`
    (popover terjemahan membacanya lalu melempar `undefined.toUpperCase`).
28. **Klik diam melepas dock dari tepinya.** Menekan tombol minimize memulai gestur `dockmove`;
    `endGesture` selalu menulis posisi baru, dan tanpa gerakan tidak ada snap-hint sehingga
    jatuh ke `'free'` di koordinat basi — dock mengambang di tengah konten. Kini posisi hanya
    berubah pada seretan nyata (ambang 6 px).
29. **`$('.main')` null di kerangka workspace** (kelas itu milik tata letak toolbar lama),
    membuat `paint()` melempar di tengah render dan membatalkan sisa halaman. Kini jatuh ke
    `#center`. Referensi panel dock juga dibuat lazy + tahan-null: lapisan tata letak tidak
    boleh sanggup menggagalkan render register.
30. **`scripts/lab-server.py`: `request_queue_size` 5 → 128.** Modul ES tanpa bundel membuat satu
    halaman meminta puluhan berkas serentak; koneksi di luar backlog di-reset
    (`ERR_CONNECTION_RESET`), satu modul gagal dimuat, dan halaman diam-diam kosong tanpa galat
    jelas. Ini juga menyembuhkan flakiness tes yang sudah lama ada.
31. **Baru:** hover 2 detik pada dock ter-minimize membukanya sendiri, dengan cincin penanda
    hitungan. Sentuh dilewati (tidak punya hover); meninggalkan tombol membatalkan.

## Verifikasi

- **Sync final NgodingPakeAI 2026-09-05** → `234 summarized, 235 sections, 34 unchanged` (run
  `aaeb8108-…`); siklus plan ditutup, wiki dibangun ulang otomatis. Tautan yang dicetak CLI:
  https://www.ngodingpakeai.com/workspace/08b7acf5-2182-429d-a223-5b94ea703f8b?plan=2f0a7eb0-348d-4904-9f14-77c68c89cb5f
- `npm test` → **306/306 lulus** (2026-09-16, kerangka Meetily Tahap 1; lihat catatan `export-browser`)
- (2026-09-12) 306/306, termasuk `shared-register` 12 yang baru (3 di antaranya menjalankan binari macOS).
- (2026-09-07) 294/294 dengan `rename-migration` 8 dan `design-tokens` 6. Ini run penuh pertama
  tanpa kegagalan: flaky `export-browser` yang lama tercatat ternyata bug toast (lihat di atas), bukan beban mesin.
- (sebelumnya) 241/242 dan 242/242 dengan `export-browser` flaky.
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

## Rename ke yraverageSubMin (2026-09-07)

Dua tahap. **Tahap 1** hanya nama tampilan (`89f83fc`). **Tahap 2** pengenal internal,
masing-masing dengan migrasi — inilah bagian yang perlu diingat:

| Pengenal | Lama → baru | Migrasi |
| --- | --- | --- |
| Kunci localStorage | `lts*` → `ysm*` | `src/lib/legacy-keys.js`, dipanggil di awal `minutes.js` **sebelum** konstanta membacanya. Nilai baru selalu menang; kunci lama dibuang. |
| Direktori state helper | `~/.localtranssub` → `~/.yraveragesubmin` | `_migrate_state_dir()` di `native/server.py`, jalan saat impor sebelum dependensi berat. `rename()`, mundur ke salin per berkas kalau beda volume. **Berisi notulen pengguna.** |
| Basis data IndexedDB | `local-transsub` → `yraverage-submin` | `migrateLegacyDb()` di `src/lib/export.js`; memindahkan handle direktori ekspor (izin folder yang tak bisa dibuat ulang kode). Memakai `indexedDB.databases()` supaya tidak malah membuat DB lama. |
| Host Native Messaging | `com.localtranssub.helper` → `com.yraveragesubmin.helper` | `src/lib/native-host.js` mencoba nama baru lalu mundur ke `LEGACY_NATIVE_HOST_NAME` **hanya** saat galatnya `not-installed`. `forbidden`/`crashed`/`timeout` dilempar apa adanya — mencoba nama lain di situ cuma menutupi galat sebenarnya. Installer membuang manifest lama setelah menulis yang baru. |
| Bundle id macOS | `com.localtranssub.app` → `com.yraveragesubmin.app` | **Tidak ada migrasi yang mungkin.** macOS menganggapnya aplikasi baru: izin mikrofon dan perekaman layar harus diberikan ulang. |
| Target Swift | `LocalTransSub`/`TransSubKit` → `yraverageSubMin`/`SubMinKit` | Direktori sumber ikut di-`git mv`; `swift build` bersih. |

`src/lib/native-host.js` adalah **satu-satunya** tempat `com.localtranssub` masih boleh muncul.
Dijaga `test/rename-migration.test.mjs` (8 tes), termasuk tes yang gagal kalau ada kunci
`lts*` baru diperkenalkan tanpa masuk peta migrasi.

## Design system: token bersama (2026-09-07)

`src/tokens.css` kini satu-satunya tempat skala jarak, tipografi, radius, gerak, dan
**tangga lapisan** didefinisikan. Warna sengaja tidak ikut: tiap permukaan punya temanya
sendiri. 39 definisi dipindah keluar dari `:root` `sidepanel.css`; 434 nilai literal di
tiga berkas CSS diganti token.

Yang perlu diingat:

- **`tokens.css` harus dimuat setiap halaman yang memuat stylesheet permukaan.** Kalau
  tidak, seluruh `var()` gagal **tanpa galat**: teks balik ke 16px, padding hilang. Ini
  sempat terjadi pada tujuh halaman harness di `test/`. Dijaga tes.
- **Tangga lapisan `--z-*`** menggantikan 25 angka mentah. Nilainya persis seperti
  sebelumnya — yang baru hanya namanya. Dua rung (40, 60) sengaja ditempati dua nama.
- **Penimpaan per permukaan diizinkan, tapi wajib berkomentar**: `minutes.css` menimpa
  `--radius-lg` (14px, bukan 12px) dan `sidepanel.css` menimpa `--z-sticky` (20, bukan 3
  — header lengketnya melekat ke seluruh area gulir, bukan di dalam kartu). Tes menolak
  penimpaan tanpa komentar.
- **Konversi literal → token tidak selalu aman.** `sidepanel.css` mendefinisikan ulang
  `--text-*` di media query compact dan `--radius-lg/xl` per reskin, jadi mengganti
  `12px` literal dengan `var(--text-sm)` di situ membuat nilainya ikut berubah responsif.
  Yang dikonversi hanya nilai yang resolusinya identik.
- Penamaan: `.iconbtn` → `.icon-btn`; `--ease-std` → `--ease-sharp`; `--ease-emph` →
  `--ease-emphasized`. Ketiga kurva easing **tidak** disatukan — nilainya memang berbeda,
  dan menyatukannya mengubah rasa animasi.
- Bukti tanpa regresi: gaya terhitung 13 properti pada 142 kelompok elemen di
  `minutes.html` dan `app.html`, dibandingkan dengan commit sebelum refactor → **0 beda**.

Dijaga `test/design-tokens.test.mjs` (6 tes).

## Register notulen di aplikasi macOS (2026-09-12)

Aplikasi macOS dulu hanya menampilkan judul dokumen bersama dan dua angka
("N keputusan · M tindak lanjut"). Sekarang ia menampilkan register penuh.

**Bug yang ditemukan lebih dulu, dan sudah diperbaiki:** `HelperSharedNotes.swift`
masih menunjuk `~/.localtranssub/notes.json` — jalur SEBELUM rename. Helper sudah
memindahkan direktorinya, jadi aplikasi macOS membaca berkas yang tidak ada lagi dan
notulen pengguna tampak hilang. Konsumen ini terlewat saat rename; sekarang ia membaca
jalur baru dan **mundur ke jalur lama** bila yang baru belum ada (pengguna bisa membuka
aplikasi sebelum helper pernah dijalankan).

Rantainya: Minutes Register → `meetingToDoc` → `POST /notes` → `_normalize_note_doc` →
`~/.yraveragesubmin/notes.json` → `HelperSharedNotes.swift` → `SharedRegisterView`.

| Lapisan | Perubahan |
| --- | --- |
| `src/lib/notes-sync.js` | Dokumen bersama naik ke **v2**: `items[]` (keenam tipe, `ref`, `topic`, `owner`/`org`, `due`, `status`, `priority`×`likelihood`, `review`, `confidence`, `tc`, `speaker`, `carriedFrom`, `metric`) + `meeting{}` (seri, seq, tipe proyek, ketua, peserta, cakupan agenda, stempel mesin). |
| `native/server.py` | `_normalize_items` / `_normalize_meeting_meta` memvalidasi dan membatasi (≤500 butir, tipe/status tak dikenal jatuh ke default, metrik tanpa nilai numerik dibuang). |
| `mac/…/HelperSharedNotes.swift` | Model v2 + `register` yang **menyusun ulang** butir dari `decisions`/`actions` untuk dokumen v1. |
| `mac/…/SharedRegisterView.swift` | Panel detail: kepala rapat, progres agenda, filter per tipe (hanya tipe yang berisi), baris butir dengan ref berwarna, pemilik, tenggat, status, jejak waktu, matriks risiko, metrik, penanda perlu-dicek. |
| `mac/…/RegisterProbe.swift` | `--register-probe` mencetak apa yang akan dirender sebagai JSON. |

Yang perlu diingat:

- **`decisions`/`actions` v1 SENGAJA tetap ditulis** walau `items` sudah memuatnya.
  Dokumen ini tinggal di disk pengguna; build macOS lama bisa membacanya kapan saja
  setelah build baru menulisnya. Dijaga tes.
- **Ambang `needsReview` ditegakkan di helper**, bukan dipercaya dari pengirim. Helper
  adalah satu-satunya titik yang dilewati semua penulis; kalau ambangnya hanya dihitung
  di sisi ekstensi, dokumen dari sumber lain lolos tanpa tanda meski keyakinannya rendah.
- **`homeDirectoryForCurrentUser` DAN `NSHomeDirectory()` sama-sama mengabaikan `$HOME`**
  (keduanya membaca catatan akun). `HelperSharedStore.homeDir` karena itu mendahulukan
  `$HOME` — launchd memasangnya ke home yang sama saat aplikasi dibuka dari Finder, jadi
  produksi tidak berubah, tapi jalurnya bisa diarahkan dari shell dan tes.
- **`YSM_STATE_DIR` kini dihormati sisi macOS juga**, sama seperti `native/server.py`.
  Sebelumnya pengguna yang memindahkan direktori state-nya kehilangan notulen di aplikasi ini saja.
- Dekoder Swift sengaja toleran (`try?` di setiap field), jadi field yang diganti nama
  **tidak melempar galat** — ia diam-diam menjadi kosong. `test/shared-register.test.mjs`
  memaku nama fieldnya dan menjalankan `--register-probe` pada binari yang benar-benar
  dibangun (dilewati bila `swift build` belum pernah dijalankan).
- `docs/NOTES-V2-SPEC.md` sengaja tidak diubah: itu analisis bertanggal, bukan dokumentasi
  perilaku sekarang; jalur lama di sana adalah keadaan saat analisisnya ditulis.

**Diverifikasi dengan mata (2026-09-12).** Aplikasi dijalankan dari binari debug dengan
`YSM_STATE_DIR` menunjuk direktori contoh, lalu jendelanya dipotret `screencapture -l <windowid>`.
Melihat rendernya menemukan tiga hal yang **tidak terlihat dari probe maupun tes**:

1. **Wordmark masih "yraverage·Sub"** — pil di `Brand.swift` tertinggal saat rename, padahal
   `accessibilityLabel`-nya sudah "yraverageSubMin". Kini "SubMin".
2. **Baris filter meluber** di lebar jendela ±520 px: label "Tindak lanjut" membungkus jadi dua
   baris. Kini `ScrollView(.horizontal)` dengan chip `lineLimit(1)` + `fixedSize`.
3. **Nama pemilik tercetak dua kali** ("Alya Rahman · PMO · Selesai · Alya Rahman") karena
   `src.speaker` sering orang yang sama dengan `owner`. Pembicara kini dilewati bila sama.

Tab bukan state yang tersimpan, jadi panel Notes hanya bisa dicapai dengan mengklik. Ditambahkan
flag `--tab live|file|notes` supaya tangkapan layar QA bisa dilakukan tanpa kontrol layar penuh.

**Build bundel `.app` diblokir: tidak ada sertifikat penanda tangan** di keychain mesin ini
(`security find-identity -v` → 0 identities). `build-app.sh` sengaja menolak build ad-hoc karena
identitasnya berubah tiap rebuild sehingga macOS diam-diam mencabut Screen Recording. Perbaiki
sekali dengan `cd mac && ./make-signing-cert.sh`. Untuk memeriksa UI notulen sertifikat tidak
diperlukan — jalankan binari debug langsung.

**Bundel `.app` di disk masih bernama lama.** `mac/build/yraverageSub.app` adalah artefak
sebelum rename; sumbernya sudah `APP_NAME="yraverageSubMin"`. Jalankan `cd mac && ./build-app.sh`
untuk menghasilkan bundel bernama baru (skrip itu mem-*pkill* instans yang sedang jalan).

## Upgrade ala Meetily — Tahap 1: kerangka (2026-09-16)

Keputusan pengguna (AskUserQuestion): **struktur Meetily, brand kita** (teal menggantikan biru
sebagai satu-satunya warna interaktif; merah/oranye/hijau status tetap) · **sidebar rapat dari
register bersama + tulis balik ke helper** (Tahap 2) · **dokumentasi lewat generator**
(Docusaurus/Mintlify, Tahap 4). Sumber desain: `Meetily Design System.zip` (dibangun dari sumber
Meetily 0.4.1) — diekstrak ke scratchpad sesi; token diterjemahkan ke `DesignTokens.swift`.

Berkas baru di `mac/Sources/yraverageSubMin/`: `DesignTokens.swift` (warna dinamis terang/gelap,
radius 8/6/4, shadow 2 tingkat, gerak 150/200/300, `DSButtonStyle`, `DSCallout`, `DSStatusDot`),
`AppShellView.swift` (akar jendela: sidebar + konten + bilah status; `SettingsPage`, `AboutSheet`),
`SidebarView.swift` (256/64 px, pencarian dengan baris "Match:", daftar rapat dari
`HelperSharedStore`, kaki Start Recording/Settings/About), `RecordingPill.swift` (pil mengambang +
`RecordingStatusBar` `Recording • MM:SS`), `HomeView.swift` (subtitel langsung: toolbar Copy/Export/
Source/Language popover, callout izin, `ReadingColumn` 750 px, `TranscriptSegmentView`),
`FilesView.swift`, `MeetingView.swift` (kepala + register tertanam + `SharedNoteExport` TXT/MD).
**Dihapus:** `MainView.swift` (pemilih tab bersegmen) dan data contoh `MeetingNotesStub` di
`NotesView.swift` — sidebar hanya menampilkan rapat yang benar-benar ada.

Pemetaan fitur lama → baru (tidak ada yang hilang):
- LiveView: Source/Refresh → popover "Capture source"; Spoken/Translate/Into/dual-line → popover
  "Languages"; Start/Stop → pil + tombol sidebar + ⌘⇧S menu bar; Export → toolbar; catatan
  terjemahan + Install fast model → callout info; galat → callout warning; transkrip → kolom baca.
- NSToolbar Start/Stop + status di `MainWindow` **dibuang** (kendali kini selalu terlihat di sidebar
  dan pil); jendela 1100×720 (min 900×600), `fullSizeContentView`, bilah judul transparan.
- `UIState.tab` tetap ada sebagai jembatan (`--tab live|home|file|files|notes|meeting|settings`);
  rute sebenarnya `AppRoute`. Prefs baru: `sidebarCollapsed`, `transcriptPaneRatio`, `onboardingDone`.
- Tambah keputusan/tindak lanjut & ringkasan otomatis (dulu hanya di data contoh) **kembali di Tahap 2**
  pada data sungguhan bersama jalur tulis; ekspor sudah bekerja pada dokumen bersama.

Yang perlu diingat:
- `@State` tetap tak tersedia (build CLT) — semua state di `UIState`/`NotesViewState`; animasi
  (denyut titik, batang aktivitas, jam) memakai `TimelineView`, bukan state.
- Batang meter di pil **bukan level audio** — Meetily pun mengacaknya tiap 300 ms; dinamai
  "indikator aktivitas". Tidak ada tombol jeda karena sesi tidak punya keadaan jeda.
- Tangkapan layar QA: jalankan binari debug dengan `YSM_STATE_DIR=<fixture> --tab <rute>`;
  `-NSRequiresAquaSystemAppearance YES` memaksa mode terang; `-sidebarCollapsed YES` (argumen
  NSArgumentDomain) memaksa rail terlipat. **Matikan instans lama dulu** (`pkill -f
  Products/Debug/yraverageSubMin`) — satu tangkapan sempat tertukar dengan proses sesi sebelumnya.
- Popover "Capture source" **sekali** terlihat terbuka sendiri saat peluncuran; tidak terulang pada
  tiga titik waktu dan peluncuran baru. Belum dijelaskan.
- `export-browser` gagal sekali (batas 32 dtk) saat suite berjalan bersamaan dengan build Swift +
  peluncuran aplikasi; 3/3 lulus ~2,6 dtk saat sendirian. Beban mesin, bukan regresi.

## Upgrade ala Meetily — Tahap 2: workspace rapat + jalur tulis (2026-09-16)

- **Dokumen bersama membawa `transcript[]`** (`{t0,t1,source,translation}`, ≤3000 baris,
  `_normalize_transcript` di helper). Dokumen dari ekstensi tidak punya → kosong, bukan galat.
- **`HelperClient.swift`** — POST/DELETE `/notes`, POST `/notes/generate` (heuristik helper yang
  sudah ada). Hanya `Data` yang menyeberangi batas actor: `[String: Any]` **tidak Sendable** di
  Swift 6 dan build gagal dengan "sending 'json' risks causing data races" — serialisasi di
  `AppController`, klien menerima/mengembalikan `Data`.
- **`HelperSharedStore.upsertLocally/removeLocally`** — cadangan saat helper mati; aturan sama
  dengan helper (ganti per id, sisip depan, ≤50); dokumen lain disalin sebagai dict mentah supaya
  field yang tak dikenal Swift tidak hilang. `SharedNoteDoc.json`/`SharedNoteItem.json` adalah
  encoder-nya; `items` selalu diisi dari `register`, jadi dokumen v1 yang disunting naik ke v2.
- **Stop → rapat tersimpan** (`AppController.finishMeeting`): id `MOM-MAC-<epoch>`, transkrip
  dari `session.lines`, draf summary/decisions/actions dari `/notes/generate` bila helper hidup,
  lalu rute pindah ke rapat itu. Sesi tanpa baris tidak membuat rapat.
- **Mutasi**: `renameMeeting`, `deleteMeeting`, `addItem`, `setItemStatus`, `removeItem`,
  `generateNotes` (butir draf AI diberi confidence 0,6 → helper menandai "perlu dicek").
- **UI**: `MeetingView` = split transkrip | register (rasio 0,30–0,50 lewat `DragGesture` di
  `coordinateSpace("split")`, tersimpan `Prefs.transcriptPaneRatio`); toolbar register: Generate
  notes (`.dsAI`), + Decision/Action/More; menu konteks butir (Mark done/Reopen, Delete) lewat
  callback opsional `SharedRegisterView(onToggle:onDelete:)`; sidebar: menu konteks Rename…/Delete…;
  `RenameSheet` + alert hapus dengan kalimat akibat.
- **Probe**: `--register-probe --upsert <json>` / `--remove <id>` menjalankan jalur tulis cadangan;
  `transcriptLines` ikut dilaporkan. Tes `shared-register` kini 15.
- Bundel `mac/build/yraverageSubMin.app` **sudah bisa dibangun**: `make-signing-cert.sh` dijalankan
  (sertifikat self-signed "yraverageSubMin Dev" di keychain login); bundel lama `yraverageSub.app`
  dihapus.

Sisa tahap: **2** workspace split + tulis balik `POST /notes` · **3** onboarding 4 langkah + Settings
tab bergaris-bawah (Capture · Subtitles & Overlay · Dictation · Languages & Permissions · General)
· **4** dokumentasi.

## Catatan yang perlu diketahui

- Paket CWS (`store/releases/yraverage-submin-1.1.1.zip`, 31 MB / 114 MB tak terkompresi) mengirim
  ONNX Runtime **dua kali**: `ort/` (20 MB) dan `vad/ort/` (5 varian WASM, ~75 MB). Bukan blocker
  rilis, tapi peluang pemangkasan ±60 MB bila VAD dibuat memakai runtime yang sama.
- `store/yraverage-submin-1.0.0.zip` dan `1.1.0.zip` masih ada di root `store/` — jangan diunggah;
  `SUBMIT.md` sudah memperingatkan. Belum dihapus karena itu artefak rilis.

- Installer Windows, `run.bat`, dan panduan Win/Linux **belum pernah dieksekusi di Windows**.
  Jalankan `npm run smoke:crossos` + `npm run e2e:crossos` di mesin sungguhan sebelum rilis.
- `npm test` mencakup `test/*.test.js` juga. Jangan kembalikan globnya.
- `app.html` satu-satunya permukaan yang diminta pengguna untuk selalu bisa dijalankan
  (`http://127.0.0.1:8799/app.html`). Verifikasi UI lewat sana.
- Sync: `sync --if-changed --plan` (metadata saja). **Jangan** jalankan final `sync` sampai
  seluruh task plan selesai.
