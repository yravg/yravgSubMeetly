#!/usr/bin/env python3
"""Smoke-test the native helper: realtime-style PCM, whole-file, translation."""
import json
import struct
import sys
import time
import urllib.request
import wave

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:17865"
WAV = "test/speech.wav"


def post(path, body, ctype):
    req = urllib.request.Request(BASE + path, data=body, method="POST")
    req.add_header("Content-Type", ctype)
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode()), (time.time() - t0) * 1000


print("health:", json.load(urllib.request.urlopen(BASE + "/health")))

with wave.open(WAV, "rb") as w:
    assert w.getframerate() == 16000 and w.getnchannels() == 1
    n = w.getnframes()
    pcm16 = struct.unpack("<%dh" % n, w.readframes(n))
pcm32 = struct.pack("<%df" % n, *[s / 32768.0 for s in pcm16])
print(f"audio: {n/16000:.1f}s")

j, ms = post("/transcribe?language=en&task=transcribe", pcm32, "application/octet-stream")
print(f"/transcribe  ({ms:.0f} ms, RTF {ms/1000/(n/16000):.2f}): {j.get('text')!r}")

j, ms = post("/transcribe_file?language=en&task=transcribe&filename=speech.wav", open(WAV, "rb").read(), "application/octet-stream")
print(f"/transcribe_file ({ms:.0f} ms): {[(round(s['start'],1), round(s['end'],1), s['text']) for s in j.get('segments', [])]}")

try:
    j, ms = post("/translate?src=en&tgt=zh", "The quick brown fox jumps over the lazy dog.".encode(), "text/plain")
    print(f"/translate en→zh ({ms:.0f} ms): {j.get('text')!r}")
    j, ms = post("/translate?src=en&tgt=ja", "Machine learning runs completely on this device.".encode(), "text/plain")
    print(f"/translate en→ja ({ms:.0f} ms): {j.get('text')!r}")
except urllib.error.HTTPError as e:
    print("/translate:", e.code, e.read().decode()[:200])
