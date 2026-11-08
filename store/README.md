# Chrome Web Store assets (1.1.1)

| Doc | Path |
|---|---|
| Listing copy | [`listing.md`](./listing.md) |
| Privacy policy | [`PRIVACY.md`](./PRIVACY.md) |
| MV3 permission audit | [`MV3-AUDIT.md`](./MV3-AUDIT.md) |
| Submit steps | [`SUBMIT.md`](./SUBMIT.md) |

## Icons
Ship `icons/icon16.png`, `icon48.png`, `icon128.png` (mirrors of repo `icons/`).

Optional promo: **440×280** small tile / **1400×560** marquee if you create them later.

## Screenshots
Saved under `store/screenshots/` (1280×800 PNG):

1. `01-sidepanel-realtime.png` — **primary CWS shot** (Side Panel harness via lab)
2. `02-offline-studio.png` — Offline Studio lab page (dev harness; optional listing image)
3. `03-notes-helper.png` — Notes stub harness (optional; shows Notulen UI)

Regenerate:

```bash
npm run build
# lab must be up on :8799
npm run pack:store:screens
```

For the dashboard, prefer at least one capture from the **loaded extension** (overlay on a real tab) in addition to `01-…`.

## Package ZIP

```bash
npm run build
npm run pack:store
```

Canonical upload path: **`store/releases/yraverage-submin-1.1.1.zip`**.

## Short blurb
yravgSubMeetly — on-device realtime subtitles & translation. No yravgSubMeetly cloud inference; models download once when you choose them.
