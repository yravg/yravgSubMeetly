# Chrome Web Store assets (Fase 3)

Materi listing: [`listing.md`](./listing.md)  
Privasi: [`PRIVACY.md`](./PRIVACY.md)  
Audit MV3: [`MV3-AUDIT.md`](./MV3-AUDIT.md)  
Panduan kirim: [`SUBMIT.md`](./SUBMIT.md)

## Ikon
Gunakan `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` (sudah ada di repo).
Untuk toko, sediakan juga **128×128** dan **440×280** promo bila diminta.

Salinan kerja untuk unggahan:

```bash
mkdir -p store/icons
cp icons/icon128.png store/icons/icon128.png
cp icons/icon48.png store/icons/icon48.png
cp icons/icon16.png store/icons/icon16.png
```

## Tangkapan layar
Rekam alur berikut (simpan di `store/screenshots/`):

1. Side Panel Realtime + overlay subtitel  
2. Offline Studio (`test/studio.html`)  
3. Native Helper status + Notulen  

Placeholder HTML preview: buka `test/studio.html` dan `test/notes-panel.html` via lab server.

## Paket ZIP
```bash
npm run build
node scripts/pack-store.mjs
```

## Deskripsi singkat
Local TransSub — subtitel & terjemahan real-time 100% on-device. Tanpa akun, tanpa cloud.
