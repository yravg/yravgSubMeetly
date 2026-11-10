/**
 * T6: tidak ada kendali yang hilang. Setiap kendali yang dicatat dari halaman lama
 * (docs/design/tide-shell-canvas/shots/controls.json, ditangkap capture.mjs dari
 * app.html lab, panel samping, tab Pengaturan, tab lab dan minutes.html) harus bisa
 * dicapai dari kerangka baru dist/app.html: di halamannya sendiri atau di bingkai
 * yang dipasangnya. Label dibandingkan seperti capture.mjs mengambilnya, angka
 * dinormalkan ke '#', karena hitungan (XP, jumlah butir) berubah dengan data.
 *   node --test test/app-controls.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8911;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CONTROLS = JSON.parse(readFileSync(new URL('../docs/design/tide-shell-canvas/shots/controls.json', import.meta.url), 'utf8')).controls;
const norm = (k) => k.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
// Controls that were deliberately renamed (never removed): old label -> current label.
const RENAMED = {
  'button|Start Task': 'button|Start captions',
  'button|End Task': 'button|Stop captions',
  'button|Load sample data': 'button|Load demo meetings (removable)',
  // A04: the register's layout presets became the Density control in the shell page's Layout & appearance menu.
  'button|ReviewWide detail, sources below': 'button|Review',
  'button|ReadingHeader open, no side panels': 'button|Reading',
  'button|CompactRails only, dense rows': 'button|Compact',
};
const has = (found, k) => found.has(k) || found.has(RENAMED[k]);
let server; let browser; let page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await wait(120);
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}

/** Pengambil kendali yang sama dengan capture.mjs (terlihat, label dipotong 60). */
const dump = (frame) => frame.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const out = new Set();
  document.querySelectorAll('button, a[href], input, select, textarea, summary, [role=tab], [role=switch], [role=radio]').forEach((e) => {
    if (!vis(e)) return;
    const l = (e.getAttribute('aria-label') || e.title || e.textContent || e.placeholder || e.value || e.id || '').replace(/\s+/g, ' ').trim();
    out.add(`${e.tagName.toLowerCase()}${e.type && e.tagName === 'INPUT' ? ':' + e.type : ''}|${l.slice(0, 60)}`);
  });
  return [...out];
});

async function route(hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction((h) => document.querySelector('#page').dataset.route === h.replace(/^#/, '').split('?')[0], {}, hash);
  await wait(400);
}
/** Bingkai yang dipasang halaman sekarang, setelah dokumennya siap. */
async function frameOf(sel, settle = 1800) {
  const handle = await page.waitForSelector(`#page ${sel}`);
  const frame = await handle.contentFrame();
  await frame.waitForFunction(() => document.readyState === 'complete');
  await wait(settle);
  return frame;
}

const found = new Set();
const add = (list) => { for (const k of list) found.add(norm(k)); };

before(async () => {
  assert.ok(existsSync('dist/app.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/app.html`);
  await wait(1500); // Windows: the first browser request right after the probe is aborted without this
  browser = await puppeteer.launch({ headless: true });
  page = await browser.newPage();
  // controls.json ditangkap di Windows; panduan helper dan ekspor memberi label per OS (detectOs membaca UA).
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1600, height: 900 });
  // Helper tetap (fixture yang sama dengan chrome-mock): mesin ini menjalankan helper milik
  // worktree lain di 17865, dan label tombol perangkatnya bergantung pada CUDA helper itu.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.host !== '127.0.0.1:17865') return req.continue();
    const body = u.pathname === '/health'
      ? { ok: true, engine: 'faster-whisper', engine_label: 'faster-whisper', model: 'large-v3-turbo', device: 'cuda', platform: 'Windows', ffmpeg: true, translate: false, features: { transcribe_file_jobs: true, streaming_file_jobs: true } }
      : u.pathname === '/engine/device' ? { device: 'auto', active: 'cuda', compute: 'float16', cuda_available: true, supported: true, applied: true } : null;
    if (!body) return req.respond({ status: 404, body: '' });
    return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto(`${ORIGIN}/dist/app.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  add(await dump(page.mainFrame()));

  // Panel samping per halaman (sama dengan bottom-nav lama).
  for (const [h, sel] of [['#live', 'iframe.panel'], ['#notes', 'iframe.panel'], ['#history', 'iframe.panel'], ['#helper', 'iframe.panel']]) {
    await route(h); add(await dump(await frameOf(sel)));
  }
  await route('#settings');
  const st = await frameOf('iframe.panel');
  add(await dump(st));
  for (const t of ['engine', 'models', 'output', 'addins', 'about']) {
    await st.evaluate((x) => document.querySelector(`[data-stab="${x}"]`)?.click(), t); await wait(400);
    add(await dump(st));
  }
  // Area Developer = lab lama, tiap tab labnya.
  await route('#dev');
  const lab = await frameOf('iframe.dev', 2500);
  add(await dump(lab));
  for (const t of ['pages', 'mock', 'guides', 'panel']) {
    await lab.evaluate((x) => document.querySelector(`#ltabs [data-ltab="${x}"]`)?.click(), t); await wait(700);
    add(await dump(lab));
  }
  for (const v of ['captions', 'notes', 'history', 'helper', 'settings']) {
    await lab.evaluate((x) => document.querySelector(`.bottom-nav-item[data-view="${x}"], #view-tabs [data-view="${x}"]`)?.click(), v); await wait(600);
    add(await dump(lab));
  }
  // Halaman Minutes asli (A04, tanpa iframe): kosong, lalu data contoh, lalu menu Layout & appearance.
  await route('#minutes');
  add(await dump(page));
  await page.evaluate(() => [...document.querySelectorAll('#page button')].find((b) => /Load demo meetings/.test(b.textContent))?.click());
  await page.waitForSelector('#page .mn-row', { timeout: 8000 });
  await wait(500);
  add(await dump(page));
  await page.evaluate(() => document.querySelector('#page [data-mn="layout"]')?.click());
  await wait(300);
  add(await dump(page));
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

for (const [surface, list] of Object.entries(CONTROLS)) {
  test(`kendali ${surface} (${list.length}) masih ada di kerangka`, () => {
    const missing = list.filter((k) => !has(found, norm(k)));
    assert.deepEqual(missing, [], `${surface}: ${missing.length} kendali tidak ditemukan`);
  });
}

test('jumlah kendali yang dicatat tidak berkurang', () => {
  const all = new Set(Object.values(CONTROLS).flat().map(norm));
  assert.ok(all.size >= 180, `controls.json hanya ${all.size} label unik`);
  const missing = [...all].filter((k) => !has(found, k));
  assert.equal(missing.length, 0, `hilang: ${missing.join(' ; ')}`);
});
