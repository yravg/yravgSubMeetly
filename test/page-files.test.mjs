/**
 * Papan A05 "History and Files" sebagai halaman shell (TIDE-009) pada dist/app.html#history|#files.
 *   node --test test/page-files.test.mjs
 *
 * History: pencarian, baris (Open, TXT, SRT, VTT, hapus), kartu Export formats.
 * Files: drop → siap → berjalan (kemajuan jendela, Cancel) → selesai (enam format ekspor).
 * Pesan offscreen dikirim lewat penerima panel yang sama dengan pesan sungguhan; tidak ada
 * offscreen di lab, jadi tes mengirim offline-progress / -line / -done / -error sendiri.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const PORT = 8842;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page; let frame;
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if ((await fetch(url)).ok) return; } catch { /* retry */ } await wait(120); }
  throw new Error(`lab server tidak menyala di ${url}`);
}
const text = (sel) => frame.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
async function openPage(hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  frame = await (await page.waitForSelector('#page iframe.panel')).contentFrame();
  await frame.waitForSelector('#fh-shell');
  await wait(500);
}
const send = (type, data) => frame.evaluate((t, d) => chrome.runtime.sendMessage({ target: 'panel', type: t, data: d }), type, data);

before(async () => {
  assert.ok(existsSync('dist/app.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/app.html`);
  await wait(1500);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1440,1000'] });
  page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/dist/app.html#history`, { waitUntil: 'domcontentloaded' });
  const hist = [
    { id: 'h1', ts: Date.now() - 3600e3, mode: 'offline', title: 'K3 Weekly', url: '', srcLang: 'id', tgtLang: 'en', lines: [{ t0: 0, t1: 3, src: 'Selamat pagi semua', tgt: 'Good morning everyone' }] },
    { id: 'h2', ts: Date.now() - 7200e3, mode: 'offline', title: 'Toolbox talk', url: '', srcLang: 'id', tgtLang: 'en', lines: [{ t0: 0, t1: 4, src: 'Helm wajib dipakai', tgt: 'Helmets are mandatory' }] },
  ];
  await page.evaluate((h) => { localStorage.clear(); localStorage.setItem('ysmShellWelcomed', 'true'); localStorage.setItem('chromeMock:history', JSON.stringify(h)); }, hist);
  await page.reload({ waitUntil: 'domcontentloaded' });
  frame = await (await page.waitForSelector('#page iframe.panel')).contentFrame();
  await frame.waitForSelector('#fh-shell');
  // Seed through the mock's own save-history / delete-history so a later delete hits the same store.
  await frame.evaluate(async (h) => {
    const demo = (await chrome.storage.local.get('history')).history || [];
    for (const d of demo) await chrome.runtime.sendMessage({ target: 'bg', type: 'delete-history', data: { id: d.id, cacheKey: d.id } });
    for (const e of h) await chrome.runtime.sendMessage({ target: 'bg', type: 'save-history', data: e });
  }, hist);
  await frame.evaluate(() => document.getElementById('history-search').dispatchEvent(new Event('input')));
  await wait(600);
});
after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('History: page switch, search, rows with Open / TXT / SRT / VTT / delete, Export formats card', async () => {
  assert.deepEqual(await frame.$$eval('#fh-shell .fh-tabs button', (b) => b.map((x) => x.textContent.trim())), ['History', 'Files']);
  assert.equal(await frame.$eval('#fh-shell .fh-tabs button.on', (b) => b.dataset.go), 'history');
  assert.equal((await frame.$$('#history-list .h-item')).length, 2);
  assert.deepEqual(await frame.$$eval('#history-list .h-item:first-child .h-actions button', (b) => b.map((x) => x.textContent.trim())), ['Open', 'TXT', 'SRT', 'VTT', '🗑']);
  assert.ok(await frame.$('#fh-shell #export-mount'), 'Export formats card lives in the History card');
  await frame.type('#history-search', 'helm');
  await frame.waitForFunction(() => document.querySelectorAll('#history-list .h-item').length === 1);
  assert.match(await text('#history-list .h-title'), /Toolbox talk/);
  await frame.$eval('#history-search', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); });
  await frame.waitForFunction(() => document.querySelectorAll('#history-list .h-item').length === 2);
  await wait(400); // the list re-renders once more after the filter clears
});

