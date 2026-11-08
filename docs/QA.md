# Panduan QA & tolok ukur lab

Semua bukti kualitas di repo ini dihasilkan alat, bukan klaim. Urutan di bawah adalah
urutan yang dipakai gate rilis.

## Lapisan uji

| Lapisan | Perintah | Cakupan | Waktu |
| --- | --- | --- | --- |
| Unit + browser (Puppeteer) | `npm test` | 220+ tes: skema, ekspor, helper (device/koneksi/streaming/asal), pustaka contoh, learning, permukaan `app.html`, register | ±2 mnt |
| Uji cepat 26 sub-fitur | `npm run smoke` · `npm run smoke:crossos` | kontrak transformers.js, model, ekspor TXT, artefak Windows/Linux (installer, registry, manifest) | ±1 mnt |
| E2E realtime | `npm run e2e` | Chrome for Testing headed + ekstensi termuat: Start → model → subtitel → overlay terinjeksi | ±2 mnt |
| E2E berkas | `npm run e2e:file` | berkas → transkripsi → ekspor SRT/VTT | ±2 mnt |
| E2E lintas OS | `npm run e2e:crossos` | berkas → job engine (streaming) → ekspor → **dibaca ulang ffmpeg** (hanya sebagai pemeriksa) | ±1 mnt |
| Gate rilis | `npm run release:gate` · `npm run release:check` | menyusun `test/RELEASE-GATE.md` dari cacat + bukti | detik |

Penting tentang E2E: skrip memakai **Chrome for Testing** (dipasang Puppeteer).
Google Chrome bermerek ≥137 **mengabaikan `--load-extension` diam-diam**, sehingga
service worker tak pernah muncul dan E2E selalu timeout. Override dengan
`PUPPETEER_EXECUTABLE_PATH` hanya bila Anda tahu binarinya menerima flag itu.

Variabel lain: `NATIVE_URL` (bawaan `http://127.0.0.1:17865`), `LAB_URL`
(bawaan `http://127.0.0.1:8799`), `E2E_HELPER_URL` (untuk `npm run e2e -- --native` di port bebas).

## Tolok ukur lab

| Perintah | Yang diukur | Artefak |
| --- | --- | --- |
| `python3 scripts/bench-lab.py --json test/last-bench.json` | draft `/draft` per jendela 0,35/0,5/1/2 dtk, ASR final, refine, per pasangan bahasa — target draft ≤ 500 ms | `test/last-bench.json` |
| `npm run bench:models:catalog` | katalog model browser vs native (angka browser masih stub sampai diukur di WebGPU) | `test/last-models-bench.json` |
| `npm run bench:bigfile` · `bench:bigfile:upload` | berkas 2,5 GiB: RSS puncak engine, throughput, unggah HTTP >2 GiB (memakai biner engine di port bebas) | `test/last-bigfile-bench.json` |
| `npm run bench:report` | menyusun `test/BENCH-LATEST.md` + `test/BENCH-COMPARE.md` | Markdown |

`bench-lab.py` hanya bicara HTTP ke helper (engine Rust); Python-nya sekadar klien dan butuh numpy serta
ffmpeg untuk mendekode sampel MP3 CC0. Sampel: `test/samples/manifest.json`,
lisensi di `test/samples/ATTRIBUTION.md` (CC0/Public Domain saja).

Hasil terukur terakhir dan catatannya ada di `HANDOFF.md` bagian *Verifikasi*.

## Cacat & keputusan rilis

```bash
npm run defects:gen       # test/last-defects.json dari bukti smoke/e2e/bench
npm run release:gate      # test/RELEASE-GATE.md — CLEAR bila tak ada must-fix terbuka
```

Status cacat: `open` (belum ada bukti), `accepted` (residual terdokumentasi, tidak
menahan unggahan CWS), `fixed` (bukti otomatis lulus). UI: `test/defects.html`.

## Verifikasi manual yang tetap perlu manusia

- Klik-klik di `http://127.0.0.1:8799/app.html` setelah perubahan UI — tes otomatis
  menjaga struktur, mata manusia menjaga rasa.
- `--pick` (pemilih tab/jendela) dan audio sistem macOS bergantung pada dialog OS.
- Skrip Windows (`run.bat`, `install-host.bat`) baru diverifikasi isinya; jalankan
  `smoke:crossos` + `e2e:crossos` di mesin Windows sungguhan sebelum rilis ke pengguna
  Windows.
- Aplikasi macOS: `./doctor.sh` lalu buka aplikasinya sekali agar laporan izin terisi.
