#!/usr/bin/env python3
"""Generate 16 kHz mono WAV samples for the translation lab (macOS say + afconvert)."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test" / "samples"
MANIFEST = OUT / "manifest.json"

VOICES = {
    "zh-en-1": ("Meijia", "今天天气很好，我们去公园散步吧。"),
    "en-zh-1": ("Samantha", "The weather is nice today. Let's go for a walk in the park."),
    "ja-en-1": ("Kyoko", "今日はいい天気ですね。公園を散歩しましょう。"),
    "en-ja-1": ("Samantha", "It's a beautiful day. Shall we take a walk in the park?"),
}


def aiff_to_wav16(aiff: Path, wav: Path) -> None:
    if shutil.which("afconvert"):
        subprocess.run(
            ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", str(aiff), str(wav)],
            check=True,
            capture_output=True,
        )
        return
    if shutil.which("ffmpeg"):
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(aiff), "-ar", "16000", "-ac", "1", str(wav)],
            check=True,
            capture_output=True,
        )
        return
    raise RuntimeError("Need afconvert (macOS) or ffmpeg")


def verify_wav(wav: Path, min_sec: float = 1.0) -> None:
    with wave.open(str(wav), "rb") as w:
        if w.getnchannels() != 1 or w.getframerate() != 16000:
            raise ValueError(f"{wav.name}: expected mono 16 kHz")
        dur = w.getnframes() / 16000
        if dur < min_sec:
            raise ValueError(f"{wav.name}: too short ({dur:.2f}s)")


def main() -> int:
    if not shutil.which("say"):
        print("ERROR: macOS 'say' not found", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    for sample in manifest["samples"]:
        sid = sample["id"]
        voice, text = VOICES[sid]
        wav = OUT / sample["file"]
        aiff = OUT / f".tmp-{sid}.aiff"
        print(f"[gen-samples] {sid} ({voice})")
        subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True)
        aiff_to_wav16(aiff, wav)
        aiff.unlink(missing_ok=True)
        verify_wav(wav)
        dur = wave.open(str(wav)).getnframes() / 16000
        print(f"  → {wav.name} ({dur:.2f}s)")

    print(f"[gen-samples] Done → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
