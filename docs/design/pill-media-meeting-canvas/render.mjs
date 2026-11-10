// Render check at a 1640 viewport. Usage: node render.mjs  (set PUPPETEER_EXECUTABLE_PATH if needed)
// Shots every section and state, writes heights.json, checks console errors, broken images, horizontal overflow,
// clipped pill content, tag/note overlaps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let puppeteer; try { puppeteer = require('puppeteer'); } catch { puppeteer = require('E:/dev/yraverageSubMeetly/node_modules/puppeteer'); }
const out = path.join(here, 'renders'); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ['--no-sandbox'] });

const check = (id) => {
  const sec = document.getElementById(id); const probs = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const tags = [...sec.querySelectorAll('.newtag,.parttag')].filter(vis);
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) if (hit(tags[i].getBoundingClientRect(), tags[j].getBoundingClientRect())) probs.push(`tags overlap: ${tags[i].textContent}/${tags[j].textContent}`);
  // tab row must not run into the clock; strip and chips must fit; text must not spill its box
  sec.querySelectorAll('.pl .ph').forEach((ph) => { if (!vis(ph)) return; const clk = ph.querySelector('.clk').getBoundingClientRect(); const last = [...ph.children].filter((c) => !c.classList.contains('clk')).pop().getBoundingClientRect(); if (last.right > clk.left + 1) probs.push(`tab row overlaps clock by ${Math.round(last.right - clk.left)}`); });
  sec.querySelectorAll('.pl .qs').forEach((q) => { if (!vis(q)) return; if (q.scrollWidth > q.clientWidth + 1) probs.push(`quick strip too wide by ${q.scrollWidth - q.clientWidth}`); });
  sec.querySelectorAll('.pl,.pop,.sw2').forEach((p) => { if (!vis(p)) return; const pr = p.getBoundingClientRect(); p.querySelectorAll('*').forEach((e) => { if (!vis(e) || e.closest('.newtag,.parttag') || e.classList.contains('newtag') || e.classList.contains('parttag')) return; const r = e.getBoundingClientRect(); if (r.right > pr.right + 1 || r.bottom > pr.bottom + 1) probs.push(`${p.className.split(' ')[0]} content spills: <${e.tagName.toLowerCase()} class="${(e.className.baseVal ?? e.className).toString().slice(0, 20)}"> ${Math.round(r.right - pr.right)}x${Math.round(r.bottom - pr.bottom)}`); }); });
  sec.querySelectorAll('.pl .mt3,.pl .cc,.pl .lv,.pl .nt,.pl .cl,.pl .mp').forEach((e) => { if (!vis(e)) return; if (e.scrollHeight > e.clientHeight + 1) probs.push(`${e.className.split(' ')[0]} clipped ${e.scrollHeight}>${e.clientHeight}`); });
  const notes = [...sec.querySelectorAll('.note')].filter(vis);
  for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) if (hit(notes[i].getBoundingClientRect(), notes[j].getBoundingClientRect())) probs.push('notes overlap');
  return [...new Set(probs)];
};

try {
  const pg = await browser.newPage(); await pg.setViewport({ width: 1640, height: 1000 });
  const errs = []; pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto(pathToFileURL(path.join(here, 'pill-media-meeting-canvas.html')).href, { waitUntil: 'networkidle0', timeout: 60000 });
  const info = await pg.evaluate(() => ({
    heights: Object.fromEntries([...document.querySelectorAll('section[id]')].map((s) => [s.id, Math.ceil(s.getBoundingClientRect().height)])),
    sw: document.documentElement.scrollWidth,
    broken: [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src')),
  }));
  fs.writeFileSync(path.join(here, 'heights.json'), JSON.stringify(info.heights, null, 1));
  const ids = await pg.evaluate(() => [...document.querySelectorAll('section[id]')].map((s) => s.id));
  const problems = {}; let beforeShown = {};
  for (const id of ids) {
    const el = await pg.$('#' + id);
    const states = await pg.evaluate((i) => [...document.querySelectorAll(`#${i} [data-g="st"]`)].map((b) => b.dataset.k), id);
    if (await pg.$(`#${id} [data-g="ba"][data-k="before"]`)) {
      await pg.click(`#${id} [data-g="ba"][data-k="before"]`);
      beforeShown[id] = await pg.evaluate((i) => { const e = document.querySelector(`#${i} [data-p="ba:before"]`); const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }, id);
      await el.screenshot({ path: path.join(out, `${id}-before.png`) });
      await pg.click(`#${id} [data-g="ba"][data-k="after"]`);
    }
    for (const k of states.length ? states : [null]) {
      if (k) await pg.click(`#${id} [data-g="st"][data-k="${k}"]`);
      const p = await pg.evaluate(check, id);
      if (p.length) problems[k ? `${id}:${k}` : id] = p;
      await el.screenshot({ path: path.join(out, k ? `${id}-${k}.png` : `${id}.png`) });
    }
    if (states.length) await pg.click(`#${id} [data-g="st"][data-k="${states[0]}"]`);
  }
  console.log('problems', JSON.stringify(problems, null, 1));
  console.log('before panes', JSON.stringify(beforeShown));
  console.log(JSON.stringify({ errs, scrollWidth: info.sw, broken: info.broken, heights: info.heights }));
} finally { await browser.close(); }
