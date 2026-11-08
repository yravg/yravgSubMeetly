# SubMeetly island demo (stageshow)

Animated demo of the top-of-screen island: idle pill, live captions, hover ring, Live page, Meeting tab, Accept, fold back. Light theme only. Output: `../submeetly-canvas/shots/island-demo.gif` and `island-demo-poster.png`.

Source here: `index.tsx`, `island.css`, `desk.png` (the real Minutes screenshot used as the blurred ground), `REHEARSAL.md`. The stageshow kit is not included.

To film it again:
1. Copy the stageshow skill folder (tastestack plugin, `skills/stageshow`) somewhere writable; `npm install` there.
2. Copy this folder's files to `examples/submeetly-island/` in that copy (the import path `../../kit` expects that place).
3. `npm run dev`, then `node scripts/film.mjs "http://127.0.0.1:5173/?capture=submeetly-island" --gate --every 1000 --count 16` (add `--width 390` for the compact design, `--still --reduced` for the poster).
4. GIF: record the same URL with Playwright `recordVideo` at 900x420 for about 36 s, cut one loop (about 16.0 s, starting on the idle pill) and convert with ffmpeg: `fps=15,scale=900`, `palettegen=max_colors=96:stats_mode=diff`, then `paletteuse=dither=bayer:bayer_scale=4`. Result 1.9 MB.
