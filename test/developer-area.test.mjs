/**
 * A08: area Developer asli di app shell (lab saja) — bukan bingkai /app.html. Tab Panel / Test pages /
 * Mock helper / Guides and docs, segmen lebar, sampel CC0, Helper mock (window.__labMock milik panel
 * yang dipasang), log permintaan, status lab dan log overlay.
 *   node --test test/developer-area.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8832;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page; let frame;
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await wait(120);
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}
const tab = async (t) => { await page.evaluate((x) => document.querySelector(`#dv-tabs [data-dtab="${x}"]`).click(), t); await wait(60); };
const shown = () => page.$$eval('.dv-pane', (l) => l.filter((x) => !x.hidden).map((x) => x.id));
const mock = () => frame.evaluate(() => ({ mode: window.__labMock.helper.mode, latency: window.__labMock.helper.latencyMs, failNext: window.__labMock.helper.failNext }));

before(async () => {
  assert.ok(existsSync('dist/app-pages/developer.css'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/app.html`);
  await wait(1500);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1440,1000'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/dist/app.html#dev`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.setItem('ysmShellWelcomed', 'true'); localStorage.removeItem('ysmAppWidth'); });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#dv-tabs');
  frame = await (await page.waitForSelector('#dv-frame')).contentFrame();
  await frame.waitForSelector('.bottom-nav-item', { timeout: 20000 });
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('halaman asli: tanpa bingkai lab, dengan banner, baris lebar dan empat tab', async () => {
  assert.equal(await page.$('#page iframe.dev'), null, 'tidak lagi membingkai /app.html');
  assert.match(await page.$eval('#page .callout.warn', (e) => e.textContent), /Developer area\. On in the lab/);
  assert.deepEqual(await page.$$eval('#dv-tabs [role=tab]', (l) => l.map((b) => b.textContent.trim())), ['Panel', 'Test pages', 'Mock helper', 'Guides and docs']);
  assert.deepEqual(await shown(), ['dtab-panel']);
  for (const t of ['pages', 'mock', 'guides', 'panel']) { await tab(t); assert.deepEqual(await shown(), [`dtab-${t}`]); }
  assert.equal(await page.$eval('#dv-tabs [data-dtab="panel"]', (b) => b.getAttribute('aria-selected')), 'true');
  assert.deepEqual(await page.$$eval('#dv-width button', (l) => l.map((b) => `${b.textContent.trim()}|${b.title}`)), ['Auto|Compact for Captions, wide for Notes', 'Compact|Side-panel width (480px)', 'Wide|880px', 'Full|Whole window']);
  assert.equal(await page.$eval('#dv-how-btn', (b) => b.textContent.trim()), 'How the lab works');
  assert.equal(await page.$eval('a[href="/src/minutes.html"]', (a) => a.textContent.trim()), 'Minutes register');
});

test('segmen lebar mengatur lebar panel dan diingat', async () => {
  const w = () => page.$eval('#dv-frame', (f) => Math.round(f.getBoundingClientRect().width));
  for (const [mode, expected] of [['compact', 480], ['wide', 880]]) {
    await page.click(`#dv-width [data-width="${mode}"]`); await wait(100);
    assert.equal(await w(), expected, mode);
    assert.equal(await page.$eval(`#dv-width [data-width="${mode}"]`, (b) => b.getAttribute('aria-pressed')), 'true');
  }
  await page.click('#dv-width [data-width="full"]'); await wait(100);
  assert.ok(await w() > 1000, 'full: selebar kolom');
  assert.equal(await page.evaluate(() => localStorage.getItem('ysmAppWidth')), 'full');
  await page.click('#dv-width [data-width="auto"]'); await wait(100);
  assert.equal(await w(), 480, 'auto: lebar panel samping untuk Captions');
});

test('Test pages: 21 halaman dalam lima kelompok, label tautan seperti di lab; menu di bar sama daftarnya', async () => {
  await tab('pages');
  const groups = await page.$$eval('#dv-grid .dv-card', (c) => c.map((x) => x.querySelectorAll('a.pgr').length));
  assert.deepEqual(groups, [4, 7, 4, 4, 2]);
  assert.equal(await page.$$eval('#dv-pages-list a', (l) => l.length), 21);
  const first = await page.$eval('#dv-grid a.pgr', (a) => a.textContent.replace(/\s+/g, ' ').trim());
  assert.match(first, /^Panduan pengguna — ekstensi/);
  assert.match(first, /\/guide\.html$/, 'label = nama + keterangan + alamat, supaya kendali lama tetap terdaftar');
  assert.equal(await page.$eval('#dv-grid a.pgr[href="/overlay-test.html"]', (a) => a.textContent.replace(/\s+/g, ' ').trim()), 'Overlay test/overlay-test.html');
});

test('sampel CC0 mencerminkan pilihan panel dan Run sample menekan tombol panel', async () => {
  await tab('pages');
  await page.waitForFunction(() => document.querySelectorAll('#dv-sample option').length > 1, { timeout: 15000 });
  const opts = await page.$$eval('#dv-sample option', (l) => l.length);
  assert.equal(opts, await frame.$$eval('#qa-sample-select option', (l) => l.length));
  const second = await page.$eval('#dv-sample', (s) => s.options[1].value);
  await page.select('#dv-sample', second);
  assert.equal(await frame.$eval('#qa-sample-select', (s) => s.value), second, 'pilihan diteruskan ke panel');
  await frame.evaluate(() => { window.__runClicks = 0; document.getElementById('btn-qa-run').addEventListener('click', () => { window.__runClicks += 1; }); });
  await page.click('#dv-sample-run');
  assert.equal(await frame.evaluate(() => window.__runClicks), 1);
});

test('Mock helper: mode, latensi, failNext mengubah __labMock panel; Reset memulihkan', async () => {
  await tab('mock');
  await page.click('#dv-mode [data-mode="fixture"]');
  assert.equal((await mock()).mode, 'fixture');
  assert.equal(await page.$eval('#dv-mode [data-mode="fixture"]', (b) => b.getAttribute('aria-pressed')), 'true');
  assert.match(await page.$eval('#dv-mode-note', (e) => e.textContent), /Answers \/health and \/engine\/device from the fixtures/);
  await page.$eval('#dv-latency', (i) => { i.value = ''; });
  await page.type('#dv-latency', '250');
  assert.equal((await mock()).latency, 250);
  await page.click('#dv-failnext');
  assert.equal((await mock()).failNext, 1);
  await page.click('#dv-reset');
  assert.deepEqual(await mock(), { mode: 'passthrough', latency: 0, failNext: 0 });
  assert.equal(await page.$eval('#dv-failnext', (c) => c.checked), false);
});

test('Mock helper: fixture JSON menjawab /health; JSON rusak ditolak dengan pesan; log mencatat dan bisa dibersihkan', async () => {
  await tab('mock');
  await page.click('#dv-mode [data-mode="fixture"]');
  await page.$eval('#dv-health', (t) => { t.value = ''; });
  await page.type('#dv-health', '{"ok":true,"device":"cuda","model":"fixture-model"}');
  const health = await frame.evaluate(async () => (await fetch('http://127.0.0.1:17865/health')).json());
  assert.equal(health.model, 'fixture-model');
  await page.waitForFunction(() => /\/health/.test(document.querySelector('#dv-log')?.textContent || ''));
  assert.match(await page.$eval('#dv-log', (e) => e.textContent), /GET.*\/health.*200/s);
  await page.$eval('#dv-device', (t) => { t.value = ''; });
  await page.type('#dv-device', '[1,2]');
  assert.match(await page.$eval('#dv-device-err', (e) => e.textContent), /Not applied: must be a JSON object/);
  assert.equal(await page.$eval('#dv-device', (t) => t.classList.contains('bad')), true);
  await page.click('#dv-log-clear');
  assert.match(await page.$eval('#dv-log', (e) => e.textContent), /No requests yet/);
  await page.click('#dv-reset');
});

test('failNext membuat permintaan berikutnya gagal sekali, mode offline gagal terus', async () => {
  await tab('mock');
  await page.click('#dv-mode [data-mode="fixture"]');
  await page.click('#dv-failnext');
  const r1 = await frame.evaluate(async () => { try { await fetch('http://127.0.0.1:17865/health'); return 'ok'; } catch { return 'fail'; } });
  const r2 = await frame.evaluate(async () => { try { await fetch('http://127.0.0.1:17865/health'); return 'ok'; } catch { return 'fail'; } });
  assert.deepEqual([r1, r2], ['fail', 'ok']);
  await page.click('#dv-mode [data-mode="offline"]');
  assert.equal(await frame.evaluate(async () => { try { await fetch('http://127.0.0.1:17865/health'); return 'ok'; } catch { return 'fail'; } }), 'fail');
  await page.click('#dv-reset');
});

test('status lab dan log overlay ada di tab Mock helper', async () => {
  await tab('mock');
  const txt = await page.$eval('#dv-status', (e) => e.textContent.replace(/\s+/g, ' '));
  assert.match(txt, /Lab status/);
  assert.match(txt, new RegExp(`:${PORT}`));
  assert.match(txt, /Panel mounted/);
  assert.match(await page.$eval('#dv-overlay', (e) => e.textContent), /No overlay messages yet|:/);
  // Pesan overlay dicatat mock panel (content.log) lalu memicu 'labmock:log' — log halaman Developer mengikutinya.
  await frame.evaluate(() => { window.__labMock.content.log.push({ type: 'subtitle', data: { source: 'halo dunia' } }); window.dispatchEvent(new CustomEvent('labmock:log')); });
  await page.waitForFunction(() => /subtitle: halo dunia/.test(document.querySelector('#dv-overlay')?.textContent || ''), { timeout: 5000 });
});

test('Guides and docs: tiga panduan pengguna, tiga dokumen proyek; "How the lab works" membuka dan Escape menutup', async () => {
  await tab('guides');
  assert.deepEqual(await page.$$eval('#dtab-guides a.pgr', (l) => l.map((a) => a.getAttribute('href'))), ['/guide.html', '/guide.html?doc=USER-GUIDE-MACOS.md', '/guide.html?doc=USER-GUIDE-WINLINUX.md', '/docs/DEVELOPMENT.md', '/docs/QA.md', '/docs/RELEASE-CHECKLIST.md']);
  assert.equal(await page.$eval('#dv-how', (d) => d.hidden), true);
  await page.click('#dv-how-btn');
  assert.equal(await page.$eval('#dv-how', (d) => d.hidden), false);
  assert.match(await page.$eval('#dv-how', (d) => d.textContent), /Browser tab · on-device Whisper/);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#dv-how', (d) => d.hidden), true);
});

test('Panel: panel produksi terpasang, catatan "needs the extension" dan "choose an input" tampil', async () => {
  await tab('panel');
  assert.equal(await frame.evaluate(() => !!document.querySelector('#view-captions')), true);
  const t = await page.$eval('#dtab-panel', (e) => e.textContent);
  assert.match(t, /Needs the Chrome extension/);
  assert.match(t, /Choose an input/);
  assert.match(t, /Open mock controls/);
  await page.click('#dv-open-mock');
  assert.deepEqual(await shown(), ['dtab-mock']);
});

test('390 px: tanpa gulir mendatar di semua tab', async () => {
  await page.setViewport({ width: 390, height: 844 }); await wait(250);
  for (const t of ['panel', 'pages', 'mock', 'guides']) {
    await tab(t); await wait(100);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `meluber di ${t}`);
  }
  await page.setViewport({ width: 1440, height: 1000 });
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));
