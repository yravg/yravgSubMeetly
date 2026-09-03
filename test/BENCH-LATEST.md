# Latest benchmark snapshot

Auto-generated from `scripts/bench-lab.py` / `scripts/bench-report.mjs`.

**Target:** draft (`POST /draft`) ≤ **500 ms** per update.

## Summary (last run)

| Metric | Value |
|--------|-------|
| At | 2026-08-22T21:57:26 |
| Engine | mlx-whisper · whisper-large-v3-turbo |
| Draft calls | 16 |
| ≤500 ms | **0 / 16** |
| Draft min / p50 / max | **520** / 828 / 3726 ms |

## Per-pair highlights

### zh→en
- Draft best: **557 ms** @ 0.5s → "Today"
- Final ASR: 5550 ms
- Refine: 986 ms → "The weather is nice today, let's go for a walk in the park."

### en→zh
- Draft best: **605 ms** @ 0.5s → "天气是"
- Final ASR: 2503 ms
- Refine: 933 ms → "天气今天很好，一起去公园散步如何。"

### ja→en
- Draft best: **646 ms** @ 2.0s → "It's a nice weather today."
- Final ASR: 3325 ms
- Refine: 871 ms → "It's a nice day. Let's go for a walk in the park."

### en→ja
- Draft best: **520 ms** @ 0.5s → "それは美しさです。"
- Final ASR: 2647 ms
- Refine: 900 ms → "今日は美しい天気です。公園で散歩しましょうか？"

## How to re-run

```bash
cd native && ./run.sh
python3 scripts/bench-lab.py --json test/last-bench.json
node scripts/bench-models.mjs --catalog-only
node scripts/bench-report.mjs
```
