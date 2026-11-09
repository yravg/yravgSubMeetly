# Native Helper — Windows, Linux, macOS

Helper adalah **engine Rust** (`submeetly-engine`, folder `engine-rs/`): satu biner yang
melayani HTTP di `127.0.0.1:17865` dan, bila dijalankan sebagai `native-host`, menjadi host
Native Messaging untuk ekstensi Chrome. Tidak ada Python, pip, atau venv.

## Prasyarat

- Chrome atau Chromium (MV3)
- ID ekstensi dari `chrome://extensions` (Developer mode)
- Biner engine: dari installer **yravgSubMeetly Setup** (sudah menyertakan `submeetly-engine.exe`),
  atau bangun sendiri (Rust stable):

```bash
cargo build --release -p submeetly-engine --manifest-path engine-rs/Cargo.toml
```

ffmpeg **tidak** dibutuhkan: media didekode di dalam engine (symphonia).
Bobot model (Whisper, Qwen untuk terjemahan) diunduh dari Hugging Face saat pertama kali dipakai
(~1,6 GB untuk `large-v3-turbo`); pakai model kecil bila jaringan lambat: `WHISPER_MODEL=base`.

## Menemukan `<EXT_ID>`

Installer host butuh ID ekstensi, karena manifest Native Messaging hanya
mengizinkan ekstensi yang disebut namanya.

1. Buka `chrome://extensions`, nyalakan **Developer mode**.
2. Salin ID 32 huruf di kartu **yravgSubMeetly** (mis. `abcdefghijklmnopabcdefghijklmnop`).

ID berubah setiap kali ekstensi unpacked dimuat dari folder berbeda — jalankan
ulang installer host bila itu terjadi.

## Linux dan macOS

```bash
cd native
./run.sh                        # engine di latar depan (Ctrl+C untuk berhenti)
./install-host.sh <EXT_ID>      # atau ./install-host-linux.sh <EXT_ID>
curl -sf http://127.0.0.1:17865/health | head -c 200
```

`run.sh` dan `install-host.sh` mencari biner lewat `native/engine-path.sh`: `$SUBMEETLY_ENGINE`,
sebelah skrip, lalu `$CARGO_TARGET_DIR/release` dan `engine-rs/target/release`. Argumen kedua
`install-host.sh` menunjuk biner tertentu.

Manifest host ditulis untuk setiap browser yang terpasang:

| Browser | Lokasi manifest |
| --- | --- |
| Chrome | `~/.config/google-chrome/NativeMessagingHosts/com.yraveragesubmin.helper.json` |
| Chromium | `~/.config/chromium/NativeMessagingHosts/…` |
| Microsoft Edge | `~/.config/microsoft-edge/NativeMessagingHosts/…` |
| Chrome (Flatpak) | `~/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts/…` |

Mencabut: `./uninstall-host.sh`.

## Windows

Buka **Command Prompt** di folder `native`:

```bat
run.bat
install-host.bat <EXT_ID>
curl http://127.0.0.1:17865/health
```

`install-host.bat` melakukan dua hal yang khusus Windows:

1. **Menulis manifest** ke `%LOCALAPPDATA%\yraverageSubMin\com.yraveragesubmin.helper.json`.
   Path-nya menunjuk **langsung** ke `submeetly-engine.exe`; Chrome menjalankannya dengan asal
   pemanggil (`chrome-extension://…`) sebagai argumen dan engine masuk mode host.
2. **Mendaftarkan kunci registry** — tanpa ini browser tidak menemukan host:

   - `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.yraveragesubmin.helper`
   - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.yraveragesubmin.helper`
   - `HKCU\Software\Chromium\NativeMessagingHosts\com.yraveragesubmin.helper`

Mencabut: `uninstall-host.bat`.

## Memilih perangkat komputasi

Engine memakai [candle](https://github.com/huggingface/candle):

| OS | Perangkat |
|----|-----------|
| Windows / Linux | CPU. CUDA hanya bila engine dibangun dengan `--features cuda` dan GPU NVIDIA terdeteksi. |
| macOS | CPU (candle). Fitur `metal` ada di `Cargo.toml` (`--features metal`) tetapi **belum diuji** — tidak ada Mac di CI. mlx-whisper tidak lagi dipakai. |

Side Panel → Settings → **Helper compute** → Auto / CPU / GPU menyimpan pilihan lewat
`POST /engine/device {device}` (`GET /engine/device` → `{device, active, compute, cuda_available}`);
berlaku setelah **Restart**. Variabel lingkungan `DEVICE=cpu|cuda` mengalahkan pilihan tersimpan.
Memilih `cuda` tanpa GPU tidak gagal: engine jatuh ke CPU dan menjawab dengan peringatan.

## Memastikan pemasangan berhasil

| Yang diperiksa | Perintah | Diharapkan |
| --- | --- | --- |
| Engine hidup | `curl -s 127.0.0.1:17865/health` | JSON dengan `engine` dan `model` |
| Perangkat | `curl -s 127.0.0.1:17865/engine/device` | `active` = `cpu` atau `cuda` |
| Bridge Native Messaging | Panel samping → **Panduan & diagnostik** | pemeriksaan **host** = OK |

Diagnostik di Side Panel membedakan penyebabnya: *belum terdaftar* (jalankan
installer host), *ditolak* (ID ekstensi tidak ada di `allowed_origins` manifest —
jalankan ulang installer dengan ID yang benar), dan *gagal jalan* (path biner di
dalam manifest salah atau biner dipindah).

Log engine yang dijalankan dari ekstensi ada di `engine.log` di direktori state
(`~/.yraveragesubmin/`, atau `YSM_STATE_DIR`).

## Masalah yang sering muncul

| Gejala | Sebabnya | Perbaikan |
| --- | --- | --- |
| `submeetly-engine not built` | belum ada biner | bangun dengan `cargo build --release -p submeetly-engine`, atau jalankan Setup |
| Engine hidup tapi tombol Start/Stop mati | Host Native Messaging belum terdaftar | jalankan `install-host.*` dengan `<EXT_ID>` dari `chrome://extensions` |
| Start/Stop ditolak sesudah ekstensi dimuat ulang | ID ekstensi berubah | jalankan ulang installer host |
| Biner dipindah/dihapus | manifest masih menunjuk path lama | jalankan ulang installer host |
| Unduhan model tertahan | jaringan memblokir Hugging Face | pakai model lebih kecil, mis. `WHISPER_MODEL=base`, atau set `HF_ENDPOINT` ke mirror |
| Port 17865 dipakai proses lain | engine lama masih jalan | `POST /shutdown`, atau matikan prosesnya lalu jalankan ulang; port lain: `PORT=17866` |

