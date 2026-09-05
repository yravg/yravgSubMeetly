# Serah terima proyek

## Identitas dan koordinasi

- Diperbarui: 2026-09-05, Asia/Shanghai.
- Plan: `908756ef-363c-43d5-8a2b-bb7f2037295b` — UI Interaktif & Rilis Menyeluruh.
- Workspace: `08b7acf5-2182-429d-a223-5b94ea703f8b`.
- Repo binding: `f8186cc1-132d-4316-8853-600a60adf935`, provider `local`.
- Binding repo yang ada dipertahankan; jangan `connect` ulang atau pindah workspace.

## Posisi sekarang

**Fase 5/5 selesai kecuali 1 task yang ditunda.** Semua task plan `done`, kecuali panduan
Windows/Linux (`doing` = penanda "lanjut nanti"). `task next` masih mengembalikan task itu;
jangan jalankan final `sync` sampai pengguna memutuskan nasibnya.

**DITUNDA — jangan dikerjakan tanpa diminta:**
`siap-rilis/tulis-panduan-pengguna-windows-dan-linux` (`1c23b894-…`) sengaja
distatuskan `doing` sebagai penanda "dikerjakan nanti". Pengguna meminta semua
pekerjaan Windows ditunda. `task next` akan terus menyodorkannya — **lewati**, ambil
task lain dari `task list`.

Fase 4 layer backend (halaman Dukungan Windows Linux) sudah selesai seluruhnya.

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
20. `PROJECT-CONTEXT.md` dibuat; `guide.html` menampilkan kedua panduan (`?doc=`).

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

- `npm test` → **219/219 lulus** (termasuk sample-library 9, learning 19, register-extras 5).
- `mac/`: `swift build` bersih; `./doctor.sh` ✓ sertifikat/tanda tangan/identifier/ikon (laporan izin butuh aplikasi dibuka).
- `npm run e2e` → PASS (headed, Chrome for Testing). `npm run release:gate` → CLEAR.
- `npm run smoke -- --crossos` → 26/26 Fase 1 + 9/9 lintas-OS.
- `npm run e2e:crossos` → 10/10. `npm run bench:bigfile --upload` → 5/5.
- `npm run build` → bersih. Sapuan seluruh halaman lab: tanpa galat JS, tanpa overflow horizontal.

## Catatan yang perlu diketahui

- Installer Windows, `run.bat`, dan panduan Win/Linux **belum pernah dieksekusi di Windows**.
  Jalankan `npm run smoke:crossos` + `npm run e2e:crossos` di mesin sungguhan sebelum rilis.
- `npm test` mencakup `test/*.test.js` juga. Jangan kembalikan globnya.
- `app.html` satu-satunya permukaan yang diminta pengguna untuk selalu bisa dijalankan
  (`http://127.0.0.1:8799/app.html`). Verifikasi UI lewat sana.
- Sync: `sync --if-changed --plan` (metadata saja). **Jangan** jalankan final `sync` sampai
  seluruh task plan selesai.
