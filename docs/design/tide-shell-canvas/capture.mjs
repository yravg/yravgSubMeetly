// Captures Before shots + a dump of every visible control. Run from the repo root:
//   PUPPETEER_EXECUTABLE_PATH=... node docs/design/tide-shell-canvas/capture.mjs
// One browser, closed at the end (low-memory machine).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const shot = (p) => join(here, 'shots', p);
const BASE = 'http://127.0.0.1:8799';
const dump = (page) => page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const out = new Set();
  document.querySelectorAll('button, a[href], input, select, textarea, summary, [role=tab], [role=switch], [role=radio]').forEach((e) => {
    if (!vis(e)) return;
    const l = (e.getAttribute('aria-label') || e.title || e.textContent || e.placeholder || e.value || e.id || '').replace(/\s+/g, ' ').trim();
    out.add(`${e.tagName.toLowerCase()}${e.type && e.tagName === 'INPUT' ? ':' + e.type : ''}|${l.slice(0, 60)}`);
  });
  return [...out];
});
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 900 } });
const controls = {};
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/app.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  for (const v of ['captions', 'notes', 'history', 'helper', 'settings']) {
    await page.evaluate((v) => document.querySelector(`.bottom-nav-item[data-view="${v}"], #view-tabs [data-view="${v}"]`)?.click(), v);
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: shot(`b-${v}.png`) });
    controls[`panel:${v}`] = await dump(page);
  }
  // settings sub tabs
  for (const t of ['engine', 'models', 'output', 'addins', 'about']) {
    await page.evaluate((t) => document.querySelector(`[data-stab="${t}"]`)?.click(), t);
    await new Promise((r) => setTimeout(r, 400));
    controls[`settings:${t}`] = await dump(page);
  }
  await page.evaluate(() => document.querySelector('[data-stab="general"]')?.click());
  for (const t of ['pages', 'mock', 'guides']) {
    await page.evaluate((t) => document.querySelector(`#ltabs [data-ltab="${t}"]`)?.click(), t);
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: shot(`b-lab-${t}.png`) });
    controls[`lab:${t}`] = await dump(page);
  }
  await page.evaluate(() => document.querySelector('#ltabs [data-ltab="panel"]')?.click());
  await new Promise((r) => setTimeout(r, 500));
  controls['lab:bar+panel'] = await dump(page);
  await page.goto(`${BASE}/src/minutes.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: shot('b-minutes.png') });
  controls['minutes'] = await dump(page);
} finally { await browser.close(); }
writeFileSync(shot('controls.json'), JSON.stringify({ errors, controls }, null, 1));
console.log(Object.entries(controls).map(([k, v]) => `${k}: ${v.length}`).join('\n'), '\nerrors', errors.length);
