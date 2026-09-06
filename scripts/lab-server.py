#!/usr/bin/env python3
"""Translation Lab server — static files + YouTube audio proxy (yt-dlp).

Browsers cannot fetch YouTube directly (CORS + signed streams). This server
extracts audio locally and serves mono 16 kHz WAV to the lab UI.

  GET /api/youtube-audio?url=<youtube_url>  → audio/wav (cached)
  GET /api/youtube-info?url=<youtube_url>   → {id, title, duration, cached}
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST_DIR = ROOT / "test"
CACHE_DIR = ROOT / ".lab-cache" / "youtube"
COOKIES_PATH = ROOT / ".lab-cache" / "youtube-cookies.txt"
HOST = os.environ.get("LAB_HOST", "127.0.0.1")
PORT = int(os.environ.get("LAB_PORT", "8799"))

_yt_lock = threading.Lock()
_yt_dlp_cmd: list[str] | None = None

# macOS Python often lacks SSL roots; local lab only.
YTDLP_EXTRA = ["--no-check-certificates"] if os.environ.get("YT_DLP_CHECK_CERT", "0") != "1" else []

YTDLP_CLIENTS: list[list[str]] = [
    ["--extractor-args", "youtube:player_client=android"],
    ["--extractor-args", "youtube:player_client=ios"],
    ["--extractor-args", "youtube:player_client=mweb"],
    ["--extractor-args", "youtube:player_client=web"],
]


def discover_browser_profiles() -> list[str]:
    """Find local browser profiles that may have a signed-in YouTube session."""
    found: list[str] = []
    home = Path.home()
    candidates = [
        (home / "Library/Application Support/Google/Chrome", "chrome"),
        (home / "Library/Application Support/BraveSoftware/Brave-Browser", "brave"),
        (home / "Library/Application Support/Microsoft Edge", "edge"),
        (home / "Library/Application Support/Firefox/Profiles", "firefox"),
    ]
    for base, browser in candidates:
        if not base.exists():
            continue
        if browser == "firefox":
            for prof in base.iterdir():
                if prof.is_dir() and (prof / "cookies.sqlite").exists():
                    found.append(f"firefox:{prof.name}")
            continue
        for prof in ["Default", "Profile 1", "Profile 2", "Profile 3", "Profile 4"]:
            if (base / prof / "Cookies").exists():
                found.append(f"{browser}:{prof}")
    # Explicit env override first
    for b in [x.strip() for x in os.environ.get("YT_DLP_BROWSER", "").split(",") if x.strip()]:
        spec = b if ":" in b else f"chrome:{b}"
        if spec not in found:
            found.append(spec)
    return found


def build_ytdlp_strategies() -> list[list[str]]:
    strategies: list[list[str]] = []
    env_cookies = os.environ.get("YT_DLP_COOKIES_FILE", "").strip()
    if env_cookies and Path(env_cookies).exists():
        strategies.append(["--cookies", env_cookies])
    if COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 100:
        strategies.append(["--cookies", str(COOKIES_PATH)])
    for spec in discover_browser_profiles():
        strategies.append(["--cookies-from-browser", spec])
    strategies.extend(YTDLP_CLIENTS)
    for b in ["chrome", "safari", "firefox", "brave", "edge"]:
        strat = ["--cookies-from-browser", b]
        if strat not in strategies:
            strategies.append(strat)
    strategies.append([])
    return strategies


def ytdlp_run(base_cmd: list[str], args: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run yt-dlp, retrying with fallback strategies on YouTube bot/403 errors."""
    last = None
    for strategy in build_ytdlp_strategies():
        proc = subprocess.run([*base_cmd, *YTDLP_EXTRA, *strategy, *args], **kwargs)
        if proc.returncode == 0:
            return proc
        last = proc
        err = (proc.stderr or proc.stdout or "").lower()
        if not any(x in err for x in ("bot", "403", "sign in", "confirm", "cookies")):
            return proc
    return last  # type: ignore[return-value]


def youtube_auth_status() -> dict:
    profiles = discover_browser_profiles()
    has_cookies = COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 100
    return {
        "cookies_file": has_cookies,
        "cookies_path": str(COOKIES_PATH) if has_cookies else None,
        "browser_profiles": profiles,
        "hint": (
            "Upload cookies.txt (signed-in YouTube) or use extension tab capture."
            if not has_cookies
            else "cookies.txt loaded — retry YouTube Load."
        ),
    }


