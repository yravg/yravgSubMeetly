#!/usr/bin/env python3
"""yraverageSubMin native helper.

A tiny localhost HTTP server that gives the browser extension a fast, accurate
speech-recognition engine running on this machine:

  * Apple Silicon  → mlx-whisper  (Whisper Large v3 Turbo on the GPU via MLX)
  * anything else  → faster-whisper (CTranslate2, CPU/CUDA)

Optional: an on-device translation LLM via mlx-lm (Qwen2.5 Instruct).

Nothing leaves the machine. The server binds to 127.0.0.1 only.

Endpoints (all CORS-enabled for the extension):
  GET  /health                       → {ok, engine, model, ffmpeg, translate}
  POST /transcribe?language&task     body: raw float32 LE PCM @16 kHz → {text}
  POST /transcribe_file?language&task&filename  body: media bytes → {segments}
  POST /translate?src&tgt            body: utf-8 text → {text}  (501 if no LLM)
  POST /translate_refine?src&tgt     body: {"text","draft"} → {text}  (501 if no LLM)
   POST /draft?src&tgt&language       body: raw float32 LE PCM @16 kHz → {source, translation, ms}
   POST /shutdown                     → {ok, shutting_down}
   GET  /ui-prefs                     → {prefs: {theme, reskin}, stored}
   POST /ui-prefs                     body: {"theme"?,"reskin"?} → {prefs} (shared local UI store)
   POST /notes/summarize              body: {"lines"[], "title"?} → {summary, decisions, actions} (no save)
   GET  /notes/{id}                   → {note} (404 when missing)
   DELETE /notes/{id}                 → {ok, id} (404 when missing)
   POST /notes/export                 body: {"id"?,"note"?,"format":"txt"|"md"} → {filename, content}
   GET  /models                       → {models: [{key, kind, id, engine, device, available}]}
   POST /models/pull                  body: {"id"} → {ok, id, path, bytes} (allowlist inventaris)
   DELETE /models/cache/{org--name}?confirm=1 → {ok, id, freedBytes} (tolak model inventaris aktif)
   GET  /languages/targets            → {targets: [{code, via, local}]} (sisi helper saja)
   GET  /engine/mode                  → {mode} (fast|balanced|accurate)
   POST /engine/mode                  body: {"mode"} → {mode}
 """
import io
import ipaddress
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

# Prefer resumable classic HTTP downloads over the flaky Xet/CAS backend.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

import numpy as np


class ReuseHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def server_bind(self):
        # Di sini, bukan di blok __main__: penjagaannya harus ikut ke mana pun
        # server ini dinyalakan (skrip lain, tes, embedder).
        addr = self.server_address[0]
        if not _is_loopback_host(addr) and not ALLOW_REMOTE:
            print(
                f"HOST={addr} bukan loopback. Helper ini menyimpan transkrip & catatan "
                f"dan bisa dimatikan lewat HTTP tanpa autentikasi, jadi menolak mengikat "
                f"alamat yang bisa dijangkau jaringan.\n"
                f"Pakai HOST=127.0.0.1, atau set ALLOW_REMOTE=1 kalau memang disengaja.",
                file=sys.stderr, flush=True,
            )
            raise SystemExit(2)
        super().server_bind()

HOST = os.environ.get("HOST", "127.0.0.1")
# Helper ini menyimpan transkrip dan catatan rapat serta bisa dimatikan lewat
# HTTP. Semuanya tanpa autentikasi, jadi satu-satunya batas keamanannya adalah
# "hanya bisa dijangkau dari mesin ini". Dua hal yang dijaga:
#   * pengikatan soket — menyerah kalau HOST bukan loopback
#   * asal permintaan  — CORS ketat + penjagaan header Host (anti DNS rebinding)
LOOPBACK_HOSTNAMES = frozenset({"127.0.0.1", "localhost", "::1", "[::1]", ""})
ALLOW_REMOTE = os.environ.get("ALLOW_REMOTE") == "1"
# Kosong = pakai bawaan: ekstensi Chrome mana pun + halaman loopback (lab, tes).
ALLOWED_ORIGINS = frozenset(
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
)


def _is_loopback_host(hostname: str) -> bool:
    h = (hostname or "").strip().lower()
    if h in LOOPBACK_HOSTNAMES:
        return True
    # Seluruh 127.0.0.0/8 adalah loopback, bukan hanya 127.0.0.1.
    try:
        return ipaddress.ip_address(h.strip("[]")).is_loopback
    except ValueError:
        return False


def _host_header_hostname(host: str) -> str:
    """Ambil nama host dari header Host, termasuk bentuk IPv6 `[::1]:17865`."""
    h = (host or "").strip()
    if h.startswith("["):
        return h[1 : h.index("]")] if "]" in h else h
    # Satu ":" = "nama:port". Lebih dari satu = IPv6 telanjang, biarkan utuh.
    return h.rsplit(":", 1)[0] if h.count(":") == 1 else h


def origin_allowed(origin: str) -> bool:
    """Boleh membaca jawaban helper?

    Bawaan: ekstensi Chrome (id-nya berubah-ubah saat unpacked, jadi tidak bisa
    dipaku) dan halaman yang disajikan dari loopback seperti Translation Lab.
    Situs web biasa TIDAK boleh — itulah inti pembatasan ini. `Origin: null`
    (iframe sandbox, file://) juga ditolak kecuali disebut eksplisit.
    """
    o = (origin or "").strip()
    if not o:
        return True  # bukan permintaan lintas-asal (curl, app macOS, host NM)
    if ALLOWED_ORIGINS:
        return o in ALLOWED_ORIGINS
    if o.startswith("chrome-extension://") or o.startswith("moz-extension://"):
        return True
    try:
        u = urlparse(o)
    except ValueError:
        return False
    return u.scheme in ("http", "https") and _is_loopback_host(u.hostname or "")
PORT = int(os.environ.get("PORT", "17865"))
IS_APPLE_SILICON = platform.system() == "Darwin" and platform.machine() == "arm64"

# ---------------------------------------------------------------------------
# ASR engine
ENGINE = None
MODEL = None
DRAFT_MODEL = os.environ.get("DRAFT_WHISPER_MODEL", "mlx-community/whisper-base-mlx")
_lock = threading.Lock()
_draft_lock = threading.Lock()

try:
    if os.environ.get("ENGINE", "auto") in ("auto", "mlx") and IS_APPLE_SILICON:
        import mlx_whisper  # noqa: F401

        ENGINE = "mlx-whisper"
        MODEL = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")
except ImportError:
    pass

if ENGINE is None:
    try:
        from faster_whisper import WhisperModel
        import ctranslate2

        ENGINE = "faster-whisper"
        MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
        _cuda = False
        try:
            _cuda = ctranslate2.get_cuda_device_count() > 0
        except Exception:
            _cuda = False
        # Urutan: env DEVICE (paksa) → preferensi tersimpan → deteksi otomatis.
        # Dibaca inline karena helper persistensi didefinisikan setelah blok ini.
        _pref = "auto"
        try:
            _pp = Path(os.environ.get("DEVICE_PREF_PATH", Path.home() / ".localtranssub" / "device.json"))
            if _pp.is_file():
                _pv = json.loads(_pp.read_text(encoding="utf-8")).get("device")
                if _pv in ("auto", "cpu", "cuda"):
                    _pref = _pv
        except Exception:
            _pref = "auto"
        if _pref == "cuda" and not _cuda:
            print("[device] preferensi 'cuda' diminta tapi CUDA tidak tersedia — memakai CPU.", file=sys.stderr)
            _pref = "auto"
        _fw_device = os.environ.get("DEVICE") or (_pref if _pref != "auto" else ("cuda" if _cuda else "cpu"))
        _fw_compute = os.environ.get("COMPUTE") or ("float16" if _fw_device == "cuda" else "int8")
        _fw = WhisperModel(MODEL, device=_fw_device, compute_type=_fw_compute)
        FW_DEVICE = _fw_device
        FW_COMPUTE = _fw_compute
    except ImportError:
        print(
            "No ASR engine installed. Run native/run.sh (installs mlx-whisper on Apple Silicon, "
            "faster-whisper elsewhere).",
            file=sys.stderr,
        )
        sys.exit(1)
