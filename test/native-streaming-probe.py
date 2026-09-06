"""
Probe jalur transkripsi streaming di native/server.py.

Engine ASR di-stub (asr_array_segments diganti) supaya yang diuji adalah
pemotongan jendela, penggeseran waktu, dedupe tumpang tindih, pelaporan
kemajuan, dan pembatalan — bukan akurasi Whisper. Berkas medianya sungguhan,
didekode oleh ffmpeg sungguhan.

Dipanggil oleh test/native-streaming.test.mjs; mencetak satu baris JSON.
"""
import json
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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
import server  # noqa: E402

MEDIA = os.environ["MEDIA"]
CANCEL_AFTER = int(os.environ.get("CANCEL_AFTER", "0"))

windows = []
calls = {"n": 0}


STUB = os.environ.get("STUB", "full")


def fake_segments(audio, language, task):
    calls["n"] += 1
    n = calls["n"]
    dur = audio.size / server.SAMPLE_RATE
    windows.append({"samples": int(audio.size), "dur": round(dur, 4)})
    if STUB == "overflow":
        # Whisper sungguhan pernah mengembalikan end jauh melewati panjang
        # jendela (mis. 29,98 dtk untuk jendela 5 dtk) — harus dijepit.
        return [{"start": 0.0, "end": dur + 25.0, "text": f"w{n}"}]
    if STUB == "straddle":
        # Segmen mulai di dalam lead-in lalu melewati batas ke audio baru.
        return [{"start": 0.2, "end": dur, "text": f"w{n}"}]
    if STUB == "leadin":
        # Segmen pertama jatuh sepenuhnya di lead-in (konteks yang sudah
        # ditranskrip jendela sebelumnya) dan harus dibuang, kecuali di
        # jendela pertama yang lead-in-nya nol.
        return [
            {"start": 0.0, "end": 0.5, "text": f"echo{n}"},
            {"start": 1.2, "end": dur, "text": f"w{n}"},
        ]
    return [{"start": 0.0, "end": dur, "text": f"w{n}"}]


server.asr_array_segments = fake_segments

raw = list(server._stream_windows(MEDIA))
out = {
    "duration": server.media_duration_sec(MEDIA),
    "raw_windows": [
        {"start": round(a, 4), "lead": round(b, 4), "samples": int(c.size)} for a, b, c in raw
    ],
}
del raw

progress = []
segments_len = []


def on_progress(frac, partial):
    progress.append(None if frac is None else round(frac, 4))
    segments_len.append(len(partial))


should_cancel = None
if CANCEL_AFTER:
    def should_cancel(state={"n": 0}):
        state["n"] += 1
        return state["n"] > CANCEL_AFTER

try:
    segs = server.asr_file_streaming(MEDIA, "en", "transcribe", on_progress, should_cancel)
    out["segments"] = [{"start": round(s["start"], 4), "end": round(s["end"], 4), "text": s["text"]} for s in segs]
    out["cancelled"] = False
except server.JobCancelled:
    out["cancelled"] = True
    out["segments"] = None

out["progress"] = progress
out["segments_len"] = segments_len
out["asr_calls"] = calls["n"]
out["windows"] = windows
print(json.dumps(out))
