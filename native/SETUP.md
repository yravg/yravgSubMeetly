# Native Helper — Windows, Linux, macOS

Panduan pemasangan agar ekstensi Chrome bisa memakai mesin ASR/MT lokal di `127.0.0.1:17865`.

## Prasyarat

- Python 3.10+
- Chrome atau Chromium (MV3)
- ID ekstensi dari `chrome://extensions` (Developer mode)

## macOS

```bash
cd native
./run.sh                 # mlx-whisper di Apple Silicon; fallback faster-whisper
./install-host.sh <EXT_ID>
```

Engine default: **mlx-whisper**. Opsional LLM terjemahan: `mlx-lm` (Qwen).

## Menemukan `<EXT_ID>`

Installer host butuh ID ekstensi, karena manifest Native Messaging hanya
mengizinkan ekstensi yang disebut namanya.

1. Buka `chrome://extensions`, nyalakan **Developer mode**.
2. Salin ID 32 huruf di kartu **yraverageSubMin** (mis. `abcdefghijklmnopabcdefghijklmnop`).

ID berubah setiap kali ekstensi unpacked dimuat dari folder berbeda — jalankan
ulang installer host bila itu terjadi.

## Linux

Prasyarat: `python3` (3.10+), `python3-venv`, dan `ffmpeg` (wajib untuk berkas
media; tanpa itu `/health` melaporkan `ffmpeg: false` dan ekspor berkas gagal).

```bash
# Debian / Ubuntu
sudo apt install python3 python3-venv ffmpeg
# Fedora
sudo dnf install python3 python3-virtualenv ffmpeg
# Arch
sudo pacman -S python ffmpeg
```

Jalankan helper lalu daftarkan host-nya:

```bash
cd native
./run.sh                        # membuat .venv, memasang faster-whisper
./install-host.sh <EXT_ID>      # atau ./install-host-linux.sh <EXT_ID>
curl -sf http://127.0.0.1:17865/health | head -c 200
```

`run.sh` pertama kali mengunduh bobot model (~1,6 GB untuk `large-v3-turbo`).
Pakai model kecil bila jaringan lambat: `WHISPER_MODEL=base ./run.sh`.

Manifest host ditulis untuk setiap browser yang terpasang:

| Browser | Lokasi manifest |
| --- | --- |
| Chrome | `~/.config/google-chrome/NativeMessagingHosts/com.yraveragesubmin.helper.json` |
| Chromium | `~/.config/chromium/NativeMessagingHosts/…` |
| Microsoft Edge | `~/.config/microsoft-edge/NativeMessagingHosts/…` |
| Chrome (Flatpak) | `~/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts/…` |

Mencabut: `./uninstall-host.sh`.

### GPU NVIDIA di Linux

faster-whisper memakai CUDA lewat CTranslate2. Bila driver dan pustaka CUDA/cuDNN
sudah ada, helper mendeteksinya sendiri; paksa dengan `DEVICE=cuda ./run.sh`, atau
simpan pilihan lewat `POST /engine/device` dari Pengaturan ekstensi (butuh restart
helper — model dimuat sekali saat start). Periksa: `curl -s 127.0.0.1:17865/engine/device`.

## Windows

Prasyarat: **Python 3.10+** dari python.org (centang *Add python.exe to PATH*),
dan **ffmpeg** di PATH — `winget install Gyan.FFmpeg`, atau unduh manual lalu
tambahkan foldernya ke PATH.

Buka **Command Prompt** di folder `native`:

```bat
run.bat
install-host.bat <EXT_ID>
curl http://127.0.0.1:17865/health
```

`run.bat` adalah peluncur khusus Windows — jangan pakai `run.sh` di Git Bash:
venv Windows menaruh interpreter di `.venv\Scripts\python.exe`, dan model
bawaan `run.sh` adalah bobot MLX khusus Apple yang tidak bisa dimuat
faster-whisper. `run.bat` memakai `py -3` bila ada (stub Microsoft Store bernama
`python.exe` sering menyesatkan), membuat `.venv`, dan memasang faster-whisper.

`install-host.bat` melakukan tiga hal yang khusus Windows:

1. **Membuat pembungkus `messaging_host.bat`.** Chrome tidak bisa menjalankan
   berkas `.py` sebagai Native Messaging host, jadi manifest harus menunjuk ke
   berkas yang bisa dieksekusi. Pembungkus itu memanggil Python (`py -3`, atau
   `python` bila peluncur `py` tidak ada).
