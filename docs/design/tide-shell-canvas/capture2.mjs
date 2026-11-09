// Minutes with sample data loaded: Before shot + controls (adds to shots/controls.json).
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const f = join(here, 'shots/controls.json');
const data = JSON.parse(readFileSync(f, 'utf8'));
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 900 } });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8799/src/minutes.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Load sample data/.test(b.textContent))?.click());
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: join(here, 'shots/b-minutes-sample.png') });
  data.controls['minutes:sample'] = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const out = new Set();
    document.querySelectorAll('button, a[href], input, select, textarea, summary, [role=tab]').forEach((e) => { if (!vis(e)) return; const l = (e.getAttribute('aria-label') || e.title || e.textContent || e.placeholder || e.value || e.id || '').replace(/\s+/g, ' ').trim(); out.add(`${e.tagName.toLowerCase()}|${l.slice(0, 60)}`); });
    return [...out];
  });
} finally { await browser.close(); }
writeFileSync(f, JSON.stringify(data, null, 1));
console.log(data.controls['minutes:sample'].length);
console.log(data.controls['minutes:sample'].join(' ; '));