else:
    FW_DEVICE = None
    FW_COMPUTE = None

def _resolve_ffmpeg() -> str | None:
    """Pick an ffmpeg that actually runs (Intel binaries fail on Apple Silicon)."""
    candidates = []
    if os.environ.get("FFMPEG"):
        candidates.append(os.environ["FFMPEG"])
    if IS_APPLE_SILICON:
        candidates.append("/opt/homebrew/bin/ffmpeg")
    found = shutil.which("ffmpeg")
    if found:
        candidates.append(found)
    seen = set()
    for path in candidates:
        if not path or path in seen:
            continue
        seen.add(path)
        if not os.path.isfile(path):
            continue
        try:
            subprocess.run([path, "-version"], capture_output=True, timeout=10, check=True)
            return path
        except (OSError, subprocess.SubprocessError):
            continue
    return None


FFMPEG_BIN = _resolve_ffmpeg()
FFMPEG = FFMPEG_BIN is not None
if FFMPEG_BIN:
    ffmpeg_dir = os.path.dirname(FFMPEG_BIN)
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")


def _lang(v):
    return None if not v or v == "auto" else v


def _draft_source_ok(source: str, audio_samples: int) -> bool:
    """Reject partial ASR that is implausibly long for the audio window."""
    s = source.strip()
    if not s:
        return False
    duration_s = audio_samples / 16000
    # Short windows produce short phrases — allow ~25 chars/s + slack.
    max_chars = max(40, int(duration_s * 25) + 20)
    return len(s) <= max_chars


def _clip_fast_text(text: str, limit: int = 120) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.strip() or text[:limit].strip()


def asr_array_segments(audio: np.ndarray, language, task):
    """audio: float32 mono 16 kHz → [{start, end, text}] (waktu relatif ke potongan)"""
    with _lock:
        if ENGINE == "mlx-whisper":
            r = mlx_whisper.transcribe(
                audio,
                path_or_hf_repo=MODEL,
                language=_lang(language),
                task=task,
                temperature=0.0,
                condition_on_previous_text=False,
                no_speech_threshold=0.5,
                fp16=True,
            )
            return [
                {"start": float(x["start"]), "end": float(x["end"]), "text": x["text"].strip()}
                for x in r.get("segments", [])
                if x.get("text", "").strip()
            ]
        segs, _ = _fw.transcribe(
            audio, language=_lang(language), task=task, beam_size=_beam_size(), vad_filter=False
        )
        return [
            {"start": float(x.start), "end": float(x.end), "text": x.text.strip()}
            for x in segs
            if x.text.strip()
        ]


def asr_array(audio: np.ndarray, language, task):
    """audio: float32 mono 16 kHz → text"""
    return " ".join(s["text"] for s in asr_array_segments(audio, language, task)).strip()


# ---------------------------------------------------------------------------
# Transkripsi streaming untuk berkas sangat besar (>2 GiB).
#
# asr_file() menyerahkan seluruh berkas ke engine, yang mendekodekannya menjadi
# satu larik di RAM: 16 kHz float32 ≈ 230 MB per jam audio, jadi rekaman panjang
# bisa menghabiskan memori sebelum satu segmen pun keluar. Jalur di bawah membaca
# PCM dari satu pipa ffmpeg per jendela, sehingga pemakaian RAM tetap O(jendela)
# berapa pun ukuran berkasnya, dan kemajuan bisa dilaporkan sambil jalan.

SAMPLE_RATE = 16000
STREAM_CHUNK_SEC = float(os.environ.get("STREAM_CHUNK_SEC", "300"))
# Sedikit tumpang tindih supaya kalimat yang terpotong di batas jendela tetap
# punya konteks; segmen yang seluruhnya jatuh di bagian ini dibuang.
STREAM_OVERLAP_SEC = float(os.environ.get("STREAM_OVERLAP_SEC", "2"))
# Di bawah ambang ini jalur satu-tembak lebih baik: konteks penuh, tanpa jahitan.
STREAM_MIN_BYTES = int(os.environ.get("STREAM_MIN_BYTES", str(512 * 1024 * 1024)))


class JobCancelled(Exception):
    """Dilempar saat pemanggil membatalkan di antara jendela."""


