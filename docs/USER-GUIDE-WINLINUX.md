# Panduan pengguna — yravgSubMeetly di Windows dan Linux

Ekstensi Chrome berjalan **sama** di Windows, Linux, dan macOS — panduan
ekstensi berlaku penuh. Yang berbeda di Windows/Linux hanya **Native Helper**:
mesin ASR-nya engine Rust `submeetly-engine` (CPU, atau GPU NVIDIA lewat CUDA bila dibangun dengannya), dan cara
mendaftarkan *Native Messaging host* mengikuti aturan tiap sistem operasi.

> **Status verifikasi — jujur:** skrip Windows (`run.bat`, `install-host.bat`)
> dan langkah-langkah di sini sudah diperiksa isinya oleh pemeriksaan otomatis
> (`npm run smoke:crossos`, 9 pemeriksaan) tetapi **belum pernah dieksekusi di
> mesin Windows sungguhan**. Kalau ada yang tidak sesuai, bagian
> *Kalau ada yang tidak beres* di bawah menunjukkan cara membaca penyebabnya.

---

## Tanpa helper pun sudah bisa dipakai

Ekstensi tidak membutuhkan helper. Subtitel langsung, berkas hingga ~1,5 GiB,
ekspor, dan notulen berjalan **di dalam browser**. Pasang helper hanya kalau
Anda ingin: pengenalan suara lebih cepat, berkas lebih dari 1,5 GiB, atau
terjemahan LLM lokal.

---

## Windows

### Prasyarat

- **`submeetly-engine.exe`** — ikut installer **yravgSubMeetly Setup**, atau bangun
  sendiri: `cargo build --release -p submeetly-engine --manifest-path engine-rsCargo.toml`.
- Tidak perlu Python dan tidak perlu ffmpeg: media didekode di dalam engine.

### Menjalankan helper

Buka **Command Prompt** (bukan Git Bash) di folder `native`:

```bat
run.bat
```

`run.bat` menjalankan `submeetly-engine.exe`; pertama kali dipakai ia
mengunduh bobot model (~1,6 GB untuk `large-v3-turbo`). Jaringan lambat?

```bat
set WHISPER_MODEL=base
run.bat
```

Gunakan `run.bat` di Windows; `run.sh` adalah skrip bash untuk Linux/macOS.

### Mendaftarkan Native Messaging host

Ambil **ID ekstensi** dari `chrome://extensions` (Developer mode), lalu:

```bat
install-host.bat <EXT_ID>
```

Skrip ini melakukan tiga hal yang khusus Windows:

1. Membuat pembungkus `messaging_host.bat` — Chrome tidak bisa menjalankan
   berkas `.py` langsung sebagai host.
2. Menulis manifest ke `%LOCALAPPDATA%\yraverageSubMin\com.yraveragesubmin.helper.json`.
3. Mendaftarkan kunci registry `HKCU\Software\…\NativeMessagingHosts\com.yraveragesubmin.helper`
   untuk Chrome, Edge, dan Chromium — tanpa ini browser tidak menemukan host.

Mencabut: `uninstall-host.bat`.

### GPU NVIDIA

```bat
set DEVICE=cuda
run.bat
```

Tanpa GPU yang terdeteksi, helper jatuh ke CPU dan mencatat peringatan — tidak
mati. Pilihan juga bisa disimpan dari Side Panel → **Settings → Helper compute**
(Auto / CPU / GPU), berlaku setelah **Restart** helper.

---

## Linux

### Prasyarat

```bash
# Tidak ada paket sistem yang dibutuhkan: bangun engine dengan Rust stable
cargo build --release -p submeetly-engine --manifest-path engine-rs/Cargo.toml
```

### Menjalankan helper dan mendaftarkan host

```bash
cd native
./run.sh                      # menjalankan submeetly-engine; model diunduh saat pertama dipakai
./install-host.sh <EXT_ID>    # mendaftarkan host untuk browser yang terpasang
curl -sf http://127.0.0.1:17865/health | head -c 200
```

