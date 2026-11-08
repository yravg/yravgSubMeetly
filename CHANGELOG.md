# Riwayat rilis

## Unreleased — feat/notes-v2
- **Nama tampilan:** yraverageSubMin menjadi **yravgSubMeetly** di ekstensi, helper native, aplikasi macOS, panduan, dan listing toko; wordmark kini yravg + SubMeetly. ID internal (ysm*, ~/.yraveragesubmin, com.yraveragesubmin.helper, bundle id) tidak berubah, tanpa migrasi
- **Engine Rust (`engine-rs/`)** untuk rute non-ML helper: 79 golden direkam dari oracle Python (`scripts/gen-engine-golden.mjs`), replay 0 selisih, kebijakan loopback/Origin, migrasi direktori state, host Native Messaging `ping`; rute ML menjawab 501 sampai port candle (S4). `npm run test:engine-rs`
- **Peta Threadbear → rapat** (`docs/roadmap/threadbear-mapping.md`): fitur dipetakan ke register/island/add-in, lima langkah pertama dengan kriteria terima
- **Rencana besar yravgSubMeetly** (`docs/roadmap/submeetly-next.md`, `docs/handoff/submeetly-next.md`): island ala Oyenza, add-in, engine Rust, de-slop halaman
- **Tab Performance** (child tab Captions): sampel waktu ASR/MT/draft/refine per mesin & bahasa, KPI (p50, RTF), bar/scatter/line SVG murni dengan palet 3 seri tervalidasi CVD, tabel, filter, jendela mengapung yang bisa digeser, ekspor laporan JSON/Markdown + impor laporan/bench untuk membandingkan platform
- Kartu **Native Helper** (beserta Install steps & Troubleshooting) kini terlipat secara bawaan; **Export subtitles** dipindah ke bawah History; bahasa standar **ZH → EN**
- Gate rilis: E2E `--native`/`--browser` yang gagal karena renderer tak merespons CDP diterima sebagai residual CWS (keputusan 2026-09-05), sejalan dengan REL-03/04
- **Notulen:** tipe proyek per rapat (14 nilai) dipilih saat merekam, difilter/dikelompokkan di register, tampil di ekspor; "End & draft" kini menyusun draf dari baris transkrip sesi (sebelumnya hanya berhenti & membuka register)
- **Pustaka contoh:** 214 transkrip deterministik dari 13 bidang, 26 seri mingguan dengan butir yang dibawa ke minggu berikutnya; impor per seri lewat pipeline notulen asli
- **Training & gamifikasi** ala DCS_DocConSystem: XP/level/achievement/rentetan, tur Watch/Practise dengan sorotan, kuis dari rapat aktif — panel Library + Training di Minutes Register
- **Helper:** hanya loopback (CORS ketat, pemeriksaan Host, tolak bind non-loopback), transkripsi streaming berkas >2 GiB (RAM O(jendela)), `GET/POST /engine/device`, aksi `ping` Native Messaging; `run.sh` tak lagi bergantung pada `.venv/bin/activate`
- **Perbaikan nyata:** modal Settings rusak oleh `</div>` berlebih (16 baris terlempar keluar kartu); tombol lebar app.html macet karena `transition: max-width`; VTT tanpa baris kosong sesudah header ditolak ffmpeg; E2E memakai Chrome for Testing (Chrome bermerek ≥137 mengabaikan `--load-extension`); `bench-lab.py` rusak sejak sampel pindah ke MP3 (dekode kini lewat ffmpeg)
- **Rilis:** kebijakan privasi ditulis ulang sesuai kode + formulir data-usage CWS; paket MV3 dijaga `test/store-package.test.mjs`; panduan pengguna (Chrome, macOS, Windows/Linux), `docs/DEVELOPMENT.md`, `docs/QA.md`, `docs/RELEASE-CHECKLIST.md`; tolok ukur draft native 111/200 ≤ 500 ms (p50 485 ms)
- Minutes Register v2: typed register (decision/action/question/risk/metric/note), provenance per item, carry-forward that keeps age, issue/freeze/amend, Markdown/CSV/JSON export
- Register workspace implements the full Minutes Register design canvas: correction banner ("Ben and Coding" → "bending and coating") with apply / keep-as-heard / glossary, metric detail with series curve, standing register across the series with age + consecutive-meeting pills, A4 issued-MoM document with ‡/↩ markers and Print/PDF, keyboard j/k/a/o/d
- Side-panel Notes tab is a "Captured so far" ticker; the table lives in the full-tab register
- Interpreter mode chooser (Teams-style): consecutive two-way (a ⇄ b, direction detected per utterance) alongside the existing simultaneous one-way path, with an entry pill under Task Mode and a card modal
- Two-way mode lists BOTH translation directions in the model warning, each with its own Download button
- `src/lib/lang-detect.js` — offline script + stop-word heuristic (no models, no network) picks which of the two conversation languages was spoken; captions carry a `ZH → EN` direction tag

## 1.1.1 — 2026-09-03
- CC0/Public Domain spoken QA samples (3+ per Opus-MT source language, 10–30s) + attribution
- Easy sample test: Offline sample picker and Settings → MT pair → Test (lab / app.html)
- UI language toggle expanded to all Opus-MT source languages
- Realtime lab mock tab loops the CC0 speech.wav demo clip (removed personal YouTube example)

## 1.1.0 — 2026-09-03
- Chrome Web Store package: on-device captions, notes stub, helper status, store listing/privacy/MV3 audit
- Honest privacy copy: local inference after user-triggered model downloads (no yraverageSubMin cloud API)
- Release QA: smoke, E2E harness, e2e-file, release gate with documented CWS residuals (native/--pick)
- Win/Linux helper installers + SETUP.md; Studio offline harness; pack:store dual zip paths

## 1.0.0
- Rilis awal subtitel lokal + native helper + app macOS