## Memverifikasi lintas OS (QA)

```bash
npm run smoke:crossos          # kesiapan Windows/Linux — jalan di OS mana pun
npm run e2e:crossos:harness    # prasyarat saja (engine, sampel)
npm run e2e:crossos            # penuh: berkas → job engine → ekspor
```

`smoke:crossos` memeriksa artefak yang dipakai pengguna Windows/Linux (peluncur,
installer, kunci registry, manifest, kontrak engine). Tes Rust: `cargo test --release`
di `engine-rs/` (termasuk replay golden dan host Native Messaging nyata).

## Benchmark berkas >2 GiB

```bash
npm run bench:bigfile           # buat berkas 2,5 GiB, ukur memori + throughput
node scripts/bench-bigfile.mjs --file /path/besar.mkv   # pakai berkas sendiri
```

Yang dibuktikan: memori **tidak** ikut membesar bersama berkas — engine membaca PCM per
jendela, jadi puncak RSS ≈ ukuran jendela berapa pun besar berkasnya.

## Ekstensi

Side Panel → Settings → Engine → **Native helper** → Start / Refresh.

Kartu **Native Helper** di Side Panel menampilkan status terhubung + panduan per OS, dan di
bawahnya panel **Panduan pemasangan & pemecahan masalah**: tab Windows / Linux / macOS dengan
langkah + tombol salin perintah, diagnostik dari `/health`, dan daftar gejala → penyebab →
perbaikan. Harness: `test/helper-guide.html` (via lab).

## Berkas besar (>1,5 GiB)

Berkas di atas 1,5 GiB tidak didekode di browser. Mode Offline mengalirkannya ke engine sebagai job:

- `POST /transcribe_file_job?language&task&filename` → `{jobId}` (body distream ke disk)
- `GET /jobs/<id>` → `{status: running|cancelling|cancelled|done|error, progress, segments, error}`
- `POST /jobs/<id>/cancel`

Job yang berkasnya ≥ `STREAM_MIN_BYTES` (bawaan 512 MiB) dibaca per jendela:

- `STREAM_CHUNK_SEC` (bawaan `300`) — panjang jendela.
- `STREAM_OVERLAP_SEC` (bawaan `2`) — konteks lead-in supaya kalimat di batas jendela tidak terpotong.
- `STREAM_MIN_BYTES` — di bawah ambang ini dipakai jalur satu-tembak.

`GET /jobs/<id>` melaporkan `progress` dari durasi media, `segments` sebagian
(`partialSegments`) yang bertambah sambil berjalan, dan `streaming: true`. Batal berlaku di
batas jendela berikutnya. Stempel waktu dijepit ke durasi berkas dan tidak saling bertindih.

## Keamanan: hanya loopback

Engine menyimpan transkrip serta catatan rapat dan bisa dimatikan lewat HTTP, semuanya tanpa
autentikasi. Batas keamanannya adalah "hanya bisa dijangkau dari mesin ini", dijaga tiga lapis:

- **Pengikatan** — menolak menyala (exit 2) bila `HOST` bukan loopback. Set `ALLOW_REMOTE=1`
  hanya kalau memang disengaja.
- **CORS** — hanya asal `chrome-extension://` dan halaman loopback seperti Translation Lab yang
  dipantulkan; situs web biasa dan `Origin: null` mendapat `403`. Pin lebih ketat dengan
  `ALLOWED_ORIGINS=chrome-extension://<EXT_ID>,http://127.0.0.1:8799`.
- **Header `Host`** — permintaan dengan Host bukan loopback ditolak, menahan DNS rebinding.

## Notulen (Fase 2)

API lokal (opsional, saat engine hidup):

- `POST /notes/generate` — body JSON `{ "lines": [{"text":"..."}], "title":"..." }`
- `GET /notes` / `POST /notes` — simpan/ambil notulen di `~/.yraveragesubmin/notes.json`
