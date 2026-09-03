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

## Linux

```bash
cd native
./run.sh                 # memasang faster-whisper di .venv
./install-host-linux.sh <EXT_ID>
# atau: ./install-host.sh <EXT_ID>
curl -sf http://127.0.0.1:17865/health
```

Manifest host: `~/.config/google-chrome/NativeMessagingHosts/com.localtranssub.helper.json`

## Windows

```bat
cd native
run.sh                   rem via Git Bash / WSL, atau python -m venv + pip install faster-whisper
install-host.bat <EXT_ID>
```

`install-host.bat` menulis JSON host + kunci registry:

`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.localtranssub.helper`

## Memilih engine

| OS | Engine ASR | GPU |
|----|------------|-----|
| macOS Apple Silicon | mlx-whisper | Metal / MLX |
| Windows / Linux | faster-whisper | CUDA jika `cuda` terdeteksi, else CPU |

Paksa engine: `ENGINE=faster` atau `ENGINE=mlx` saat menjalankan `run.sh`.

## Ekstensi

Side Panel → Settings → Engine → **Native helper** → Start / Refresh.

Kartu **Native Helper** di Side Panel menampilkan status terhubung + panduan per OS.

## Berkas besar (>2 GiB)

Gunakan Offline + helper (`/transcribe_file`). Progress/cancel: lihat endpoint job di `server.py`.

## Notulen (Fase 2)

API lokal (opsional, saat helper hidup):

- `POST /notes/generate` — body JSON `{ "lines": [{"text":"..."}], "title":"..." }`
- `GET /notes` / `POST /notes` — simpan/ambil notulen di `~/.localtranssub/notes.json`
