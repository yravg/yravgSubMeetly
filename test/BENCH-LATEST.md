# Latest benchmark snapshot

Auto-generated from `scripts/bench-lab.py` / `scripts/bench-report.mjs`.

**Target:** draft (`POST /draft`) ≤ **500 ms** per update.

## Summary (last run)

| Metric | Value |
|--------|-------|
| At | 2026-09-05T22:42:12 |
| Engine | mlx-whisper · whisper-large-v3-turbo |
| Draft calls | 200 |
| ≤500 ms | **111 / 200** |
| Draft min / p50 / max | **62** / 485 / 2349 ms |

## Per-pair highlights

### en→zh
- Draft best: **335 ms** @ 0.35s → "这是什么"
- Final ASR: 2794 ms
- Refine: 1094 ms → "The administration's approval and final ratification by the Senate naturally sup"

### en→de
- Draft best: **364 ms** @ 2.0s → "ein联接"
- Final ASR: 1571 ms
- Refine: 988 ms → "One connects Memphis and the Mississippi River with the east, and the other lead"

### en→fr
- Draft best: **356 ms** @ 0.5s → "Et"
- Final ASR: 1573 ms
- Refine: 2048 ms → "And immediately assumed command in the field on the twenty-first. General Pope a"

### ja→en
- Draft best: **381 ms** @ 0.5s → "At least."
- Final ASR: 2017 ms
- Refine: 1454 ms → "One is wearing a trench coat awkwardly, showing hesitation towards melton. The l"

### zh→en
- Draft best: **341 ms** @ 1.0s → "Again"
- Final ASR: 1779 ms
- Refine: 1501 ms → "Three agreements for the land, four agreements for the generals, five agreements"

### ko→en
- Draft best: **347 ms** @ 0.5s → "Okay."
- Final ASR: 2072 ms
- Refine: 1324 ms → "She fell into a deep sleep due to the tedious formal wife, whom she only had to "

### de→en
- Draft best: **65 ms** @ 0.5s → ""
- Final ASR: 1640 ms
- Refine: 1388 ms → "The tall windows with their illuminated lights stand out, along with the church "

### fr→en
- Draft best: **62 ms** @ 0.5s → ""
- Final ASR: 1719 ms
- Refine: 1220 ms → "what stain of mud on your name I was going to say on your reign that it's an abo"

### es→en
- Draft best: **70 ms** @ 0.5s → ""
- Final ASR: 2247 ms
- Refine: 910 ms → "Azuero who reigned from India to Ethiopia over one hundred and twenty-seven prov"

### ru→en
- Draft best: **380 ms** @ 0.5s → "Cube."
- Final ASR: 2017 ms
- Refine: 1744 ms → "The public wished to obtain an icon, although they had a short biography of the "

### it→en
- Draft best: **335 ms** @ 0.5s → "Water"
- Final ASR: 1949 ms
- Refine: 1379 ms → "What disturbance should a happy family, which has previously been relatively hap"

### nl→en
- Draft best: **75 ms** @ 0.5s → ""
- Final ASR: 2063 ms
- Refine: 1291 ms → "Brown was a real troublemaker, yet he was cowardly at heart. When things went wr"

### pl→en
- Draft best: **349 ms** @ 0.5s → "Caption..."
- Final ASR: 1937 ms
- Refine: 1811 ms → "Scrooge and all customers and bankers were a more reliable guarantee than the be"

### ar→en
- Draft best: **385 ms** @ 0.5s → "Then translate."
- Final ASR: 1582 ms
- Refine: 505 ms → "Subscribe to the channel."

### vi→en
- Draft best: **66 ms** @ 0.5s → ""
- Final ASR: 2273 ms
- Refine: 930 ms → "Just after dark, the houses are closed tight, with no light anywhere. The long-d"

### id→en
- Draft best: **63 ms** @ 0.5s → ""
- Final ASR: 1941 ms
- Refine: 1300 ms → "Living in House Number Seven, he always tries to be different from others, but h"

### uk→en
- Draft best: **364 ms** @ 1.0s → "Welcome!"
- Final ASR: 2754 ms
- Refine: 1628 ms → "George Demian liked to invite guests to his tavern. He was richer than all the v"

### en→es
- Draft best: **380 ms** @ 0.5s → "tocubrir"
- Final ASR: 1969 ms
- Refine: 1373 ms → "alrededor del ring, en cada asiento, pero el primero se eleva más que el que est"

### en→ru
- Draft best: **357 ms** @ 0.5s → "Но..."
- Final ASR: 1685 ms
- Refine: 1545 ms → "Тактическая disposition войск на восемь миль отсюда бы дала дополнительные дорог"

### en→it
- Draft best: **389 ms** @ 0.5s → "L'O"
- Final ASR: 1749 ms
- Refine: 1415 ms → "L'esercito del Mississippi mi ha dato il secondo comando del tutto e ero anche n"

### en→id
- Draft best: **386 ms** @ 0.5s → "Namoles."
- Final ASR: 2802 ms
- Refine: 1476 ms → "Hewan itu dilepas. Ia diikat dengan banyak peralatan meledak. Sakit dari prickin"

### en→vi
- Draft best: **368 ms** @ 1.0s → "building getting back"
- Final ASR: 1807 ms
- Refine: 877 ms → "Quay lại với các tàu và expedition phải退回沒有達鐵路，槍砲必須拖回。"

## How to re-run

```bash
cd native && ./run.sh
python3 scripts/bench-lab.py --json test/last-bench.json
node scripts/bench-models.mjs --catalog-only
node scripts/bench-report.mjs
```