def find_yt_dlp() -> list[str]:
    global _yt_dlp_cmd
    if _yt_dlp_cmd is not None:
        return _yt_dlp_cmd
    # Prefer standalone binary (Homebrew) over python -m on macOS.
    for cmd in (["yt-dlp"], [sys.executable, "-m", "yt_dlp"]):
        try:
            subprocess.run(
                [*cmd, *YTDLP_EXTRA, "--version"], capture_output=True, check=True, timeout=10
            )
            _yt_dlp_cmd = cmd
            return cmd
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            continue
    raise RuntimeError(
        "yt-dlp not found. Install with: pip install yt-dlp   or   brew install yt-dlp"
    )


def youtube_id(url: str) -> str | None:
    url = url.strip()
    if not url:
        return None
    # youtu.be/ID
    m = re.search(r"youtu\.be/([A-Za-z0-9_-]{6,})", url)
    if m:
        return m.group(1)
    # youtube.com/watch?v=ID
    m = re.search(r"[?&]v=([A-Za-z0-9_-]{6,})", url)
    if m:
        return m.group(1)
    # youtube.com/embed/ID
    m = re.search(r"youtube\.com/embed/([A-Za-z0-9_-]{6,})", url)
    if m:
        return m.group(1)
    # youtube.com/shorts/ID
    m = re.search(r"youtube\.com/shorts/([A-Za-z0-9_-]{6,})", url)
    if m:
        return m.group(1)
    return None


def is_youtube(url: str) -> bool:
    return youtube_id(url) is not None


def cache_paths(vid: str) -> tuple[Path, Path]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    base = CACHE_DIR / vid
    return base.with_suffix(".wav"), base.with_suffix(".json")


