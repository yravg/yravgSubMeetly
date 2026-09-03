# Latest benchmark snapshot

Auto-generated reference from `scripts/bench-lab.py` (warmup + 4 language pairs).

**Target:** draft (`POST /draft`) ≤ **500 ms** per update.

## Summary (last run)

| Metric | Value |
|--------|-------|
| Draft calls | 16 |
| ≤500 ms | 1–2 / 16 (best after warmup: **436 ms** zh→en @0.35s, **519 ms** ja→en @0.5s) |
| Draft p50 | ~1.7 s |
| Bottleneck | Fast LLM MT often 500–1700 ms; draft ASR ~70–1300 ms |

## Per-pair highlights

### zh → en
- Draft best: **436 ms** @ 0.35s → "Today"
- Final ASR: accurate Chinese source
- Refine: correct English sentence

### en → zh
- Draft: partial Chinese fragments while “speaking”
- Refine: natural Chinese correction

### ja → en
- Draft best: **519 ms** @ 0.5s
- Refine: good final English

### en → ja
- Draft: mixed JP/EN during partial windows (expected for drafts)
- Refine: clean Japanese final line

## How to re-run

```bash
cd native && ./run.sh          # terminal 1
python3 scripts/bench-lab.py --json test/last-bench.json
```

Or open `./scripts/run-lab.sh` for the interactive UI.

**Note:** Use **Engine → Native** in the extension for Refine; browser WASM ASR is much slower than the native draft pipeline.
