"""
Ukur jalur dekode streaming native/server.py pada satu berkas media.

Engine ASR di-stub: yang diukur adalah pipa ffmpeg + penjendelaan, yaitu bagian
yang menentukan apakah berkas >2 GiB muat di memori. Whisper sendiri tidak
dijalankan — throughput ASR bukan yang diklaim oleh fitur ini.

Mencetak satu baris JSON:
  {bytes_decoded, audio_seconds, windows, max_window_samples, elapsed_s, peak_rss_mb}

Dipanggil oleh scripts/bench-bigfile.mjs.
"""
import json
import os
import resource
import sys
import time
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


def peak_rss_mb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS melaporkan byte, Linux kilobyte.
    return rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024


media = sys.argv[1]
samples = 0
windows = 0
max_window = 0
t0 = time.time()

for start_sec, lead_sec, window in server._stream_windows(media):
    windows += 1
    max_window = max(max_window, int(window.size))
    # Hanya audio baru yang dihitung; lead-in adalah pengulangan yang disengaja.
    samples += int(window.size) - int(lead_sec * server.SAMPLE_RATE)

elapsed = time.time() - t0
print(
    json.dumps(
        {
            "audio_seconds": samples / server.SAMPLE_RATE,
            "windows": windows,
            "max_window_samples": max_window,
            "chunk_sec": server.STREAM_CHUNK_SEC,
            "overlap_sec": server.STREAM_OVERLAP_SEC,
            "elapsed_s": elapsed,
            "peak_rss_mb": peak_rss_mb(),
            "file_bytes": os.path.getsize(media),
        }
    )
)
