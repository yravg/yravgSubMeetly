#!/usr/bin/env python3
"""Headless benchmark for Local TransSub native helper.

Runs the same checks as test/lab.html without a browser:
  - /draft at 0.35s, 0.5s, 1s, 2s windows
  - /transcribe (final ASR)
  - /translate?fast=1
  - /translate_refine

Usage:
  ./scripts/bench-lab.py
  ./scripts/bench-lab.py --json results.json
"""
from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "test" / "samples"
MANIFEST = SAMPLES / "manifest.json"
DEFAULT_URL = "http://127.0.0.1:17865"
TARGET_DRAFT_MS = 500


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def read_wav_pcm(path: Path) -> tuple[np.ndarray, int]:
    """Return float32 mono @16 kHz."""
    with wave.open(str(path), "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError(f"{path.name}: need mono 16-bit PCM")
        rate = w.getframerate()
        frames = w.readframes(w.getnframes())
    if rate != 16000:
        raise ValueError(f"{path.name}: need 16 kHz (run gen-samples.sh)")
    pcm_i16 = np.frombuffer(frames, dtype=np.int16)
    return (pcm_i16.astype(np.float32) / 32768.0), rate


def pcm_slice(pcm: np.ndarray, start_sec: float, dur_sec: float) -> np.ndarray:
    s0 = int(start_sec * 16000)
    s1 = min(len(pcm), s0 + int(dur_sec * 16000))
    return pcm[s0:s1]


def post_bytes(url: str, path: str, body: np.ndarray, query: dict | None = None) -> tuple[dict, int]:
    raw = body.astype(np.float32).tobytes() if isinstance(body, np.ndarray) else body
    q = urllib.parse.urlencode(query or {})
    full = f"{url.rstrip('/')}{path}" + (f"?{q}" if q else "")
    req = urllib.request.Request(
        full,
        data=raw,
        method="POST",
        headers={"Content-Type": "application/octet-stream"},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    elapsed = int((time.perf_counter() - t0) * 1000)
    return json.loads(raw.decode("utf-8")), elapsed


def post_json(url: str, path: str, payload: dict, query: dict | None = None) -> tuple[dict, int]:
    q = urllib.parse.urlencode(query or {})
    full = f"{url.rstrip('/')}{path}" + (f"?{q}" if q else "")
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        full,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    elapsed = int((time.perf_counter() - t0) * 1000)
    return json.loads(raw.decode("utf-8")), elapsed


def post_text(url: str, path: str, text: str, query: dict | None = None) -> tuple[dict, int]:
    q = urllib.parse.urlencode(query or {})
    full = f"{url.rstrip('/')}{path}" + (f"?{q}" if q else "")
    req = urllib.request.Request(
        full,
        data=text.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    elapsed = int((time.perf_counter() - t0) * 1000)
    return json.loads(raw.decode("utf-8")), elapsed


def get_health(url: str) -> dict:
    with urllib.request.urlopen(f"{url.rstrip('/')}/health", timeout=5) as r:
        return json.loads(r.read().decode("utf-8"))


def ensure_samples() -> None:
    missing = [s["file"] for s in load_manifest()["samples"] if not (SAMPLES / s["file"]).exists()]
    if missing:
        gen = ROOT / "scripts" / "gen-samples.py"
        if gen.exists():
            print(f"[bench] Generating missing samples: {', '.join(missing)}")
            subprocess.run([sys.executable, str(gen)], check=True, cwd=ROOT)
        else:
            raise SystemExit(f"Missing samples: {missing}. Run ./scripts/gen-samples.sh")


def warmup_draft(base_url: str, sample: dict) -> None:
    """Prime draft ASR + fast MT so timed runs reflect steady-state latency."""
    pcm, _ = read_wav_pcm(SAMPLES / sample["file"])
    chunk = pcm_slice(pcm, 0, 1.0)
    try:
        post_bytes(
            base_url,
            "/draft",
            chunk,
            {"src": sample["src"], "tgt": sample["tgt"], "language": sample["src"]},
        )
    except urllib.error.URLError:
        pass


def bench_sample(base_url: str, sample: dict, *, label_suffix: str = "") -> list[dict]:
    pair = f"{sample['src']}→{sample['tgt']}{label_suffix}"
    wav = SAMPLES / sample["file"]
    pcm, _ = read_wav_pcm(wav)
    dur = len(pcm) / 16000
    rows: list[dict] = []

    for window in (0.35, 0.5, 1.0, 2.0):
        if dur < window:
            continue
        chunk = pcm_slice(pcm, 0, window)
        j, wall = post_bytes(
            base_url,
            "/draft",
            chunk,
            {"src": sample["src"], "tgt": sample["tgt"], "language": sample["src"]},
        )
        ms = j.get("ms", wall)
        ok = ms <= TARGET_DRAFT_MS and bool(j.get("source") or j.get("translation"))
        rows.append(
            {
                "pair": pair,
                "stage": f"draft {window}s",
                "ms": ms,
                "asr_ms": j.get("asr_ms"),
                "translate_ms": j.get("translate_ms"),
                "source": j.get("source", ""),
                "translation": j.get("translation", ""),
                "pass": ok,
            }
        )
        mark = "✅" if ok else "⚠️"
        print(f"  {mark} draft@{window}s  {ms:4d}ms  asr={j.get('asr_ms','?')} mt={j.get('translate_ms','?')}  → {j.get('translation','')[:60]}")

    j, ms = post_bytes(
        base_url,
        "/transcribe",
        pcm,
        {"language": sample["src"], "task": "transcribe"},
    )
    asr_text = j.get("text", "")
    rows.append({"pair": pair, "stage": "final ASR", "ms": j.get("ms", ms), "source": asr_text, "pass": bool(asr_text)})
    print(f"  {'✅' if asr_text else '⚠️'} final ASR {j.get('ms', ms):4d}ms  → {asr_text[:80]}")

    j, ms = post_text(
        base_url,
        "/translate",
        sample["text"],
        {"src": sample["src"], "tgt": sample["tgt"], "fast": "1"},
    )
    draft_mt = j.get("text", "")
    rows.append(
        {
            "pair": pair,
            "stage": "fast MT",
            "ms": j.get("ms", ms),
            "source": sample["text"],
            "translation": draft_mt,
            "pass": bool(draft_mt),
        }
    )
    print(f"  {'✅' if draft_mt else '⚠️'} fast MT    {j.get('ms', ms):4d}ms  → {draft_mt[:80]}")

    j, ms = post_json(
        base_url,
        "/translate_refine",
        {"text": sample["text"], "draft": draft_mt},
        {"src": sample["src"], "tgt": sample["tgt"]},
    )
    refined = j.get("text", "")
    rows.append(
        {
            "pair": pair,
            "stage": "refine",
            "ms": ms,
            "source": sample["text"],
            "translation": refined,
            "pass": bool(refined),
        }
    )
    print(f"  {'✅' if refined else '⚠️'} refine     {ms:4d}ms  → {refined[:80]}")
    return rows


def print_summary(rows: list[dict]) -> None:
    drafts = [r for r in rows if r["stage"].startswith("draft")]
    if not drafts:
        return
    times = [r["ms"] for r in drafts]
    under = sum(1 for t in times if t <= TARGET_DRAFT_MS)
    print()
    print("=== Summary ===")
    print(f"Draft calls: {len(drafts)}  ≤{TARGET_DRAFT_MS}ms: {under}/{len(drafts)} ({100*under/len(drafts):.0f}%)")
    print(f"Draft ms — min: {min(times)}  p50: {sorted(times)[len(times)//2]}  max: {max(times)}  avg: {sum(times)//len(times)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--json", dest="json_out", help="Write full results JSON")
    args = ap.parse_args()

    ensure_samples()

    try:
        health = get_health(args.url)
    except urllib.error.URLError as e:
        print(f"ERROR: native helper not reachable at {args.url}", file=sys.stderr)
        print(f"  Start with: cd native && ./run.sh", file=sys.stderr)
        print(f"  Detail: {e}", file=sys.stderr)
        return 1

    print(f"Engine: {health.get('engine')}  model: {health.get('model', '').split('/')[-1]}")
    if health.get("draft_model"):
        print(f"Draft ASR: {health['draft_model'].split('/')[-1]}")
    print()

    # Warmup pass (not scored)
    print("--- Warmup (1 draft per pair, not scored) ---")
    for sample in load_manifest()["samples"]:
        warmup_draft(args.url, sample)
    print()

    all_rows: list[dict] = []
    for sample in load_manifest()["samples"]:
        print(f"--- {sample['label']} ({sample['id']}) ---")
        try:
            all_rows.extend(bench_sample(args.url, sample))
        except Exception as e:  # noqa: BLE001
            print(f"  ❌ FAILED: {e}")
            all_rows.append({"pair": sample["id"], "stage": "error", "ms": 0, "pass": False, "source": str(e)})
        print()

    print_summary(all_rows)

    out = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "url": args.url, "health": health, "rows": all_rows}
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {args.json_out}")

    failed = sum(1 for r in all_rows if r["stage"].startswith("draft") and not r.get("pass"))
    return 1 if failed > len([r for r in all_rows if r["stage"].startswith("draft")]) // 2 else 0


if __name__ == "__main__":
    raise SystemExit(main())