def media_duration_sec(path: str):
    """Durasi media dalam detik, atau None kalau tidak bisa dipastikan."""
    probe = os.path.join(os.path.dirname(FFMPEG_BIN), "ffprobe") if FFMPEG_BIN else None
    if probe and os.path.exists(probe):
        try:
            out = subprocess.run(
                [probe, "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", path],
                capture_output=True, text=True, timeout=60, check=True,
            ).stdout.strip()
            return float(out) if out and out != "N/A" else None
        except (OSError, subprocess.SubprocessError, ValueError):
            pass
    # Tanpa ffprobe: baca "Duration: HH:MM:SS.ss" dari stderr ffmpeg.
    try:
        err = subprocess.run(
            [FFMPEG_BIN, "-nostdin", "-i", path], capture_output=True, text=True, timeout=60
        ).stderr
        m = re.search(r"Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)", err)
        if m:
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def _stream_windows(path: str, chunk_sec=None, overlap_sec=None):
    """Hasilkan (start_sec, lead_sec, audio) dari satu pipa ffmpeg.

    `start_sec` = posisi audio baru dalam berkas; `lead_sec` = panjang ekor
    jendela sebelumnya yang ikut disertakan sebagai konteks di depannya.
    """
    chunk_n = max(1, int((chunk_sec or STREAM_CHUNK_SEC) * SAMPLE_RATE))
    ov_n = max(0, int((overlap_sec if overlap_sec is not None else STREAM_OVERLAP_SEC) * SAMPLE_RATE))
    cmd = [
        FFMPEG_BIN, "-nostdin", "-v", "error", "-i", path,
        "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=1 << 20)
    tail = np.zeros(0, dtype=np.float32)
    pos = 0
    try:
        while True:
            need = chunk_n * 4
            parts, got = [], 0
            while got < need:
                b = proc.stdout.read(need - got)
                if not b:
                    break
                parts.append(b)
                got += len(b)
            if got == 0:
                break
            raw = b"".join(parts)
            # Pipa bisa berhenti di tengah sampel; buang sisa byte yang tak utuh.
            cur = np.frombuffer(raw[: len(raw) - len(raw) % 4], dtype=np.float32)
            if cur.size == 0:
                break
            window = np.concatenate([tail, cur]) if tail.size else cur
            yield (pos / SAMPLE_RATE, tail.size / SAMPLE_RATE, window)
            pos += cur.size
            tail = cur[-ov_n:].copy() if ov_n and cur.size >= ov_n else cur.copy()
            if got < need:
                break
    finally:
        try:
            proc.stdout.close()
        except OSError:
            pass
        if proc.poll() is None:
            proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def asr_file_streaming(path: str, language, task, on_progress=None, should_cancel=None):
    """Transkripsi berjendela; segmen dikembalikan dengan waktu absolut.

    on_progress(fraction|None, segments) dipanggil setelah tiap jendela, jadi
    pemanggil bisa menampilkan hasil sebagian jauh sebelum berkas selesai.
    """
    total = media_duration_sec(path)
    out = []
    for start_sec, lead_sec, window in _stream_windows(path):
        if should_cancel and should_cancel():
            raise JobCancelled()
        base = start_sec - lead_sec
        win_end = base + window.size / SAMPLE_RATE
        for seg in asr_array_segments(window, language, task):
            st, en = base + seg["start"], base + seg["end"]
            # Whisper kadang memancarkan stempel waktu melewati panjang audio
            # yang diberikan. Tanpa dijepit, waktunya melampaui akhir berkas dan
            # merusak ekspor SRT/VTT serta garis waktu di UI.
            st = max(base, min(st, win_end))
            en = min(en, win_end)
            if total and total > 0:
                st, en = min(st, total), min(en, total)
            if en <= st:
                continue
            # Jendela sebelumnya sudah mencakup daerah lead-in — jangan ganda.
            if out and en <= start_sec + 0.05:
                continue
            # Segmen yang melintasi batas: audio sebelum `start_sec` sudah
            # ditranskrip jendela lalu, jadi majukan awalnya. Tanpa ini cue
            # bertindihan dan SRT/VTT menampilkan dua baris sekaligus.
            if out:
                st = max(st, start_sec)
            if en <= st:
                continue
            out.append({"start": st, "end": en, "text": seg["text"]})
        done = start_sec + (window.size / SAMPLE_RATE) - lead_sec
        if on_progress:
            on_progress(min(0.99, done / total) if total and total > 0 else None, out)
    return out


def asr_file(path: str, language, task):
    """media file → [{start, end, text}]"""
    with _lock:
        if ENGINE == "mlx-whisper":
            r = mlx_whisper.transcribe(
                path,
                path_or_hf_repo=MODEL,
                language=_lang(language),
                task=task,
                temperature=0.0,
                condition_on_previous_text=False,
                fp16=True,
            )
            return [
                {"start": s["start"], "end": s["end"], "text": s["text"].strip()}
                for s in r.get("segments", [])
                if s.get("text", "").strip()
            ]
        segs, _ = _fw.transcribe(path, language=_lang(language), task=task, beam_size=_beam_size())
        return [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segs if s.text.strip()]


def draft_asr_array(audio: np.ndarray, language, task):
    """Fast partial ASR for live draft subtitles (smaller model, separate lock)."""
    with _draft_lock:
        if ENGINE == "mlx-whisper":
            r = mlx_whisper.transcribe(
                audio,
                path_or_hf_repo=DRAFT_MODEL,
                language=_lang(language),
                task=task,
                temperature=0.0,
                condition_on_previous_text=False,
                no_speech_threshold=0.6,
                fp16=True,
            )
            return (r.get("text") or "").strip()
        segs, _ = _fw.transcribe(
            audio, language=_lang(language), task=task, beam_size=1, vad_filter=False
        )
        return " ".join(s.text.strip() for s in segs).strip()


_draft_model_loaded = False


def _ensure_draft_warm():
    global _draft_model_loaded
    if _draft_model_loaded or not _draft_available:
        return
    draft_asr_array(
        (np.random.randn(8000).astype(np.float32) * 0.01), "en", "transcribe"
    )
    _draft_model_loaded = True


_draft_available = ENGINE == "mlx-whisper" and DRAFT_MODEL != MODEL


# ---------------------------------------------------------------------------
# Optional translation LLM (mlx-lm)
TRANSLATE_MODEL = os.environ.get("TRANSLATE_MODEL", "mlx-community/Qwen2.5-3B-Instruct-4bit")
_llm = None
_llm_lock = threading.Lock()
_translate_available = os.environ.get("TRANSLATE", "on") != "off"
try:
    if _translate_available:
        from mlx_lm import generate as _mlx_generate
        from mlx_lm import load as _mlx_load
except ImportError:
    _translate_available = False

LANG_NAMES = {
    "en": "English", "zh": "Simplified Chinese", "ja": "Japanese", "ko": "Korean",
    "de": "German", "fr": "French", "es": "Spanish", "ru": "Russian", "it": "Italian",
    "pt": "Portuguese", "nl": "Dutch", "pl": "Polish", "tr": "Turkish", "ar": "Arabic",
    "hi": "Hindi", "th": "Thai", "vi": "Vietnamese", "id": "Indonesian", "uk": "Ukrainian",
    "auto": "the source language",
}


def _norm_lang(v, *, fallback: str) -> str:
    """Normalisasi kode bahasa baru ke pipeline: huruf kecil, buang region
    (en-US/zh-Hans → en/zh), hanya kode yang dikenal — selain itu fallback.
    Membuat target baru (vi/ja/ko/id/...) selalu mendarat utuh di prompt LLM."""
    code = str(v or "").strip().lower().replace("_", "-")
    if not code:
        return fallback
    base = code.split("-", 1)[0]
    if code in LANG_NAMES:
        return code
    if base in LANG_NAMES:
        return base
    return fallback


def translate_text(text: str, src: str, tgt: str, *, fast: bool = False) -> str:
    global _llm
    with _llm_lock:
        if _llm is None:
            print(f"[translate] loading {TRANSLATE_MODEL} …", flush=True)
            _llm = _mlx_load(TRANSLATE_MODEL)
        model, tok = _llm
        if fast:
            text = _clip_fast_text(text)
            messages = [
                {
                    "role": "system",
                    "content": (
                        f"Live subtitle translator. {LANG_NAMES.get(src, src)} → "
                        f"{LANG_NAMES.get(tgt, tgt)}. Output ONLY the translation, concise."
                    ),
                },
                {"role": "user", "content": text},
            ]
            max_tokens = 24
        else:
            messages = [
                {
                    "role": "system",
                    "content": (
                        "You are a professional subtitle translator. Translate the user's text from "
                        f"{LANG_NAMES.get(src, src)} to {LANG_NAMES.get(tgt, tgt)}. Keep it natural and "
                        "concise, preserve meaning and tone. Output ONLY the translation — no notes, "
                        "no quotes, no explanations."
                    ),
                },
                {"role": "user", "content": text},
            ]
            max_tokens = 256
        prompt = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        out = _mlx_generate(model, tok, prompt=prompt, max_tokens=max_tokens, verbose=False)
        return out.strip().split("\n")[0].strip() if out else ""


def refine_text(text: str, draft: str, src: str, tgt: str) -> str:
    """Correct a draft translation once the full utterance is known."""
    global _llm
    with _llm_lock:
        if _llm is None:
            print(f"[translate] loading {TRANSLATE_MODEL} …", flush=True)
            _llm = _mlx_load(TRANSLATE_MODEL)
        model, tok = _llm
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a professional live subtitle translator (like smart-glasses captioning). "
                    f"The speaker finished an utterance in {LANG_NAMES.get(src, src)}. A draft translation "
                    f"was shown while they were still speaking. Now produce the final, semantically accurate "
                    f"translation in {LANG_NAMES.get(tgt, tgt)}. Fix incomplete phrasing, wrong guesses, and "
                    "word order. Keep it concise and natural. Output ONLY the corrected translation — no notes."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Complete source:\n{text}\n\n"
                    f"Draft translation (may be incomplete or wrong):\n{draft or '(none)'}\n\n"
                    "Final translation:"
                ),
            },
        ]
        prompt = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        out = _mlx_generate(model, tok, prompt=prompt, max_tokens=256, verbose=False)
        return out.strip().split("\n")[0].strip() if out else ""


