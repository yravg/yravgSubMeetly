# Gerbang rilis — Chrome Web Store 1.1

Dibuat oleh `scripts/mark-release-priorities.mjs` pada 2026-09-05T16:35:34.787Z.

**Status: LOLOS GERBANG** — tidak ada cacat wajib terbuka untuk ship CWS.

## Ringkasan

| Metrik | Nilai |
|--------|------:|
| Total cacat | 17 |
| Wajib terbuka | 0 |
| Open / Accepted / Fixed | 2 / 14 / 1 |

## Wajib sebelum rilis

_Tidak ada._

## Diterima untuk ship CWS (residual)

| ID | Ringkasan |
|----|-----------|
| E2E-e2e-file | Diterima untuk rilis CWS: kontrak e2e-file lulus; jalur Puppeteer --browser opsional dan gagal dengan gejala CDP yang sama. |
| E2E-e2e-file-e2e-file-fatal | Diterima untuk rilis CWS: sub-check dari suite --browser yang diterima di atas. |
| E2E-e2e-native | Diterima untuk rilis CWS: Native Helper bukan artefak Web Store; renderer panel tak merespons CDP saat --native — dilacak terpisah. |
| E2E-e2e-native-e2e-fatal | Diterima untuk rilis CWS: sub-check dari suite --native yang diterima di atas. |
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
