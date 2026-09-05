"""
Probe untuk logika pemilihan runtime CPU/GPU di native/server.py.

server.py memuat model ASR saat import, jadi probe ini menyuntikkan modul
faster_whisper/ctranslate2 palsu ke sys.modules lebih dulu. Hasilnya import
jadi cepat dan deterministik di semua platform (termasuk Apple Silicon, yang
kalau tidak dipaksa akan memilih MLX).

Dipanggil oleh test/native-device.test.mjs; mencetak satu baris JSON.
Env yang dipakai: CUDA_COUNT (jumlah GPU palsu), DEVICE_PREF_PATH, DEVICE.
"""
import json
import os
import sys
import types
from pathlib import Path

CUDA_COUNT = int(os.environ.pop("CUDA_COUNT", "0"))
recorded = {}


class _FakeWhisperModel:
    def __init__(self, model, device=None, compute_type=None, **kw):
        recorded["model"] = model
        recorded["device"] = device
        recorded["compute_type"] = compute_type


fw = types.ModuleType("faster_whisper")
fw.WhisperModel = _FakeWhisperModel
ct2 = types.ModuleType("ctranslate2")
ct2.get_cuda_device_count = lambda: CUDA_COUNT
sys.modules["faster_whisper"] = fw
sys.modules["ctranslate2"] = ct2

# Nilai apa pun selain "auto"/"mlx" membuat server.py melewati cabang MLX.
os.environ["ENGINE"] = "faster-whisper"

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
import server  # noqa: E402

out = {
    "engine": server.ENGINE,
    "fw_device": server.FW_DEVICE,
    "fw_compute": server.FW_COMPUTE,
    "loaded_device": recorded.get("device"),
    "state": server._device_state(),
}

# Roundtrip persistensi: simpan → baca ulang → tolak nilai asing.
if os.environ.get("PROBE_SAVE"):
    want = os.environ["PROBE_SAVE"]
    try:
        out["saved"] = server._save_device_pref(want)
        out["reloaded"] = server._load_device_pref()
        out["state_after"] = server._device_state()
    except ValueError as e:
        out["save_error"] = str(e)

print(json.dumps(out))
