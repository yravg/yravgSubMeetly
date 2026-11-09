// Render check at a 1640 viewport. Usage: node render.mjs  (set PUPPETEER_EXECUTABLE_PATH)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'renders'); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ['--no-sandbox'] });
try {
  const pg = await browser.newPage(); await pg.setViewport({ width: 1640, height: 1000 });
  const errs = []; pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto(pathToFileURL(path.join(here, 'tide-shell-canvas.html')).href, { waitUntil: 'networkidle0', timeout: 60000 });
  const info = await pg.evaluate(() => ({
    heights: Object.fromEntries([...document.querySelectorAll('section[id]')].map((s) => [s.id, Math.ceil(s.getBoundingClientRect().height)])),
    sw: document.documentElement.scrollWidth,
    broken: [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src')),
  }));
  fs.writeFileSync(path.join(here, 'heights.json'), JSON.stringify(info.heights, null, 1));
  // click Before on A01
  await pg.click('#A01 [data-g="ba"][data-k="before"]');
  const beforeShown = await pg.evaluate(() => { const i = document.querySelector('#A01 .ixi'); return i && i.getBoundingClientRect().height > 100; });
  await pg.evaluate(() => document.querySelector('#A01').scrollIntoView());
  await (await pg.$('#A01')).screenshot({ path: path.join(out, 'A01-before.png') });
  await pg.click('#A01 [data-g="ba"][data-k="after"]');
  for (const id of ['cover', 'status', 'index', 'A01', 'A02', 'A03', 'A09', 'K01', 'A07']) await (await pg.$('#' + id)).screenshot({ path: path.join(out, id + '.png') });
  // state click
  await pg.click('#A02 [data-g="st"][data-k="error"]');
  await (await pg.$('#A02')).screenshot({ path: path.join(out, 'A02-error.png') });
  console.log(JSON.stringify({ errs, scrollWidth: info.sw, broken: info.broken, beforeShown, heights: info.heights }));
} finally { await browser.close(); }
