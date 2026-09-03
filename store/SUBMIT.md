# Chrome Web Store submission guide — Local TransSub 1.1.0

## Build & pack (canonical)

```bash
npm run build
npm run pack:store
# or: chmod +x scripts/pack-store.sh && ./scripts/pack-store.sh
```

**Upload this file only:** `store/releases/local-transsub-1.1.0.zip`  
(Identical copy also written to `store/local-transsub-1.1.0.zip`. Do **not** upload any `1.0.0` zip.)

## Dashboard checklist

1. Upload the 1.1.0 zip above.
2. Paste listing copy from [`listing.md`](./listing.md) (English primary).
3. Host [`PRIVACY.md`](./PRIVACY.md) at a public HTTPS URL (GitHub Pages / repo raw via Pages / your site) and paste that URL into Privacy policy. The dashboard needs a URL, not a local markdown path.
4. Attach icons from [`icons/`](./icons/) and screenshots from [`screenshots/`](./screenshots/) (at least one 1280×800 or 640×400).
5. Fill permission justifications from [`MV3-AUDIT.md`](./MV3-AUDIT.md).
6. Confirm single purpose: on-device captions / translation for media the user chooses.
7. Submit for review. Bump `package.json` + `src/manifest.json` together for the next release.

## Pre-submit QA (this repo)

```bash
npm run build
npm run smoke
npm run e2e:harness
npm run e2e:file
npm run release:gate
npm run release:check
npm run pack:store
```

Optional residual (not in the CWS zip): `npm run e2e:pick`, `npm run e2e:native`, native bench — see `test/RELEASE-GATE.md`.