2. **Menulis manifest** ke `%LOCALAPPDATA%\yraverageSubMin\com.yraveragesubmin.helper.json`.
3. **Mendaftarkan kunci registry** — tanpa ini browser tidak menemukan host:

   - `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.yraveragesubmin.helper`
   - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.yraveragesubmin.helper`
   - `HKCU\Software\Chromium\NativeMessagingHosts\com.yraveragesubmin.helper`

Mencabut: `uninstall-host.bat`.

### GPU NVIDIA di Windows

Sama seperti Linux: `set DEVICE=cuda` lalu `run.bat`. Tanpa GPU yang terdeteksi
helper jatuh ke CPU dan mencatat peringatan, bukan mati.

## Memastikan pemasangan berhasil

Tiga hal yang perlu hijau, dan cara memeriksanya satu per satu:

| Yang diperiksa | Perintah | Diharapkan |
| --- | --- | --- |
| Helper hidup | `curl -s 127.0.0.1:17865/health` | JSON dengan `engine` dan `model` |
| ffmpeg ada | `curl -s 127.0.0.1:17865/health` | `"ffmpeg": true` |
| Bridge Native Messaging | Panel samping → **Panduan & diagnostik** | pemeriksaan **host** = OK |

Diagnostik di Side Panel membedakan penyebabnya: *belum terdaftar* (jalankan
installer host), *ditolak* (ID ekstensi tidak ada di `allowed_origins` manifest —
jalankan ulang installer dengan ID yang benar), dan *gagal jalan* (path Python di
dalam manifest/pembungkus salah).

## Masalah yang sering muncul

| Gejala | Sebabnya | Perbaikan |
| --- | --- | --- |
| `python: not found` saat `./run.sh` | venv dibuat di folder lain lalu proyek dipindah | `run.sh` membuat ulang venv sendiri; bila tetap gagal hapus `native/.venv` |
| Helper hidup tapi tombol Start/Stop mati | Host Native Messaging belum terdaftar | jalankan `install-host.*` dengan `<EXT_ID>` dari `chrome://extensions` |
| Start/Stop ditolak sesudah ekstensi dimuat ulang | ID ekstensi berubah | jalankan ulang installer host |
| `"ffmpeg": false` | ffmpeg tidak ada di PATH | pasang ffmpeg (lihat prasyarat OS) |
| Unduhan model tertahan | jaringan memblokir Xet/CAS Hugging Face | `run.sh`/`run.bat` sudah memaksa HTTP klasik; atau pakai `WHISPER_MODEL=base` |
| Port 17865 dipakai proses lain | helper lama masih jalan | `POST /shutdown`, atau matikan prosesnya lalu jalankan ulang |

## Memverifikasi lintas OS (QA)

```bash
npm run smoke:crossos          # kesiapan Windows/Linux — jalan di OS mana pun
npm run e2e:crossos:harness    # prasyarat saja (ffmpeg, helper, sampel)
npm run e2e:crossos            # penuh: berkas → job helper → ekspor → dibaca ffmpeg
```

`smoke:crossos` memeriksa artefak yang dipakai pengguna Windows/Linux (peluncur,
installer, kunci registry, manifest, kontrak helper) dan dilaporkan sebagai blok
terpisah — target 26 sub-fitur Fase 1 tidak bergeser. `e2e:crossos` menempuh
rantai nyata pada mesin yang sedang dipakai dan memverifikasi berkas ekspornya
dengan ffmpeg, bukan dengan pencocokan pola.

## Benchmark berkas >2 GiB

```bash
npm run bench:bigfile           # buat berkas 2,5 GiB, ukur memori + throughput
npm run bench:bigfile:upload    # + unggah HTTP >2 GiB ke helper (butuh helper hidup)
node scripts/bench-bigfile.mjs --file /path/besar.mkv   # pakai berkas sendiri
```

Yang dibuktikan: memori **tidak** ikut membesar bersama berkas. Benchmark
mendekode berkas pembanding dan berkas >2 GiB lewat jalur streaming yang sama
lalu membandingkan puncak RSS-nya.

Hasil terukur (macOS arm64, 2026-09-05 — `test/last-bigfile-bench.json`):

| Ukuran | Jendela | Audio | Dekode | Throughput | Puncak RSS |
| --- | --- | --- | --- | --- | --- |
| 0,15 GiB | 4 | 0,25 jam | — | — | 110 MB |
| 2,50 GiB | 51 | 4,23 jam | 12,4 dtk | 207 MiB/dtk (1230× realtime) | **108 MB** |

Berkas 17× lebih besar, puncak RSS 0,98× — datar, sesuai rancangan O(jendela).
Unggah HTTP: 2.684.455.278 byte diterima persis (3,1 dtk, 827 MiB/dtk), jadi tidak
ada pemotongan 32-bit di jalur `Content-Length`.

Yang **tidak** diukur: wall-clock Whisper untuk seluruh berkas. Berkas 2,5 GiB
berisi ±4 jam audio dan butuh berjam-jam untuk ditranskrip penuh; yang diklaim
fitur ini adalah memori dan I/O, dan itulah yang diukur. Rantai ASR ujung-ke-ujung
diverifikasi terpisah oleh `npm run e2e:crossos`.

## Memilih engine

| OS | Engine ASR | GPU |
|----|------------|-----|
| macOS Apple Silicon | mlx-whisper | Metal / MLX |
| Windows / Linux | faster-whisper | CUDA jika `cuda` terdeteksi, else CPU |

