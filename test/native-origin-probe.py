"""
Jalankan native/server.py dengan engine palsu agar tes batas asal bisa
menyalakannya dalam hitungan milidetik (bukan menunggu Whisper dimuat).

Cetak "READY <port>" lalu melayani sampai dimatikan.
Dipanggil oleh test/native-origin.test.mjs.
"""
import os
import sys
import types
from pathlib import Path

_fw = types.ModuleType("faster_whisper")
_fw.WhisperModel = lambda *a, **k: None
_ct2 = types.ModuleType("ctranslate2")
_ct2.get_cuda_device_count = lambda: 0
sys.modules["faster_whisper"] = _fw
sys.modules["ctranslate2"] = _ct2
os.environ["ENGINE"] = "faster-whisper"
os.environ.setdefault("TRANSLATE", "off")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
import server  # noqa: E402

srv = server.ReuseHTTPServer((server.HOST, server.PORT), server.Handler)
print(f"READY {server.PORT}", flush=True)
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
