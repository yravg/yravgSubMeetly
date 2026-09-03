# Panduan pengiriman Chrome Web Store

1. `npm run build` atau `node esbuild.config.mjs`
2. `chmod +x scripts/pack-store.sh && ./scripts/pack-store.sh`
3. Unggah `store/releases/local-transsub-*.zip` ke [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
4. Isi listing dari `store/LISTING.md`
5. Tempel URL privasi / unggah `store/PRIVACY.md`
6. Lampirkan ikon `store/icons/` dan screenshot
7. Cantumkan justifikasi izin (lihat `store/MV3-AUDIT.md`)
8. Kirim untuk ditinjau; naikkan versi di `package.json` + `src/manifest.json` untuk pembaruan berikutnya