Paksa engine: `ENGINE=faster` atau `ENGINE=mlx` saat menjalankan `run.sh`.

Pilih perangkat komputasi (Windows/Linux): Side Panel → Settings → **Helper compute** → Auto / CPU / GPU (CUDA).
Pilihan disimpan di ekstensi dan dikirim ke `POST /engine/device {device}` (helper baru; `GET /engine/device`
mengembalikan `{device, active, compute, cuda_available}`), lalu berlaku setelah **Restart**. Helper lama tanpa
endpoint itu: jalankan `DEVICE=cpu ./run.sh` atau `DEVICE=cuda ./run.sh` (opsional `COMPUTE=int8|float16`).
Di macOS Apple Silicon saklar ini nonaktif — MLX memakai GPU/Neural Engine.

## Ekstensi

Side Panel → Settings → Engine → **Native helper** → Start / Refresh.

Kartu **Native Helper** di Side Panel menampilkan status terhubung + panduan per OS.

Di bawahnya ada panel **Panduan pemasangan & pemecahan masalah**: tab Windows / Linux / macOS dengan
langkah + tombol salin perintah, diagnostik dari `/health` (terjangkau, OS cocok, host Native Messaging,
ffmpeg, GPU/CUDA, LLM terjemahan, job berkas besar), dan daftar gejala → penyebab → perbaikan yang
terurut mengikuti pemeriksaan yang gagal. Harness: `test/helper-guide.html` (via lab :8799).

## Berkas besar (>1,5 GiB)

Berkas di atas 1,5 GiB tidak didekode di browser. Mode Offline mengalirkannya ke helper sebagai job:

- `POST /transcribe_file_job?language&task&filename` → `{jobId}` (body distream ke disk helper)
- `GET /jobs/<id>` → `{status: running|cancelling|cancelled|done|error, progress, segments, error}`
- `POST /jobs/<id>/cancel`

Ekstensi (`src/lib/native.js` → `nativeTranscribeFileJob`) menampilkan progres unggah (byte),
antre, transkripsi di helper (shimmer + waktu berjalan), terjemahan/finalisasi (idx/total), dan
tombol **Batalkan** di kartu **Native Helper** Side Panel. Helper lama tanpa `features.transcribe_file_jobs`
otomatis memakai `POST /transcribe_file` sinkron (progres kasar, tanpa batal di sisi helper).

## Transkripsi streaming (berkas sangat besar)

Job yang berkasnya ≥ `STREAM_MIN_BYTES` (bawaan 512 MiB) tidak lagi didekode utuh ke RAM.
Helper membaca PCM per jendela dari satu pipa ffmpeg, jadi pemakaian memori tetap datar
(≈ ukuran jendela) berapa pun besar berkasnya — inilah yang membuat berkas >2 GiB bisa jalan.

- `STREAM_CHUNK_SEC` (bawaan `300`) — panjang jendela.
- `STREAM_OVERLAP_SEC` (bawaan `2`) — konteks lead-in supaya kalimat di batas jendela tidak terpotong.
- `STREAM_MIN_BYTES` — di bawah ambang ini dipakai jalur satu-tembak (konteks penuh, tanpa jahitan).

`GET /jobs/<id>` melaporkan `progress` sungguhan dari durasi media, plus `segments` sebagian
(`partialSegments`) yang bertambah sambil berjalan, dan `streaming: true`. Batal berlaku di
batas jendela berikutnya. Stempel waktu dijepit ke durasi berkas dan tidak saling bertindih.

## Keamanan: hanya loopback

Helper menyimpan transkrip serta catatan rapat dan bisa dimatikan lewat HTTP, semuanya tanpa
autentikasi. Batas keamanannya adalah "hanya bisa dijangkau dari mesin ini", dijaga tiga lapis:

- **Pengikatan** — menolak menyala (exit 2) bila `HOST` bukan loopback. Set `ALLOW_REMOTE=1`
  hanya kalau memang disengaja.
- **CORS** — tidak lagi `Access-Control-Allow-Origin: *`. Hanya asal `chrome-extension://`
  (id ekstensi berubah saat unpacked) dan halaman loopback seperti Translation Lab yang
  dipantulkan; situs web biasa dan `Origin: null` mendapat `403`. Pin lebih ketat dengan
  `ALLOWED_ORIGINS=chrome-extension://<EXT_ID>,http://127.0.0.1:8799`.
- **Header `Host`** — permintaan dengan Host bukan loopback ditolak, menahan DNS rebinding
  (situs jahat mengarahkan namanya sendiri ke 127.0.0.1).

## Notulen (Fase 2)

API lokal (opsional, saat helper hidup):

- `POST /notes/generate` — body JSON `{ "lines": [{"text":"..."}], "title":"..." }`
- `GET /notes` / `POST /notes` — simpan/ambil notulen di `~/.yraveragesubmin/notes.json`
