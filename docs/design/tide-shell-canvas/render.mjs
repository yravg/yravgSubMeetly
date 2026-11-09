// Render check at a 1640 viewport. Usage: node render.mjs  (set PUPPETEER_EXECUTABLE_PATH)
// Shots every section and every state button, then checks overlaps (tags, notes vs cards/notes/controls).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'renders'); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ['--no-sandbox'] });

// Runs in the page: returns problems for one visible board state.
const check = (id) => {
  const sec = document.getElementById(id); const probs = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const tags = [...sec.querySelectorAll('.newtag,.parttag')].filter(vis);
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) if (hit(tags[i].getBoundingClientRect(), tags[j].getBoundingClientRect())) probs.push(`tags overlap: ${tags[i].textContent}/${tags[j].textContent}`);
  const notes = [...sec.querySelectorAll('.note')].filter(vis);
  const blockers = [...sec.querySelectorAll('.card,.kept,.refs,.hd,.ixh,.win')].filter(vis);
  notes.forEach((n, i) => {
    const r = n.getBoundingClientRect(); const t = n.textContent.slice(0, 28);
    blockers.forEach((c) => { if (hit(r, c.getBoundingClientRect())) probs.push(`note "${t}" covers .${c.className.split(' ')[0]}`); });
    for (let j = i + 1; j < notes.length; j++) if (hit(r, notes[j].getBoundingClientRect())) probs.push(`notes overlap: "${t}" / "${notes[j].textContent.slice(0, 20)}"`);
  });
  sec.querySelectorAll('.scaler').forEach((sc) => { if (!vis(sc)) return; if (sc.scrollWidth > sc.clientWidth + 2 || sc.scrollHeight > sc.clientHeight + 2) probs.push(`scaler clips content (${sc.scrollWidth}x${sc.scrollHeight} in ${sc.clientWidth}x${sc.clientHeight})`); });
  return probs;
};

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
  const ids = await pg.evaluate(() => [...document.querySelectorAll('section[id]')].map((s) => s.id));
  const problems = {}; const band = {}; let beforeShown = false;
  for (const id of ids) {
    const el = await pg.$('#' + id);
    const states = await pg.evaluate((i) => [...document.querySelectorAll(`#${i} [data-g="st"]`)].map((b) => b.dataset.k), id);
    const hasBA = await pg.$(`#${id} [data-g="ba"][data-k="before"]`);
    if (hasBA) {
      await pg.click(`#${id} [data-g="ba"][data-k="before"]`);
      if (id === 'A01') beforeShown = await pg.evaluate(() => { const i = document.querySelector('#A01 .ixi'); return i && i.getBoundingClientRect().height > 100; });
      await el.screenshot({ path: path.join(out, `${id}-before.png`) });
      await pg.click(`#${id} [data-g="ba"][data-k="after"]`);
    }
    for (const k of states.length ? states : [null]) {
      if (k) await pg.click(`#${id} [data-g="st"][data-k="${k}"]`);
      const p = await pg.evaluate(check, id);
      if (p.length) problems[k ? `${id}:${k}` : id] = p;
      await el.screenshot({ path: path.join(out, k ? `${id}-${k}.png` : `${id}.png`) });
      if (id === 'A04b') band[k] = await pg.evaluate(() => { const e = [...document.querySelectorAll('#A04b .sb2')].find((x) => x.getBoundingClientRect().width > 0); const r = e && e.getBoundingClientRect(); const sc = e && e.closest('.scaler'); const f = sc ? sc.getBoundingClientRect().width / sc.offsetWidth : 1; const fr = e && e.closest('.frame'); const fb = fr && fr.getBoundingClientRect().bottom; return r && { h: Math.round(r.height / f), w: Math.round(r.width / f), over: e.scrollWidth - e.clientWidth, blankBelowFrame: sc && Math.round((sc.getBoundingClientRect().bottom - fb) / f) }; });
    }
    if (states.length) await pg.click(`#${id} [data-g="st"][data-k="${states[0]}"]`);
  }
  console.log('band', JSON.stringify(band));
  console.log('problems', JSON.stringify(problems, null, 1));
  console.log(JSON.stringify({ errs, scrollWidth: info.sw, broken: info.broken, beforeShown, heights: info.heights }));
} finally { await browser.close(); }