def draft_pipeline(audio: np.ndarray, language, src: str, tgt: str):
    """One-shot live draft: fast ASR + fast translate (~0.3–0.5 s on Apple Silicon).
    Mode accurate memakai model penuh (tanpa draf kecil)."""
    _ensure_draft_warm()
    t0 = time.time()
    t_asr = time.time()
    if _draft_available and _load_engine_mode() != "accurate":
        source = draft_asr_array(audio, language, "transcribe")
    else:
        source = asr_array(audio, language, "transcribe")
    asr_ms = int((time.time() - t_asr) * 1000)
    if not _draft_source_ok(source, audio.size):
        return {"source": "", "translation": "", "ms": int((time.time() - t0) * 1000), "asr_ms": asr_ms}
    if not _translate_available:
        return {
            "source": source,
            "translation": source,
            "ms": int((time.time() - t0) * 1000),
            "asr_ms": asr_ms,
        }
    t_mt = time.time()
    translation = translate_text(source, src, tgt, fast=_load_engine_mode() != "accurate")
    translate_ms = int((time.time() - t_mt) * 1000)
    return {
        "source": source,
        "translation": translation,
        "ms": int((time.time() - t0) * 1000),
        "asr_ms": asr_ms,
        "translate_ms": translate_ms,
    }


# ---------------------------------------------------------------------------
# Notes store + large-file jobs (Fase 2)
NOTES_PATH = Path(os.environ.get("NOTES_PATH", Path.home() / ".localtranssub" / "notes.json"))
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _load_notes() -> list:
    try:
        if NOTES_PATH.is_file():
            return json.loads(NOTES_PATH.read_text(encoding="utf-8")).get("notes", [])
    except Exception:
        pass
    return []