Manifest ditulis untuk setiap browser yang ditemukan:

| Browser | Lokasi manifest |
| --- | --- |
| Chrome | `~/.config/google-chrome/NativeMessagingHosts/com.yraveragesubmin.helper.json` |
| Chromium | `~/.config/chromium/NativeMessagingHosts/…` |
| Microsoft Edge | `~/.config/microsoft-edge/NativeMessagingHosts/…` |
| Chrome / Chromium / Edge (Flatpak) | `~/.var/app/<app-id>/config/…/NativeMessagingHosts/…` |

Mencabut: `./uninstall-host.sh`.

### GPU NVIDIA

Hanya bila engine dibangun dengan `--features cuda` dan driver NVIDIA ada, engine memakai GPU.
Paksa dengan `DEVICE=cuda ./run.sh`, atau simpan pilihannya dari Side Panel →
**Settings → Helper compute**. Periksa: `curl -s 127.0.0.1:17865/engine/device`.

---

## Memastikan pemasangan berhasil

Tiga hal yang harus hijau:

| Yang diperiksa | Cara | Diharapkan |
| --- | --- | --- |
| Helper hidup | `curl -s 127.0.0.1:17865/health` | JSON berisi `engine` dan `model` |
| Dekoder media | `curl -s 127.0.0.1:17865/health` | `media_decoder` terisi (`"ffmpeg": false` itu normal) |
| Bridge Native Messaging | Side Panel → kartu **Native Helper** → **Panduan & diagnostik** | pemeriksaan **host** = OK |

Diagnostik di Side Panel membedakan penyebabnya, bukan hanya "gagal":

- **belum terdaftar** — jalankan installer host;
- **ditolak** — ID ekstensi tidak ada di `allowed_origins` manifest (ID berubah
  setelah ekstensi dimuat ulang); jalankan ulang installer dengan ID yang benar;
- **gagal jalan** — path `submeetly-engine` di dalam manifest salah atau biner dipindah.

---

## Ekspor yang ramah Windows

Kartu **Export** punya sakelar **CRLF** dan **BOM**. Keduanya menyala otomatis
di Windows: Notepad dan pemutar lama membaca SRT/VTT paling aman dengan akhir
baris CRLF dan penanda UTF-8. Di Linux keduanya mati (BOM justru mengganggu
`cat` dan beberapa versi `ffmpeg -i sub.srt`). **Reset** mengembalikan ke
bawaan sistem operasi Anda.

---

## Kalau ada yang tidak beres

| Gejala | Sebabnya | Perbaikan |
| --- | --- | --- |
| `submeetly-engine not built` dari `run.bat`/`run.sh` | biner engine belum ada | pasang lewat Setup, atau `cargo build --release -p submeetly-engine` |
| Helper hidup tapi tombol Start/Stop mati | host Native Messaging belum terdaftar | `install-host.bat <EXT_ID>` / `./install-host.sh <EXT_ID>` |
| Start/Stop ditolak sesudah ekstensi dimuat ulang | ID ekstensi berubah | jalankan ulang installer host |
| Unduhan model tertahan | jaringan memblokir Xet/CAS Hugging Face | coba `WHISPER_MODEL=base` atau set `HF_ENDPOINT` ke mirror |
| Port 17865 sudah dipakai | helper lama masih jalan | matikan prosesnya, atau `curl -X POST 127.0.0.1:17865/shutdown` |
| GPU tidak terpakai | engine dibangun tanpa `--features cuda`, atau CUDA tidak terdeteksi | `curl -s 127.0.0.1:17865/engine/device` → `cuda_available`; pasang pustaka CUDA yang cocok |

Pemeriksaan otomatis untuk kesiapan lintas OS bisa dijalankan dari repo:

```bash
npm run smoke:crossos     # artefak Windows/Linux — jalan di OS mana pun
npm run e2e:crossos       # rantai nyata: berkas → job helper → ekspor → dibaca ffmpeg
```
