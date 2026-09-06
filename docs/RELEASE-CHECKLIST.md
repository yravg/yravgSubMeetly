# Daftar periksa rilis — Chrome Web Store & macOS

Centang berurutan. Setiap baris menunjuk ke perintah atau berkas yang menjadi buktinya.

## A. Sebelum apa pun

- [ ] Versi dinaikkan **bersama** di `package.json` dan `src/manifest.json`
      (`pack:store` menolak bila berbeda).
- [ ] `CHANGELOG.md`: bagian versi baru berisi perubahan yang benar-benar terkirim.
- [ ] `npm test` hijau; `npm run smoke -- --crossos` hijau.
- [ ] `npm run e2e` **PASS** dan `npm run e2e:crossos` hijau (helper hidup).
- [ ] `npm run release:gate` → **CLEAR**; residual `accepted` dibaca ulang dan masih
      dapat diterima untuk versi ini.
- [ ] Tolok ukur disegarkan: `bench-lab.py` + `npm run bench:report`; angka yang dikutip
      di dokumen sesuai `test/BENCH-LATEST.md`.

## B. Chrome Web Store

- [ ] `npm run build && npm run pack:store:screens` — screenshot 1280×800 ditangkap dari
      `app.html`, skrip gagal bila ada galat halaman.
- [ ] `npm run pack:store` → `store/releases/yraverage-submin-<versi>.zip`;
      `node --test test/store-package.test.mjs` hijau (MV3, versi cocok, tanpa berkas dev).
- [ ] **Jangan** unggah zip versi lama yang masih ada di `store/`.
- [ ] Dashboard: ikuti [`store/SUBMIT.md`](../store/SUBMIT.md) — listing dari
      `listing.md`, formulir *privacy practices* dari bagian *data-usage disclosure* di
      `PRIVACY.md`, URL kebijakan privasi publik (HTTPS), justifikasi izin dari
      `MV3-AUDIT.md` (`<all_urls>` = overlay pada tab yang di-caption saja).
- [ ] Tag git `v<versi>` setelah paket diunggah.

## C. macOS

- [ ] `cd mac && ./make-signing-cert.sh` pernah dijalankan di mesin build (sekali).
- [ ] `./build-app.sh` sukses **dan** verifikasinya lulus (identifier
      `com.localtranssub.app`, ikon, `certificate leaf`).
- [ ] `./doctor.sh` semua ✓; buka aplikasi sekali agar laporan izin terisi, lalu
      `./doctor.sh` lagi.
- [ ] Uji manual: Capture audio sistem → subtitel tampil tanpa mencuri fokus keyboard;
      dikte tahan-untuk-bicara menempel ke aplikasi target; overlay merespons perubahan
      ukuran font / opasitas secara langsung.
- [ ] Panduan pengguna macOS (`docs/USER-GUIDE-MACOS.md`) masih sesuai nama menu/setelan.

## D. Setelah rilis

- [ ] `HANDOFF.md`: posisi terbaru, angka verifikasi, residual yang masih terbuka.
- [ ] NgodingPakeAI: task ditutup; final `sync` hanya bila seluruh task plan selesai
      (menutup siklus dan membangun ulang wiki).
- [ ] Buat entri `## Unreleased` baru di `CHANGELOG.md`.

## Residual yang diketahui (jangan dijanjikan ke pengguna)

Lihat `test/RELEASE-GATE.md`: satu tab per sesi, capture putus saat navigasi, situs DRM
dapat memblokir tabCapture, MKV tidak didekode Chrome, Translator API hanya Chrome 138+,
draft native kadang di atas 500 ms, dan skrip Windows belum dieksekusi di Windows.