def _save_notes(notes: list) -> None:
    NOTES_PATH.parent.mkdir(parents=True, exist_ok=True)
    NOTES_PATH.write_text(
        json.dumps({"updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "notes": notes}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _export_note_txt(note: dict) -> str:
    """Notulen → TXT polos (cermin serializeMeetingTxt di src/lib/notes-export.js)."""
    lines = [
        note.get("title", ""),
        f"{note.get('id', '')} · {note.get('date', '')}",
        "Issued" if note.get("status") == "issued" else "Draft — not yet issued",
        "",
    ]
    if note.get("summary"):
        lines += ["Summary", note["summary"], ""]
    if note.get("decisions"):
        lines.append("Decisions")
        lines += [f"- {d}" for d in note["decisions"]]
        lines.append("")
    if note.get("actions"):
        lines.append("Action items")
        for a in note["actions"]:
            meta = " — ".join(
                p
                for p in [
                    a.get("owner") or "",
                    f"due {a['due']}" if a.get("due") else "",
                    a.get("status") if a.get("status") not in (None, "", "open") else "",
                ]
                if p
            )
            lines.append(f"- {a.get('text', '')}" + (f" — {meta}" if meta else ""))
        lines.append("")
    lines.append("Drafted on-device. Nothing left this machine.")
    return "\n".join(lines) + "\n"


def _export_note_md(note: dict) -> str:
    """Notulen → Markdown (cermin serializeMeetingMarkdown)."""
    lines = [
        f"# {note.get('title', '')}",
        "",
        f"_{note.get('id', '')}_ · {note.get('date', '')}",
        "",
        note.get("summary") or "_No summary yet._",
        "",
    ]
    if note.get("decisions"):
        lines.append("## Decisions")
        lines += [f"- {d}" for d in note["decisions"]]
        lines.append("")
    if note.get("actions"):
        lines.append("## Action items")
        for a in note["actions"]:
            box = "x" if a.get("status") == "closed" else " "
            meta = " — ".join(
                p
                for p in [
                    a.get("owner") or "",
                    f"due {a['due']}" if a.get("due") else "",
                ]
                if p
            )
            lines.append(f"- [{box}] {a.get('text', '')}" + (f" — {meta}" if meta else ""))
        lines.append("")
    lines.append("Drafted on-device. Nothing left this machine.")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Skema penyimpanan lokal model bahasa (inventaris helper):
#   {key:str, kind:'asr'|'draft'|'translate', id:str, engine:str,
#    device:str?, available:bool}
# Ini skema baca-saja di atas model yang terkonfigurasi — berkas bobot tetap
# milik cache masing-masing engine (HF Hub / MLX), helper hanya melaporkan
# apa yang siap dipakai. Klien (ekstensi/macOS) memakai daftar ini untuk
# memilih mode cepat↔akurat tanpa menebak.
def _model_inventory() -> list:
    items = [
        {
            "key": "asr",
            "kind": "asr",
            "id": MODEL,
            "engine": ENGINE,
            "device": FW_DEVICE or ("apple-silicon" if IS_APPLE_SILICON else "cpu"),
            "available": True,
        }
    ]
    if _draft_available:
        items.append(
            {
                "key": "draft",
                "kind": "draft",
                "id": DRAFT_MODEL,
                "engine": ENGINE,
                "device": FW_DEVICE or ("apple-silicon" if IS_APPLE_SILICON else "cpu"),
                "available": True,
            }
        )
    items.append(
        {
            "key": "translate",
            "kind": "translate",
            "id": TRANSLATE_MODEL if _translate_available else None,
            "engine": "mlx-lm" if _translate_available else None,
            "device": "apple-silicon" if IS_APPLE_SILICON else "cpu",
            "available": bool(_translate_available),
        }
    )
    return items


# ---------------------------------------------------------------------------
# Status ketersediaan bahasa target — SISI HELPER SAJA (cermin TARGET_LANGS
# ekstensi). 'en' selalu via whisper-direct; sisanya via LLM bila ada, kalau
# tidak 'none' (pasangan Opus-MT browser tidak terlihat dari sini — klien
# menggabungkan dengan translationPlan() di sisi ekstensi).
TARGET_LANGS = ["en", "zh", "de", "fr", "es", "ru", "it", "id", "vi", "ja", "ko"]


def _target_status() -> list:
    out = []
    for code in TARGET_LANGS:
        if code == "en":
            out.append({"code": code, "via": "whisper-direct", "local": True})
        elif _translate_available:
            out.append({"code": code, "via": "llm", "local": True})
        else:
            out.append({"code": code, "via": "none", "local": False})
    return out


# ---------------------------------------------------------------------------
# Setelan mode cepat↔akurat lokal (tersimpan, berlaku saat runtime):
#   fast     = draft model kecil + beam 1 (bawaan = perilaku lama, tak berubah)
#   balanced = beam 3 (faster-whisper) / draft model (mlx)
#   accurate = model penuh untuk draf + beam 5 (faster-whisper)
ENGINE_MODE_PATH = Path(os.environ.get("ENGINE_MODE_PATH", Path.home() / ".localtranssub" / "engine-mode.json"))
ENGINE_MODES = ("fast", "balanced", "accurate")


def _load_engine_mode() -> str:
    try:
        if ENGINE_MODE_PATH.is_file():
            mode = json.loads(ENGINE_MODE_PATH.read_text(encoding="utf-8")).get("mode")
            if mode in ENGINE_MODES:
                return mode
    except Exception:
        pass
    return "fast"


def _save_engine_mode(mode: str) -> str:
    if mode not in ENGINE_MODES:
        raise ValueError("mode must be fast, balanced, or accurate")
    ENGINE_MODE_PATH.parent.mkdir(parents=True, exist_ok=True)
    ENGINE_MODE_PATH.write_text(json.dumps({"mode": mode}, ensure_ascii=False), encoding="utf-8")
    return mode


# ---------------------------------------------------------------------------
# Pilihan runtime CPU/GPU (Windows/Linux, faster-whisper).
#
# Model dimuat sekali saat start, jadi pergantian device tidak bisa berlaku
# seketika: pilihan disimpan lalu helper perlu di-restart. Ekstensi memang
# sudah menyediakan tombol restart, dan responsnya menandai restart_required.
DEVICE_PREF_PATH = Path(os.environ.get("DEVICE_PREF_PATH", Path.home() / ".localtranssub" / "device.json"))
DEVICE_CHOICES = ("auto", "cpu", "cuda")


def _load_device_pref() -> str:
    try:
        if DEVICE_PREF_PATH.is_file():
            d = json.loads(DEVICE_PREF_PATH.read_text(encoding="utf-8")).get("device")
            if d in DEVICE_CHOICES:
                return d
    except Exception:
        pass
    return "auto"


def _save_device_pref(device: str) -> str:
    if device not in DEVICE_CHOICES:
        raise ValueError("device must be auto, cpu, or cuda")
    DEVICE_PREF_PATH.parent.mkdir(parents=True, exist_ok=True)
    DEVICE_PREF_PATH.write_text(json.dumps({"device": device}, ensure_ascii=False), encoding="utf-8")
    return device


def _cuda_available() -> bool:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def _device_state() -> dict:
    """Bentuk yang dipakai ekstensi: preferensi, yang aktif, dan dukungannya."""
    pref = _load_device_pref()
    active = FW_DEVICE or ("apple-silicon" if IS_APPLE_SILICON else "cpu")
    supported = ENGINE == "faster-whisper"
    return {
        "device": pref,
        "active": active,
        "compute": FW_COMPUTE,
        "cuda_available": _cuda_available() if supported else False,
        # Apple Silicon memakai MLX; pilihan CPU/CUDA tidak berlaku di sana.
        "supported": supported,
        "applied": (not supported) or pref == "auto" or pref == active,
    }


def _beam_size() -> int:
    return {"fast": 1, "balanced": 3, "accurate": 5}[_load_engine_mode()]


# ---------------------------------------------------------------------------
# Katalog model yang benar-benar tersedia lokal: pindai cache Hugging Face
# dan cocokkan dengan id model yang dikenal. Best-effort — direktori asing
# dilaporkan apa adanya (id = nama direktori) agar tak ada tebakan ukuran.
def _scan_model_cache() -> list:
    cache = Path(os.environ.get("HF_HUB_CACHE", Path.home() / ".cache" / "huggingface" / "hub"))
    catalog = []
    if not cache.is_dir():
        return catalog
    try:
        entries = sorted(cache.iterdir())
    except OSError:
        return catalog
    for entry in entries:
        if not entry.is_dir() or not entry.name.startswith("models--"):
            continue
        model_id = entry.name[len("models--"):].replace("--", "/", 1)
        total = 0
        files = 0
        snapshots = 0
        try:
            for root, _dirs, names in os.walk(entry):
                for n in names:
                    if n.startswith(".") or n.endswith((".lock", ".metadata")):
                        continue
                    try:
                        st = os.stat(os.path.join(root, n))
                    except OSError:
                        continue
                    total += st.st_size
                    files += 1
            snaps = entry / "snapshots"
            if snaps.is_dir():
                snapshots = sum(1 for s in snaps.iterdir() if s.is_dir())
        except OSError:
            continue
        catalog.append(
            {
                "id": model_id,
                "bytes": total,
                "files": files,
                "snapshots": snapshots,
                "complete": snapshots > 0 and files > 0,
            }
        )
    return catalog


# ---------------------------------------------------------------------------
# Skema dokumen notulen tersimpan (v1 helper):
#   { id:str, title:str, date:str?, source:str, status:str,
#     generatedAt:str, summary:str, decisions:str[≤50], actions:[≤100]{
#       id:str, text:str, owner:str?, due:str?, status:'open'|'closed'},
#     transcriptPreview:str, savedLocally:bool }
# Normalisasi toleran (frontend register v2 mengirim superset) + validasi
# ketat untuk tipe yang salah agar file tidak korup.
def _normalize_note_doc(raw) -> tuple[dict | None, str | None]:
    if not isinstance(raw, dict):
        return None, "note must be a JSON object"
    title = raw.get("title") or "Notulen sesi"
    if not isinstance(title, str):
        return None, "title must be a string"
    summary = raw.get("summary", "")
    if isinstance(summary, dict):
        summary = summary.get("id") or summary.get("en") or next(iter(summary.values()), "")
    if not isinstance(summary, str):
        return None, "summary must be a string"
    decisions = raw.get("decisions", [])
    if not isinstance(decisions, list):
        return None, "decisions must be a list"
    decisions = [str(d).strip() for d in decisions if str(d).strip()][:50]
    actions_in = raw.get("actions", [])
    if not isinstance(actions_in, list):
        return None, "actions must be a list"
    actions = []
    for n, a in enumerate(actions_in[:100], 1):
        if not isinstance(a, dict):
            return None, f"actions[{n}] must be an object"
        text = a.get("text", "")
        if isinstance(text, dict):
            text = text.get("id") or text.get("en") or next(iter(text.values()), "")
        text = str(text).strip()
        if not text:
            continue
        status = a.get("status", "open")
        actions.append(
            {
                "id": str(a.get("id") or f"act-{n}"),
                "text": text,
                "owner": a.get("owner"),
                "due": a.get("due"),
                "status": status if status in ("open", "closed") else "open",
            }
        )
    date = raw.get("date")
    return (
        {
            "id": str(raw.get("id") or f"note-{int(time.time())}"),
            "title": title.strip() or "Notulen sesi",
            "date": str(date) if date else "",
            "source": str(raw.get("source") or "helper"),
            "status": str(raw.get("status") or "ready"),
            "generatedAt": str(
                raw.get("generatedAt") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            ),
            "summary": summary,
            "decisions": decisions,
            "actions": actions,
            "transcriptPreview": str(raw.get("transcriptPreview") or ""),
            "savedLocally": True,
        },
        None,
    )


# ---------------------------------------------------------------------------
# Shared local UI prefs (theme + reskin pattern). Same on-disk home as notes
# so the extension, the helper, and the mac app converge on one file without
# any account, telemetry, or cloud. Extension chrome.storage stays the live
# source of truth; this file is the shared mirror (last writer wins).
UI_PREFS_PATH = Path(os.environ.get("UI_PREFS_PATH", Path.home() / ".localtranssub" / "ui-prefs.json"))
UI_PREFS_THEMES = {"auto", "light", "dark"}
UI_PREFS_RESKINS = {"yraverage", "coretax", "modern"}
UI_PREFS_DEFAULTS = {"theme": "auto", "reskin": "yraverage"}


def _load_ui_prefs() -> tuple[dict, bool]:
    """Return (prefs, stored) — stored is False when no file exists yet."""
    try:
        if UI_PREFS_PATH.is_file():
            raw = json.loads(UI_PREFS_PATH.read_text(encoding="utf-8"))
            prefs = dict(UI_PREFS_DEFAULTS)
            if isinstance(raw.get("prefs"), dict):
                if raw["prefs"].get("theme") in UI_PREFS_THEMES:
                    prefs["theme"] = raw["prefs"]["theme"]
                if raw["prefs"].get("reskin") in UI_PREFS_RESKINS:
                    prefs["reskin"] = raw["prefs"]["reskin"]
            return prefs, True
    except Exception:
        pass
    return dict(UI_PREFS_DEFAULTS), False


def _save_ui_prefs(patch: dict) -> dict:
    prefs, _ = _load_ui_prefs()
    if isinstance(patch, dict):
        if patch.get("theme") in UI_PREFS_THEMES:
            prefs["theme"] = patch["theme"]
        if patch.get("reskin") in UI_PREFS_RESKINS:
            prefs["reskin"] = patch["reskin"]
    UI_PREFS_PATH.parent.mkdir(parents=True, exist_ok=True)
    UI_PREFS_PATH.write_text(
        json.dumps({"updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "prefs": prefs}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return prefs


def _heuristic_notes(lines: list, title: str, source: str) -> dict:
    texts = [str(l.get("text") or l.get("src") or "").strip() for l in lines if isinstance(l, dict)]
    texts = [t for t in texts if t]
    blob = " ".join(texts)
    summary = (
        "Transkrip kosong."
        if not texts
        else (texts[0] if len(texts) == 1 else f"{texts[0]} … {texts[-1]} ({len(texts)} segmen).")
    )
    decisions = []
    for m in re.finditer(r"(?i)\b(keputusan|diputuskan|decision)\b[:\s-]*([^.!?\n]{8,200})", blob):
        decisions.append(m.group(2).strip())
        if len(decisions) >= 8:
            break
    actions = []
    for m in re.finditer(r"(?i)\b(action|tindak lanjut|todo)\b[:\s-]*([^.!?\n]{8,160})", blob):
        actions.append(
            {"id": f"act-{len(actions)+1}", "text": m.group(2).strip(), "owner": None, "due": None, "status": "open"}
        )
        if len(actions) >= 12:
            break
    return {
        "id": f"note-{int(time.time())}",
        "title": title or "Notulen sesi",
        "source": source or "helper",
        "status": "ready",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": summary,
        "decisions": decisions,
        "actions": actions,
        "transcriptPreview": "\n".join(texts[:6]),
        "savedLocally": False,
    }


# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        origin = self.headers.get("Origin", "")
        # Pantulkan asal yang diizinkan, jangan "*": dengan "*" situs web mana
        # pun bisa membaca transkrip & catatan rapat dari helper ini.
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")

    def _local_only(self) -> bool:
        """Tolak apa pun yang bukan benar-benar dari mesin ini.

        Menjawab sendiri (403) dan mengembalikan False bila permintaan ditolak.
        """
        peer = (self.client_address[0] if self.client_address else "") or ""
        if not _is_loopback_host(peer):
            self._json(403, {"error": "helper hanya melayani loopback"})
            return False
        # Header Host: menahan DNS rebinding — situs jahat bisa mengarahkan
        # namanya sendiri ke 127.0.0.1, lalu permintaannya tampak lokal.
        if not _is_loopback_host(_host_header_hostname(self.headers.get("Host", ""))):
            self._json(403, {"error": "header Host bukan loopback"})
            return False
        origin = self.headers.get("Origin", "")
        if origin and not origin_allowed(origin):
            self._json(403, {"error": "asal tidak diizinkan"})
            return False
        return True

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(n) if n else b""

    def _body_to_tempfile(self, suffix: str) -> str:
        """Stream request body to disk — avoids holding multi-GB uploads in RAM."""
        n = int(self.headers.get("Content-Length", "0"))
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            remaining = n
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 8 * 1024 * 1024))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
            return f.name

    def log_message(self, fmt, *args):  # quieter logs
        if os.environ.get("VERBOSE"):
            super().log_message(fmt, *args)

    def do_OPTIONS(self):
        if not self._local_only():
            return
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self._local_only():
            return
        u = urlparse(self.path)
        if u.path == "/engine/device":
            return self._json(200, _device_state())
        if u.path == "/health":
            return self._json(
                200,
                {
                    "ok": True,
                    "engine": ENGINE,
                    "engine_label": ENGINE,
                    "model": MODEL,
                    "ffmpeg": FFMPEG,
                    "translate": _translate_available,
                    "translate_model": TRANSLATE_MODEL if _translate_available else None,
                    "draft_model": DRAFT_MODEL if _draft_available else None,
                    "device": FW_DEVICE or ("apple-silicon" if IS_APPLE_SILICON else "cpu"),
                    "compute": FW_COMPUTE,
                    "engine_mode": _load_engine_mode(),
                    "platform": platform.system().lower(),
                    "features": {
                        "fast_translate": True,
                        "translate_refine": _translate_available,
                        "draft": _draft_available and _translate_available,
                        "notes": True,
                        "transcribe_file_jobs": True,
                        "streaming_file_jobs": True,
                        "faster_whisper": ENGINE == "faster-whisper",
                        "ui_prefs": True,
                        "models": True,
                    },
                },
            )
        if u.path == "/notes":
            return self._json(200, {"notes": _load_notes()})
        if u.path == "/models":
            return self._json(200, {"models": _model_inventory(), "cached": _scan_model_cache()})
        if u.path == "/engine/mode":
            return self._json(200, {"mode": _load_engine_mode()})
        if u.path == "/languages/targets":
            return self._json(200, {"targets": _target_status(), "engine": ENGINE})
        if u.path.startswith("/notes/"):
            note_id = unquote(u.path.split("/", 2)[-1])
            if "/" in note_id or not note_id:
                return self._json(404, {"error": "not found"})
            notes = _load_notes()
            note = next((n for n in notes if n.get("id") == note_id), None)
            if not note:
                return self._json(404, {"error": "note not found"})
            return self._json(200, {"note": note})
        if u.path == "/ui-prefs":
            prefs, stored = _load_ui_prefs()
            return self._json(200, {"prefs": prefs, "stored": stored})
        if u.path.startswith("/jobs/"):
            job_id = u.path.split("/", 2)[-1]
            with _jobs_lock:
                job = _jobs.get(job_id)
            if not job:
                return self._json(404, {"error": "job not found"})
            return self._json(200, job)
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._local_only():
            return
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        language = q.get("language", "auto")
        task = q.get("task", "transcribe")
        if task not in ("transcribe", "translate"):
            task = "transcribe"
        try:
            if u.path == "/engine/device":
                body = self._body()
                try:
                    want = json.loads(body.decode("utf-8") or "{}").get("device")
                except Exception:
                    return self._json(400, {"error": "body harus JSON {\"device\": ...}"})
                state = _device_state()
                if not state["supported"]:
                    # Apple Silicon memakai MLX; jangan berpura-pura menerima.
                    return self._json(200, {
                        "ok": False, "supported": False, "device": state["device"],
                        "reason": "engine ini tidak memakai faster-whisper", "restart_required": False,
                    })
                try:
                    saved = _save_device_pref(want)
                except ValueError as e:
                    return self._json(400, {"error": str(e)})
                if saved == "cuda" and not state["cuda_available"]:
                    return self._json(200, {
                        "ok": True, "supported": True, "device": saved,
                        "warning": "CUDA tidak terdeteksi — helper akan jatuh ke CPU saat start",
                        "restart_required": True,
                    })
                return self._json(200, {
                    "ok": True, "supported": True, "device": saved,
                    # Model dimuat sekali saat start; pergantian butuh restart.
                    "restart_required": saved != state["active"],
                })
            if u.path == "/transcribe":
                raw = self._body()
                audio = np.frombuffer(raw, dtype=np.float32)
                if audio.size < 1600:
                    return self._json(200, {"text": ""})
                t0 = time.time()
                text = asr_array(audio, language, task)
                return self._json(200, {"text": text, "ms": int((time.time() - t0) * 1000)})

            if u.path == "/transcribe_file":
                if not FFMPEG:
                    return self._json(
                        500, {"error": "ffmpeg not installed (brew install ffmpeg) — needed to decode media files"}
                    )
                name = q.get("filename") or "input.bin"
                suffix = os.path.splitext(name)[1] or ".bin"
                path = self._body_to_tempfile(suffix)
                try:
                    t0 = time.time()
                    segs = asr_file(path, language, task)
                    return self._json(
                        200, {"segments": segs, "ms": int((time.time() - t0) * 1000)}
                    )
                finally:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass

            if u.path == "/translate":
                if not _translate_available:
                    return self._json(501, {"error": "no translation model (install mlx-lm)"})
                text = self._body().decode("utf-8", "replace")
                src, tgt = _norm_lang(q.get("src"), fallback="auto"), _norm_lang(
                    q.get("tgt"), fallback="en"
                )
                # Mode accurate mengunci kualitas penuh (abaikan fast=1).
                fast = q.get("fast", "0") in ("1", "true", "yes") and _load_engine_mode() != "accurate"
                if not text.strip():
                    return self._json(200, {"text": ""})
                t0 = time.time()
                out = translate_text(text, src, tgt, fast=fast)
                return self._json(200, {"text": out, "ms": int((time.time() - t0) * 1000)})

            if u.path == "/draft":
                raw = self._body()
                audio = np.frombuffer(raw, dtype=np.float32)
                if audio.size < 1600:
                    return self._json(200, {"source": "", "translation": ""})
                src, tgt = _norm_lang(q.get("src"), fallback="auto"), _norm_lang(
                    q.get("tgt"), fallback="en"
                )
                language = q.get("language", src)
                t0 = time.time()
                out = draft_pipeline(audio, language, src, tgt)
                if "ms" not in out:
                    out["ms"] = int((time.time() - t0) * 1000)
                return self._json(200, out)

            if u.path == "/translate_refine":
                if not _translate_available:
                    return self._json(501, {"error": "no translation model (install mlx-lm)"})
                try:
                    payload = json.loads(self._body().decode("utf-8", "replace") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "invalid JSON body"})
                text = (payload.get("text") or "").strip()
                draft = (payload.get("draft") or "").strip()
                src, tgt = _norm_lang(q.get("src"), fallback="auto"), _norm_lang(
                    q.get("tgt"), fallback="en"
                )
                if not text:
                    return self._json(200, {"text": draft})
                return self._json(200, {"text": refine_text(text, draft, src, tgt)})

            if u.path == "/shutdown":
                def _stop():
                    time.sleep(0.15)
                    os._exit(0)

                threading.Thread(target=_stop, daemon=True).start()
                return self._json(200, {"ok": True, "shutting_down": True})

            if u.path == "/notes/generate":
                try:
                    payload = json.loads(self._body().decode("utf-8", "replace") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "invalid JSON body"})
                note = _heuristic_notes(
                    payload.get("lines") or [],
                    payload.get("title") or "Notulen sesi",
                    payload.get("source") or "helper",
                )
                return self._json(200, {"note": note})

            if u.path == "/notes/summarize":
                # Ringkasan otomatis transkrip TANPA menyimpan: untuk draf panel.
                try:
                    payload = json.loads(self._body().decode("utf-8", "replace") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "invalid JSON body"})
                lines = payload.get("lines") or []
                if not isinstance(lines, list) or not lines:
                    return self._json(400, {"error": "body needs non-empty lines[]"})
                note = _heuristic_notes(
                    lines,
                    payload.get("title") or "Notulen sesi",
                    payload.get("source") or "helper",
                )
                return self._json(
                    200,
                    {
                        "summary": note["summary"],
                        "decisions": note["decisions"],
                        "actions": note["actions"],
                        "counts": {
                            "segments": len(lines),
                            "decisions": len(note["decisions"]),
                            "actions": len(note["actions"]),
                        },
                    },
                )

            if u.path == "/engine/mode":
                try:
                    payload = json.loads(self._body().decode("utf-8", "replace") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "invalid JSON body"})
                if not isinstance(payload, dict) or payload.get("mode") not in ENGINE_MODES:
                    return self._json(400, {"error": "mode must be fast, balanced, or accurate"})
                return self._json(200, {"ok": True, "mode": _save_engine_mode(payload["mode"])})

            if u.path == "/ui-prefs":
                try:
                    payload = json.loads(self._body().decode("utf-8", "replace") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "invalid JSON body"})
                if not isinstance(payload, dict) or (
                    "theme" not in payload and "reskin" not in payload
                ):
                    return self._json(400, {"error": "body needs theme and/or reskin"})
                prefs = _save_ui_prefs(payload)
                return self._json(200, {"ok": True, "prefs": prefs, "stored": True})

            if u.path == "/models/pull":
                # Pemasangan model lokal: hanya id dari inventaris /models (allowlist).
                try:
                    payload = json.loads(self._body().decode("utf-8", "replace") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "invalid JSON body"})
                want = (payload.get("id") or "").strip() if isinstance(payload, dict) else ""
                allowed = {m["id"] for m in _model_inventory() if m.get("id")}
                if not want or want not in allowed:
                    return self._json(400, {"error": "id must be one of the /models inventory ids"})
                try:
                    from huggingface_hub import snapshot_download

                    path = snapshot_download(repo_id=want)
                except Exception as e:  # noqa: BLE001
                    return self._json(502, {"error": f"download failed: {e}"})
                total = 0
                for root, _dirs, names in os.walk(path):
                    for n in names:
                        if n.startswith(".") or n.endswith((".lock", ".metadata")):
                            continue
                        try:
                            total += os.stat(os.path.join(root, n)).st_size
                        except OSError:
                            continue
                return self._json(200, {"ok": True, "id": want, "path": path, "bytes": total})

            if u.path == "/notes/export":
                try:
                    payload = json.loads(self._body().decode("utf-8", "replace") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "invalid JSON body"})
                fmt = (payload.get("format") or "md").lower()
                if fmt not in ("txt", "md"):
                    return self._json(400, {"error": 'format must be "txt" or "md"'})
                note = None
                if isinstance(payload.get("note"), dict):
                    note, err = _normalize_note_doc(payload["note"])
                    if err:
                        return self._json(400, {"error": err})
                elif payload.get("id"):
                    note = next(
                        (n for n in _load_notes() if n.get("id") == payload["id"]), None
                    )
                    if not note:
                        return self._json(404, {"error": "note not found"})
                else:
                    return self._json(400, {"error": "body needs id or note"})
                safe = re.sub(r"[^\w.-]+", "_", note.get("title") or note["id"])[:60] or "notes"
                content = _export_note_txt(note) if fmt == "txt" else _export_note_md(note)
                return self._json(200, {"filename": f"{safe}.{fmt}", "content": content})

            if u.path == "/notes":
                try:
                    payload = json.loads(self._body().decode("utf-8", "replace") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "invalid JSON body"})
                note, err = _normalize_note_doc(payload.get("note") or payload)
                if err:
                    return self._json(400, {"error": err})
                notes = _load_notes()
                notes = [n for n in notes if n.get("id") != note.get("id")]
                notes.insert(0, note)
                _save_notes(notes[:50])
                return self._json(200, {"ok": True, "note": note})

            if u.path == "/transcribe_file_job":
                # Async job wrapper for large files: streams body to disk, reports progress.
                if not FFMPEG:
                    return self._json(500, {"error": "ffmpeg not installed"})
                name = q.get("filename") or "input.bin"
                suffix = os.path.splitext(name)[1] or ".bin"
                job_id = f"job-{int(time.time() * 1000)}"
                path = self._body_to_tempfile(suffix)
                size = os.path.getsize(path)
                with _jobs_lock:
                    _jobs[job_id] = {
                        "id": job_id,
                        "status": "running",
                        "progress": 0.05,
                        "filename": name,
                        "sizeBytes": size,
                        "segments": None,
                        "partialSegments": 0,
                        "streaming": False,
                        "error": None,
                        "cancel": False,
                    }

                def _run(jid=job_id, p=path, lang=language, tsk=task, nbytes=size):
                    def cancelled():
                        with _jobs_lock:
                            return bool(_jobs[jid].get("cancel"))

                    try:
                        if cancelled():
                            with _jobs_lock:
                                _jobs[jid]["status"] = "cancelled"
                            return
                        with _jobs_lock:
                            _jobs[jid]["progress"] = 0.1
                        if nbytes >= STREAM_MIN_BYTES:
                            # Berkas besar: jendela demi jendela supaya RAM tetap
                            # datar dan hasil sebagian bisa dilihat lebih awal.
                            with _jobs_lock:
                                _jobs[jid]["streaming"] = True

                            def progress(frac, partial):
                                with _jobs_lock:
                                    if frac is not None:
                                        _jobs[jid]["progress"] = max(0.1, frac)
                                    _jobs[jid]["segments"] = list(partial)
                                    _jobs[jid]["partialSegments"] = len(partial)

                            segs = asr_file_streaming(p, lang, tsk, on_progress=progress, should_cancel=cancelled)
                        else:
                            with _jobs_lock:
                                _jobs[jid]["progress"] = 0.2
                            segs = asr_file(p, lang, tsk)
                        with _jobs_lock:
                            if _jobs[jid].get("cancel"):
                                _jobs[jid]["status"] = "cancelled"
                            else:
                                _jobs[jid].update(
                                    {"status": "done", "progress": 1.0, "segments": segs}
                                )
                    except JobCancelled:
                        with _jobs_lock:
                            _jobs[jid]["status"] = "cancelled"
                    except Exception as exc:  # noqa: BLE001
                        with _jobs_lock:
                            _jobs[jid].update({"status": "error", "error": str(exc)})
                    finally:
                        try:
                            os.unlink(p)
                        except OSError:
                            pass

                threading.Thread(target=_run, daemon=True).start()
                return self._json(202, {"jobId": job_id})

            if u.path.startswith("/jobs/") and u.path.endswith("/cancel"):
                job_id = u.path.split("/")[2]
                with _jobs_lock:
                    job = _jobs.get(job_id)
                    if not job:
                        return self._json(404, {"error": "job not found"})
                    job["cancel"] = True
                    if job["status"] == "running":
                        job["status"] = "cancelling"
                return self._json(200, {"ok": True, "jobId": job_id})

            self._json(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def do_DELETE(self):
        if not self._local_only():
            return
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path.startswith("/models/cache/"):
            # Hapus cache model lokal. Pengaman: id inventaris aktif DITOLAK
            # (helper akan rusak) + butuh ?confirm=1 eksplisit.
            slug = unquote(u.path.split("/", 3)[-1])
            if not slug or "/" in slug or slug in ("generate", "summarize"):
                return self._json(404, {"error": "not found"})
            model_id = slug.replace("--", "/", 1)
            if "/" not in model_id:
                return self._json(400, {"error": "id must look like org--name"})
            active = {m["id"] for m in _model_inventory() if m.get("id")}
            if model_id in active:
                return self._json(400, {"error": "refusing to delete an active inventory model"})
            if q.get("confirm") not in ("1", "true", "yes"):
                return self._json(400, {"error": "add ?confirm=1 to delete cached model"})
            cache = Path(os.environ.get("HF_HUB_CACHE", Path.home() / ".cache" / "huggingface" / "hub"))
            target = cache / f"models--{slug}"
            try:
                resolved = target.resolve()
            except OSError:
                return self._json(404, {"error": "cached model not found"})
            if resolved.parent != cache.resolve() or not target.is_dir():
                return self._json(404, {"error": "cached model not found"})
            freed = 0
            for root, _dirs, names in os.walk(target):
                for n in names:
                    try:
                        freed += os.stat(os.path.join(root, n)).st_size
                    except OSError:
                        continue
            try:
                shutil.rmtree(target)
            except OSError as e:  # noqa: BLE001
                return self._json(500, {"error": f"delete failed: {e}"})
            return self._json(200, {"ok": True, "id": model_id, "freedBytes": freed})
        if u.path.startswith("/notes/"):
            note_id = unquote(u.path.split("/", 2)[-1])
            if not note_id or "/" in note_id:
                return self._json(404, {"error": "not found"})
            notes = _load_notes()
            kept = [n for n in notes if n.get("id") != note_id]
            if len(kept) == len(notes):
                return self._json(404, {"error": "note not found"})
            _save_notes(kept)
            return self._json(200, {"ok": True, "id": note_id})
        self._json(404, {"error": "not found"})


def warmup():
    try:
        print(f"[warmup] loading {MODEL} …", flush=True)
        asr_array(np.zeros(16000, dtype=np.float32), "en", "transcribe")
        if _draft_available:
            print(f"[warmup] loading draft ASR {DRAFT_MODEL} …", flush=True)
            draft_asr_array(
                (np.random.randn(8000).astype(np.float32) * 0.01), "en", "transcribe"
            )
            _ensure_draft_warm()
        if _translate_available:
            print(f"[warmup] loading {TRANSLATE_MODEL} …", flush=True)
            translate_text("hello", "en", "en", fast=True)
            translate_text("今日はいい天気です。", "ja", "en", fast=True)
        print("[warmup] ready ✅", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[warmup] failed: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    draft_note = f" draft={DRAFT_MODEL}" if _draft_available else ""
    print(f"yraverageSubMin native helper — engine={ENGINE} model={MODEL}{draft_note} ffmpeg={FFMPEG} "
          f"translate={'on' if _translate_available else 'off'}")
    srv = ReuseHTTPServer((HOST, PORT), Handler)
    print(f"listening on http://{HOST}:{PORT}   (Ctrl-C to stop)", flush=True)
    threading.Thread(target=warmup, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
