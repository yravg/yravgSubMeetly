# Laporan pembanding kinerja model

Dibuat otomatis oleh `scripts/bench-report.mjs` dari `last-models-bench.json`.

- **Generated:** 2026-09-03T03:54:02.026Z
- **Source:** catalog+last-bench
- **Target draft:** ≤ **500 ms** (`POST /draft` native)

## Tabel pembanding

| Model | Engine | Device | Draft | ASR | MT | RTF | Status | Catatan |
|-------|--------|--------|------:|----:|---:|----:|--------|---------|
| Whisper Tiny | browser | WASM q8 | 920 ms | 780 ms | — | 0.45 | warn | Paling cepat di browser; akurasi rendah. Angka stub. |
| Whisper Base | browser | WASM q8 | 1600 ms | 1400 ms | — | 0.7 | warn | Keseimbangan yang disarankan README. Angka stub. |
| Whisper Small | browser | WASM q8 | 3200 ms | 2800 ms | — | 1.4 | fail | Lambat di WASM; lebih masuk akal di WebGPU. Angka stub. |
| Whisper Large v3 Turbo | browser | WebGPU q4f16 | 1100 ms | 900 ms | — | 0.35 | warn | Hanya WebGPU. Masih di atas target draft 500 ms. Angka stub. |
| Voxtral Mini 3B | browser | WebGPU q4 | 2800 ms | 2400 ms | — | 0.9 | fail | Kualitas tinggi, butuh ≥16 GB RAM. Tidak untuk caption live. Angka stub. |
| Opus-MT (per pasangan) | browser | WASM q8 | — | — | 180 ms | — | pass | Fallback terjemahan lokal. Bukan ASR. Angka stub. |
| Native mlx-whisper · whisper-large-v3-turbo | native | Apple GPU (MLX) | 520 ms | 410 ms | 664 ms | 0.05 | warn | Draft terbaik 520 ms · ≤500 ms: 0/16 · dari last-bench.json |

## Native draft (dari last-bench)

| Metric | Value |
|--------|-------|
| Draft calls | 16 |
| ≤500 ms | 0 / 16 |
| min / p50 / avg / max | 520 / 828 / 1032 / 3726 ms |

## Cara menjalankan ulang

```bash
node scripts/bench-models.mjs --catalog-only   # gabung last-bench + katalog
node scripts/bench-models.mjs --browser        # ukur Whisper Tiny di Node
node scripts/bench-models.mjs --native         # bench-lab.py (helper harus hidup)
node scripts/bench-report.mjs                  # tulis laporan ini
```

UI: `test/bench.html` (lab) · native UI: `./scripts/run-lab.sh`.
