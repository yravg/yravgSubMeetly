#!/usr/bin/env python3
"""Local TransSub native helper.

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
"""
import io
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
from urllib.parse import parse_qs, urlparse

# Prefer resumable classic HTTP downloads over the flaky Xet/CAS backend.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

import numpy as np


class ReuseHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True

HOST = os.environ.get("HOST", "127.0.0.1")
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
        _fw_device = os.environ.get("DEVICE") or ("cuda" if _cuda else "cpu")
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


def asr_array(audio: np.ndarray, language, task):
    """audio: float32 mono 16 kHz → text"""
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
            return (r.get("text") or "").strip()
        segs, _ = _fw.transcribe(
            audio, language=_lang(language), task=task, beam_size=1, vad_filter=False
        )
        return " ".join(s.text.strip() for s in segs).strip()


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
        segs, _ = _fw.transcribe(path, language=_lang(language), task=task, beam_size=1)
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
    """One-shot live draft: fast ASR + fast translate (~0.3–0.5 s on Apple Silicon)."""
    _ensure_draft_warm()
    t0 = time.time()
    t_asr = time.time()
    if _draft_available:
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
    translation = translate_text(source, src, tgt, fast=True)
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")

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
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
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
                    "platform": platform.system().lower(),
                    "features": {
                        "fast_translate": True,
                        "translate_refine": _translate_available,
                        "draft": _draft_available and _translate_available,
                        "notes": True,
                        "transcribe_file_jobs": True,
                        "faster_whisper": ENGINE == "faster-whisper",
                    },
                },
            )
        if u.path == "/notes":
            return self._json(200, {"notes": _load_notes()})
        if u.path.startswith("/jobs/"):
            job_id = u.path.split("/", 2)[-1]
            with _jobs_lock:
                job = _jobs.get(job_id)
            if not job:
                return self._json(404, {"error": "job not found"})
            return self._json(200, job)
        self._json(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        language = q.get("language", "auto")
        task = q.get("task", "transcribe")
        if task not in ("transcribe", "translate"):
            task = "transcribe"
        try:
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
                src, tgt = q.get("src", "auto"), q.get("tgt", "en")
                fast = q.get("fast", "0") in ("1", "true", "yes")
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
                src, tgt = q.get("src", "auto"), q.get("tgt", "en")
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
                src, tgt = q.get("src", "auto"), q.get("tgt", "en")
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

            if u.path == "/notes":
                try:
                    payload = json.loads(self._body().decode("utf-8", "replace") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "invalid JSON body"})
                note = payload.get("note") or payload
                notes = _load_notes()
                notes = [n for n in notes if n.get("id") != note.get("id")]
                note["savedLocally"] = True
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
                        "error": None,
                        "cancel": False,
                    }

                def _run(jid=job_id, p=path, lang=language, tsk=task):
                    try:
                        with _jobs_lock:
                            if _jobs[jid].get("cancel"):
                                _jobs[jid]["status"] = "cancelled"
                                return
                            _jobs[jid]["progress"] = 0.2
                        segs = asr_file(p, lang, tsk)
                        with _jobs_lock:
                            if _jobs[jid].get("cancel"):
                                _jobs[jid]["status"] = "cancelled"
                            else:
                                _jobs[jid].update(
                                    {"status": "done", "progress": 1.0, "segments": segs}
                                )
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
    print(f"Local TransSub native helper — engine={ENGINE} model={MODEL}{draft_note} ffmpeg={FFMPEG} "
          f"translate={'on' if _translate_available else 'off'}")
    srv = ReuseHTTPServer((HOST, PORT), Handler)
    print(f"listening on http://{HOST}:{PORT}   (Ctrl-C to stop)", flush=True)
    threading.Thread(target=warmup, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
