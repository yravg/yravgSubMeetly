# Gerbang rilis Fase 1 — prioritas wajib

Dibuat oleh `scripts/mark-release-priorities.mjs` pada 2026-09-03T03:58:34.488Z.

**Status: DITAHAN** — 4 cacat wajib masih terbuka.

## Ringkasan

| Metrik | Nilai |
|--------|------:|
| Total cacat | 16 |
| Wajib terbuka | 4 |
| Open / Accepted / Fixed | 9 / 6 / 1 |

## Wajib sebelum rilis

| ID | Judul | Area | Bukti |
|----|-------|------|-------|
| REL-01 | Draft native sering di atas target 500 ms | Native Helper | test/last-bench.json · test/BENCH-COMPARE.md |
| REL-02 | E2E jalur pemilih tab (--pick) belum diverifikasi penuh | Ekstensi Chrome | scripts/e2e.mjs --pick · test/last-e2e.json |
| REL-03 | E2E mesin native (--native) belum diverifikasi penuh | Native Helper | scripts/e2e.mjs --native |
| REL-04 | E2E berkas offline (--browser) belum dijalankan | Ekstensi Chrome | scripts/e2e-file.mjs --browser |

## Kebijakan

- Selalu wajib sampai bukti E2E/bench ada: `REL-01` … `REL-04`.
- `REL-05` (TXT) otomatis **fixed** jika smoke `export-txt` lulus.
- Cacat `accepted` = kendala terdokumentasi, tidak menahan gerbang.

```bash
node scripts/gen-defects.mjs
node scripts/mark-release-priorities.mjs
node scripts/mark-release-priorities.mjs --check   # CI gate
```

UI: `test/defects.html`.
