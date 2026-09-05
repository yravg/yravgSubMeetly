#!/usr/bin/env python3
"""Chrome Native Messaging host — start / stop / restart the Local TransSub helper."""
import json
import os
import platform
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

DIR = Path(__file__).resolve().parent
ROOT = DIR.parent
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "17865"))
LAB_PORT = int(os.environ.get("LAB_PORT", "8799"))
BASE = f"http://{HOST}:{PORT}"
LAB_URL = f"http://127.0.0.1:{LAB_PORT}/lab.html"
LOG = ROOT / ".native-server.log"
HOST_NAME = "com.localtranssub.helper"
# Dinaikkan bila bentuk pesan berubah; ekstensi memakainya untuk mendeteksi
# host lama yang belum mengenal aksi baru.
HOST_PROTOCOL = 1
START_WAIT_SEC = int(os.environ.get("NATIVE_START_WAIT", "120"))
PORT_FREE_WAIT_SEC = int(os.environ.get("NATIVE_PORT_FREE_WAIT", "15"))

_proc = None
_lock = threading.Lock()


def host_info():
    """Identitas host — cukup untuk membedakan 'bridge hidup' dari 'helper jalan'."""
    return {
        "host": HOST_NAME,
        "protocol": HOST_PROTOCOL,
        "python": platform.python_version(),
        "platform": sys.platform,
        "root": str(ROOT),
        "port": PORT,
    }


def read_msg():
    raw = sys.stdin.buffer.read(4)
    if not raw:
        sys.exit(0)
    n = struct.unpack("=I", raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode("utf-8"))


def write_msg(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def health():
    try:
        with urllib.request.urlopen(f"{BASE}/health", timeout=1.5) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def shutdown():
    try:
        req = urllib.request.Request(f"{BASE}/shutdown", method="POST", data=b"")
        with urllib.request.urlopen(req, timeout=3):
            return True
    except Exception:
        return False


def port_open():
    try:
        with socket.create_connection((HOST, PORT), timeout=0.35):
            return True
    except OSError:
        return False


def wait_port_free(timeout_sec=PORT_FREE_WAIT_SEC):
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if not port_open():
            return True
        time.sleep(0.25)
    return not port_open()


def kill_port_listeners():
    if sys.platform not in ("darwin", "linux") and not sys.platform.startswith("linux"):
        return
    try:
        pids = subprocess.check_output(
            ["lsof", "-ti", f"tcp:{PORT}"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return
    for pid in pids.split():
        try:
            os.kill(int(pid), signal.SIGTERM)
        except (ProcessLookupError, ValueError, PermissionError):
            pass


def force_stop():
    shutdown()
    if wait_port_free():
        return True
    kill_port_listeners()
    time.sleep(0.4)
    return wait_port_free(8)


def _log_tail(n=8):
    try:
        lines = LOG.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(lines[-n:]) if lines else ""
    except OSError:
        return ""


def lab_running():
    try:
        with urllib.request.urlopen(LAB_URL, timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_lab():
    if lab_running():
        return True
    script = ROOT / "scripts" / "ensure-lab.sh"
    if not script.is_file():
        return False
    try:
        subprocess.run(
            ["/bin/bash", str(script)],
            cwd=str(ROOT),
            timeout=45,
            check=False,
        )
    except Exception:
        return False
    return lab_running()


def start_server():
    global _proc
    with _lock:
        h = health()
        if h:
            ensure_lab()
            return {"ok": True, "running": True, "health": h, "already": True}
        if port_open() and not h:
            force_stop()
        if _proc and _proc.poll() is None:
            pass
        else:
            run_sh = DIR / "run.sh"
            LOG.parent.mkdir(parents=True, exist_ok=True)
            log_f = open(LOG, "a", encoding="utf-8")  # noqa: SIM115
            log_f.write(f"\n--- native host launch {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
            log_f.flush()
            _proc = subprocess.Popen(
                ["/bin/bash", str(run_sh)],
                cwd=str(DIR),
                stdout=log_f,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
    deadline = time.time() + START_WAIT_SEC
    while time.time() < deadline:
        time.sleep(0.5)
        h = health()
        if h:
            ensure_lab()
            return {"ok": True, "running": True, "health": h}
        if _proc and _proc.poll() is not None:
            tail = _log_tail()
            err = "helper process exited early"
            if tail:
                err += f" — see .native-server.log:\n{tail}"
            return {"ok": False, "running": False, "error": err}
    tail = _log_tail()
    err = f"timeout waiting for helper ({START_WAIT_SEC}s — first run may download models)"
    if tail:
        err += f" — see .native-server.log:\n{tail}"
    return {"ok": False, "running": False, "error": err}


def handle(msg):
    action = msg.get("action", "")
    if action == "ping":
        # Bukti bahwa bridge Native Messaging benar-benar terhubung. Sengaja
        # tidak memanggil /health: balasannya harus instan supaya bisa dipakai
        # sebagai pemeriksaan status, bukan menunggu helper yang mungkin mati.
        return {"ok": True, "connected": True, "host": host_info(), "helper_port_open": port_open()}
    if action == "status":
        h = health()
        return {"ok": True, "running": bool(h), "health": h, "connected": True, "host": host_info()}
    if action == "start":
        return start_server()
    if action == "stop":
        ok = force_stop()
        return {"ok": ok, "running": bool(health())}
    if action == "restart":
        force_stop()
        return start_server()
    if action == "ensure_lab":
        h = health()
        if not h:
            return {"ok": False, "error": "native helper not running", "lab": lab_running()}
        ok = ensure_lab()
        return {"ok": ok, "lab": lab_running(), "running": True, "health": h}
    return {"ok": False, "error": f"unknown action: {action}"}


def main():
    while True:
        try:
            write_msg(handle(read_msg()))
        except Exception as e:  # noqa: BLE001
            write_msg({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