def ff16k_mono(src: Path, dst: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found (brew install ffmpeg)")
    subprocess.run(
        [ffmpeg, "-y", "-i", str(src), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(dst)],
        capture_output=True,
        check=True,
        timeout=300,
    )


def fetch_youtube_meta(url: str) -> dict:
    vid = youtube_id(url)
    if not vid:
        raise ValueError("Could not parse YouTube video ID from URL")
    ytdlp = find_yt_dlp()
    meta_proc = ytdlp_run(
        ytdlp,
        ["--dump-json", "--no-playlist", url],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if meta_proc.returncode != 0:
        err = (meta_proc.stderr or meta_proc.stdout or "yt-dlp failed").strip()
        # Trim noisy yt-dlp warnings for JSON error responses
        if "ERROR:" in err:
            err = err[err.index("ERROR:") :].strip()
        raise RuntimeError(err[:500])
    info = json.loads(meta_proc.stdout.strip().splitlines()[0])
    wav_path, _ = cache_paths(vid)
    return {
        "id": vid,
        "title": info.get("title") or vid,
        "duration": info.get("duration"),
        "url": url,
        "cached": wav_path.exists(),
    }


def download_youtube_wav(url: str) -> tuple[Path, dict]:
    vid = youtube_id(url)
    if not vid:
        raise ValueError("Could not parse YouTube video ID from URL")

    wav_path, meta_path = cache_paths(vid)
    if wav_path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["cached"] = True
        return wav_path, meta

    ytdlp = find_yt_dlp()
    with _yt_lock:
        # Re-check after acquiring lock
        if wav_path.exists() and meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["cached"] = True
            return wav_path, meta

        meta = fetch_youtube_meta(url)
        with tempfile.TemporaryDirectory(prefix="lab-yt-") as tmp:
            tmpdir = Path(tmp)
            out_tpl = str(tmpdir / "audio.%(ext)s")
            t0 = time.time()

            dl = ytdlp_run(
                ytdlp,
                [
                    "--no-playlist",
                    "-f",
                    "bestaudio/best",
                    "-o",
                    out_tpl,
                    url,
                ],
                capture_output=True,
                text=True,
                timeout=600,
            )
            if dl.returncode != 0:
                err = (dl.stderr or dl.stdout or "yt-dlp download failed").strip()
                if "ERROR:" in err:
                    err = err[err.index("ERROR:") :].strip()
                raise RuntimeError(err[:500])

            candidates = list(tmpdir.glob("audio.*"))
            if not candidates:
                raise RuntimeError("yt-dlp produced no output file")
            raw = candidates[0]
            wav_path.parent.mkdir(parents=True, exist_ok=True)
            ff16k_mono(raw, wav_path)

            meta["ms"] = int((time.time() - t0) * 1000)
            meta["cached"] = False
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            return wav_path, meta


MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".wasm": "application/wasm",
    ".onnx": "application/octet-stream",
    ".map": "application/json",
}


class LabHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(TEST_DIR), **kwargs)

    def log_message(self, fmt, *args):
        if os.environ.get("LAB_VERBOSE"):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Never cache: this server exists to show the CURRENT build. Without
        # this the handler sends only Last-Modified, so browsers heuristically
        # cache /dist/*.js and /chrome-mock.js and keep serving a stale copy
        # after a rebuild — the page looks unchanged and the edit appears lost.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/youtube-auth":
            return self._json(200, youtube_auth_status())
        if parsed.path == "/api/youtube-info":
            return self._youtube_info(parsed)
        if parsed.path == "/api/youtube-audio":
            return self._youtube_audio(parsed)
        # Browser harnesses load built UI + source via absolute /dist and /src.
        if parsed.path == "/dist" or parsed.path.startswith("/dist/"):
            return self._serve_under(ROOT / "dist", parsed.path[len("/dist") :].lstrip("/"))
        if parsed.path == "/src" or parsed.path.startswith("/src/"):
            return self._serve_under(ROOT / "src", parsed.path[len("/src") :].lstrip("/"))
        # Panduan pengguna hidup di docs/ dan dibaca guide.html lewat fetch,
        # supaya dokumen dan halaman yang menampilkannya tidak pernah menyimpang.
        if parsed.path == "/docs" or parsed.path.startswith("/docs/"):
            return self._serve_under(ROOT / "docs", parsed.path[len("/docs") :].lstrip("/"))
        # Panduan pengguna menautkan native/SETUP.md; tanpa rute ini tautannya 404.
        if parsed.path == "/native" or parsed.path.startswith("/native/"):
            return self._serve_under(ROOT / "native", parsed.path[len("/native") :].lstrip("/"))
        return super().do_GET()

    def _serve_under(self, base: Path, rel: str):
        """Serve a file under base; rejects path traversal. 404 if missing."""
        root = base.resolve()
        if not rel:
            self.send_error(404)
            return
        target = (root / rel).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            self.send_error(403)
            return
        if not target.is_file():
            self.send_error(404)
            return
        data = target.read_bytes()
        ctype = MIME.get(target.suffix.lower(), "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/youtube-cookies":
            return self._youtube_cookies()
        self.send_error(404)

    def _youtube_cookies(self):
        n = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(n) if n else b""
        if len(body) < 50:
            return self._json(400, {"error": "cookies.txt too small — export while signed in to YouTube"})
        COOKIES_PATH.parent.mkdir(parents=True, exist_ok=True)
        COOKIES_PATH.write_bytes(body)
        return self._json(200, {"ok": True, **youtube_auth_status()})

    def _youtube_info(self, parsed):
        url = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
        try:
            if not is_youtube(url):
                return self._json(400, {"error": "Not a YouTube URL"})
            meta = fetch_youtube_meta(url)
            return self._json(200, meta)
        except Exception as e:  # noqa: BLE001
            return self._json(500, {"error": _yt_error_hint(str(e))})

    def _youtube_audio(self, parsed):
        url = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
        try:
            if not is_youtube(url):
                return self._json(400, {"error": "Not a YouTube URL"})
            wav_path, meta = download_youtube_wav(url)
            data = wav_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            return self._json(500, {"error": _yt_error_hint(str(e))})

    def _json(self, code: int, obj: dict):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _yt_error_hint(msg: str) -> str:
    if "bot" in msg.lower() or "sign in" in msg.lower():
        return (
            msg
            + " | Fix: upload cookies.txt in the lab (Chrome extension “Get cookies.txt LOCALLY”, "
            "signed in to YouTube), or use ./scripts/dev-browser.sh + extension tab capture."
        )
    return msg


def main():
    print(f"Translation Lab server → http://{HOST}:{PORT}/lab.html")
    print(f"Browser app UI       → http://{HOST}:{PORT}/app.html")
    print(f"YouTube proxy: GET /api/youtube-audio?url=...")
    try:
        find_yt_dlp()
        print("yt-dlp: OK")
    except RuntimeError as e:
        print(f"WARN: {e}", file=sys.stderr)
    srv = ThreadingHTTPServer((HOST, PORT), LabHandler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