test('History: Open shows the transcript in the Opened card; a row exports; delete removes the row', async () => {
  assert.equal(await frame.$eval('#fh-shell .fh-opened', (e) => e.hidden), true);
  await frame.click('#history-list .h-item:first-child .h-open');
  await frame.waitForFunction(() => document.querySelector('#fh-shell .fh-opened').hidden === false);
  assert.match(await text('#off-lines'), /Helmets are mandatory/); // save-history puts the newest first
  await frame.click('#history-list .h-item:first-child .h-srt');
  await frame.waitForFunction(() => /\.srt/i.test(document.getElementById('status-line').textContent), { timeout: 10_000 });
  await frame.click('#history-list .h-item:last-child .h-del');
  await frame.waitForFunction(() => document.querySelectorAll('#history-list .h-item').length === 1);
});

test('Files: drop zone → file staged is Ready with languages and Start', async () => {
  await openPage('#files');
  assert.equal(await frame.$eval('#fh-shell', (e) => e.dataset.state), 'drop');
  assert.match(await text('#fh-shell .fh-drop-t'), /Drop an audio or video file/);
  assert.match(await text('#fh-shell .fh-drop-b'), /2 GiB/);
  assert.equal(await frame.$eval('#fh-shell .fh-choose', (b) => b.textContent.trim()), 'Choose…');
  const wav = join(mkdtempSync(join(tmpdir(), 'ysm-files-')), 'site-b-toolbox.wav');
  writeFileSync(wav, Buffer.alloc(2 * 1024 * 1024, 7));
  await (await frame.$('#off-file')).uploadFile(wav);
  await frame.waitForFunction(() => document.getElementById('fh-shell').dataset.state === 'ready' && !document.getElementById('btn-start').disabled, { timeout: 30_000 });
  assert.match(await text('#fh-name'), /site-b-toolbox\.wav/);
  for (const id of ['src-lang', 'tgt-lang', 'task-toggle', 'btn-start']) assert.ok(await frame.$(`#fh-ready #${id}`), `${id} sits in the ready card`);
});

test('Files: Start → progress by window, Cancel sends offline-cancel and returns to Ready', async () => {
  await frame.evaluate(() => { window.__sent = []; chrome.runtime.onMessage.addListener((m) => { if (m?.target === 'offscreen') window.__sent.push(m.type); }); });
  await frame.click('#btn-start');
  await frame.waitForFunction(() => document.getElementById('fh-shell').dataset.state === 'running');
  await send('offline-progress', { stage: 'transcribe', idx: 31, total: 51 });
  await frame.waitForFunction(() => document.getElementById('fh-pct').textContent === '61%');
  assert.match(await text('#fh-win'), /window 31 of 51/);
  assert.equal(await frame.$eval('#fh-bar', (b) => b.getAttribute('aria-valuenow')), '61');
  await frame.waitForFunction(() => { const f = document.getElementById('fh-fill'); return Math.round((f.getBoundingClientRect().width / f.parentElement.getBoundingClientRect().width) * 100) === 61; }, { timeout: 5_000 });
  await frame.click('#btn-stop');
  assert.ok((await frame.evaluate(() => window.__sent)).includes('offline-cancel'), 'Cancel sent offline-cancel');
  await send('offline-error', { cancelled: true });
  await frame.waitForFunction(() => document.getElementById('fh-shell').dataset.state === 'ready');
});

