# Gerbang rilis — Chrome Web Store 1.1

Dibuat oleh `scripts/mark-release-priorities.mjs` pada 2026-09-05T15:16:15.926Z.

**Status: DITAHAN** — 4 cacat wajib masih terbuka.

## Ringkasan

| Metrik | Nilai |
|--------|------:|
| Total cacat | 17 |
| Wajib terbuka | 4 |
| Open / Accepted / Fixed | 6 / 10 / 1 |

## Wajib sebelum rilis

| ID | Judul | Area | Bukti |
|----|-------|------|-------|
| E2E-e2e-file | E2E gagal: E2E berkas offline + ekspor SRT/VTT/TXT | E2E | node scripts/e2e-file.mjs --browser · test/last-e2e.json |
| E2E-e2e-file-e2e-file-fatal | E2E check gagal: Jalankan e2e-file | E2E | test/last-e2e.json · e2e-file |
| E2E-e2e-native | E2E gagal: E2E mesin native helper (--native) | E2E | node scripts/e2e.mjs --native · test/last-e2e.json |
| E2E-e2e-native-e2e-fatal | E2E check gagal: Jalankan E2E | E2E | test/last-e2e.json · e2e-native |

## Diterima untuk ship CWS (residual)

| ID | Ringkasan |
|----|-----------|
| REL-02 | Diterima untuk rilis CWS: harness E2E lulus; --pick headed tetap residual manual sebelum demos besar. |
| REL-03 | Diterima untuk rilis CWS: Native Helper bukan artefak Web Store; verifikasi --native residual platform. |
| REL-04 | Diterima untuk rilis CWS: kontrak e2e-file lulus; jalur Puppeteer --browser residual opsional. |
| REL-01 | Diterima untuk rilis CWS: helper native opsional di luar zip store; target 500 ms tetap dilacak di bench. |

## Kebijakan

- `REL-01`…`REL-04` wajib sampai bukti ada **atau** diterima oleh kebijakan store-ship.
- `REL-05` (TXT) otomatis **fixed** jika smoke `export-txt` lulus.
- Cacat `accepted` = residual terdokumentasi; tidak menahan unggahan CWS.

```bash
node scripts/gen-defects.mjs
node scripts/mark-release-priorities.mjs
node scripts/mark-release-priorities.mjs --check   # CI gate
```

UI: `test/defects.html`.