test('Files: finished job offers TXT SRT VTT MD CSV JSON and each one exports', async () => {
  await frame.click('#btn-start');
  await frame.waitForFunction(() => document.getElementById('fh-shell').dataset.state === 'running');
  for (let i = 1; i <= 3; i += 1) await send('offline-line', { line: { t0: i * 3, t1: i * 3 + 3, src: `kalimat ${i}`, tgt: `sentence ${i}` }, idx: i, total: 3 });
  await send('offline-done', {});
  await frame.waitForFunction(() => document.getElementById('fh-shell').dataset.state === 'done');
  assert.match(await text('#fh-meta'), /^Done · .* of audio · 3 windows$/);
  assert.deepEqual(await frame.$$eval('#fh-export button', (b) => b.map((x) => x.textContent.trim())), ['TXT', 'SRT', 'VTT', 'MD', 'CSV', 'JSON']);
  for (const kind of ['txt', 'srt', 'vtt', 'md', 'csv', 'json']) {
    await frame.evaluate(() => { document.getElementById('status-text').textContent = ''; });
    await frame.click(`#fh-export button[data-kind="${kind}"]`);
    await frame.waitForFunction((k) => new RegExp(`\\.${k}`, 'i').test(document.getElementById('status-text').textContent), { timeout: 10_000 }, kind);
  }
});

test('R2 History: the page title is History', async () => {
  await page.evaluate(() => { location.hash = '#history'; });
  await page.waitForFunction(() => document.querySelector('#page').dataset.route === 'history');
  assert.equal(await page.$eval('#page-title', (h) => h.textContent), 'History');
  frame = await (await page.waitForSelector('#page iframe.panel')).contentFrame();
  await frame.waitForSelector('#fh-shell');
  await wait(600);
});

test('R2 History: Export formats is a compact card; the options sit behind a disclosure', async () => {
  const card = '#fh-shell .fh-list details.fh-export';
  assert.match(await text(`${card} > summary`), /Export formats/);
  assert.match(await text(`${card} > summary`), /SRT · VTT · TXT · MD · CSV · JSON/);
  assert.equal(await frame.$eval(card, (d) => d.open), false);
  const h = await frame.$eval(`${card} > summary`, (e) => e.getBoundingClientRect().height);
  const whole = await frame.$eval(card, (e) => e.getBoundingClientRect().height);
  assert.ok(whole <= h + 4, `closed: the card is only its summary (${whole}px vs ${h}px), the options are not shown`);
  assert.ok(h <= 90, `the closed card is compact (${h}px)`);
  await frame.click(`${card} > summary`);
  await frame.waitForFunction((c) => document.querySelector(c).getBoundingClientRect().height > 150, {}, card);
  assert.ok(await frame.$('#export-mount input[type="checkbox"]'), 'CRLF / BOM / suffix options are inside the disclosure');
  await frame.click(`${card} > summary`);
});

const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = (css) => css.match(/[\d.]+/g).slice(0, 3).map(Number);

test('R2 History: the delete icon has >= 3:1 against its tile, light and dark', async () => {
  const out = {};
  for (const scheme of ['light', 'dark']) {
    await frame.evaluate((c) => { document.documentElement.classList.remove('theme-light', 'theme-dark'); document.documentElement.classList.add(`theme-${c}`); }, scheme);
    await wait(300);
    const c = await frame.$eval('#history-list .h-item .h-del', (b) => ({ icon: getComputedStyle(b).color, tile: getComputedStyle(b).backgroundColor, mask: getComputedStyle(b, '::before').webkitMaskImage || getComputedStyle(b, '::before').maskImage }));
    assert.notEqual(c.mask, 'none', 'the icon is a mask drawn in the text colour');
    out[scheme] = ratio(rgb(c.icon), rgb(c.tile));
    assert.ok(out[scheme] >= 3, `${scheme}: delete icon ${c.icon} on ${c.tile} = ${out[scheme].toFixed(2)}:1`);
  }
  assert.notEqual(out.light, out.dark, 'dark mode really used its own colours');
  console.log('delete icon contrast', JSON.stringify(out));
  await frame.evaluate(() => document.documentElement.classList.remove('theme-light', 'theme-dark'));
});

test('no page errors', () => { assert.deepEqual(pageErrors, []); });
