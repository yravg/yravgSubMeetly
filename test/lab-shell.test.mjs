/**
 * Board D03: cangkang lab test/app.html — empat tab, 21 halaman uji, Mock helper,
 * overlay "How the lab works", log permintaan (waktu, hasil, tunda).
 *   node --test test/lab-shell.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8883;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;
let browser;
let page;
const pageErrors = [];

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}

before(async () => {
  assert.ok(existsSync('dist/sidepanel.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`${ORIGIN}/app.html`);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1280,900'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/app.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#app-mount .bottom-nav-item');
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const tab = async (t) => {
  await page.evaluate((x) => document.querySelector(`#ltabs button[data-ltab="${x}"]`).click(), t);
  await pause(50);
};
const visible = (sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return !!e && !e.hidden && e.getClientRects().length > 0;
  }, sel);
const bodyW = () => page.evaluate(() => Math.round(document.body.getBoundingClientRect().width));

test('empat tab; Panel terbuka bawaan dan panel produksi tetap terpasang saat tab lain dibuka', async () => {
  assert.deepEqual(await page.$$eval('#ltabs button', (b) => b.map((x) => x.dataset.ltab)), ['panel', 'pages', 'mock', 'guides']);
  assert.equal(await visible('#ltab-panel'), true);
  assert.equal(await visible('#app-mount .bottom-nav-item'), true);
  for (const t of ['pages', 'mock', 'guides', 'panel']) {
    await tab(t);
    const shown = await page.$$eval('.ltab', (s) => s.filter((x) => !x.hidden).map((x) => x.id));
    assert.deepEqual(shown, [`ltab-${t}`]);
  }
  assert.equal(await page.evaluate(() => !!document.querySelector('#app-mount #view-captions')), true, 'panel harus tetap terpasang');
});

test('Test pages memuat ke-21 halaman dalam lima kelompok; menu di bar memuat daftar yang sama', async () => {
  await tab('pages');
  const groups = await page.$$eval('#pages-grid .lcard', (c) =>
    c.map((x) => [x.querySelector('h3').childNodes[1]?.textContent.trim() || x.querySelector('h3').textContent.trim(), x.querySelectorAll('a.pgr').length]),
  );
  assert.equal(groups.length, 5);
  assert.equal(groups.reduce((n, g) => n + g[1], 0), 21);
  assert.match(groups.map((g) => g[0]).join('|'), /Guides and register.*Tools.*Release QA.*Extension harnesses.*More/);
  const hrefs = await page.$$eval('#pages-grid a.pgr', (a) => a.map((x) => x.getAttribute('href')));
  const menu = await page.$$eval('#pages-list a', (a) => a.map((x) => x.getAttribute('href')));
  assert.deepEqual(menu, hrefs);
  await tab('panel');
});

test('"How the lab works": terbuka, memuat paragraf pengembang, tertutup dengan Esc', async () => {
  await page.evaluate(() => document.getElementById('lab-how-btn').click());
  assert.equal(await visible('#lab-how'), true);
  const text = await page.$eval('#lab-how .dev', (p) => p.textContent);
  assert.match(text, /Browser tab · on-device Whisper — Same pipeline as the extension/);
  assert.match(text, /10–30s public-domain clips per language\./);
  await page.keyboard.press('Escape');
  assert.equal(await visible('#lab-how'), false);
});

test('preset lebar tetap bekerja dan tersimpan; Auto menjadi 880 saat Notes terbuka', async () => {
  const w = async (v) => {
    await page.evaluate((x) => document.querySelector(`#width-seg button[data-width="${x}"]`).click(), v);
    await pause(60);
    return bodyW();
  };
  assert.equal(await w('compact'), 480);
  assert.equal(await w('wide'), 880);
  assert.equal(await page.evaluate(() => localStorage.getItem('ysmAppWidth')), 'wide');
  assert.equal(await w('auto'), 480);
  await page.evaluate(() => document.querySelector('.bottom-nav-item[data-view="notes"]').click());
  await pause(150);
  assert.equal(await bodyW(), 880);
  await page.evaluate(() => document.querySelector('.bottom-nav-item[data-view="captions"]').click());
});

test('Mock helper: mode, latensi, failNext, fixture, log (waktu/hasil/tunda) dan Reset', async () => {
  await tab('mock');
  await page.evaluate(() => document.querySelector('#mock-mode button[data-mode="fixture"]').click());
  assert.equal(await page.evaluate(() => window.__labMock.helper.mode), 'fixture');
  await page.evaluate(() => {
    const el = document.getElementById('mock-latency');
    el.value = '120';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('mock-failnext').click();
  });
  assert.deepEqual(await page.evaluate(() => ({ l: window.__labMock.helper.latencyMs, f: window.__labMock.helper.failNext })), { l: 120, f: 1 });
  // Fixture JSON valid dipakai; JSON rusak ditolak tanpa merusak fixture.
  await page.evaluate(() => {
    const ta = document.getElementById('mock-health');
    ta.value = JSON.stringify({ ok: true, engine: 'lab-fixture', model: 'm', device: 'cpu', platform: 'Linux', ffmpeg: true, translate: false });
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => window.__labMock.helper.health.engine), 'lab-fixture');
  await page.evaluate(() => {
    const ta = document.getElementById('mock-device');
    ta.value = '{ rusak';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.match(await page.$eval('#mock-device-err', (e) => e.textContent), /Not applied/);
  assert.equal(await page.evaluate(() => typeof window.__labMock.helper.device.device), 'string');

  const out = await page.evaluate(async () => {
    window.__labMock.helper.log.length = 0;
    let first = 'ok';
    try {
      await fetch('http://127.0.0.1:17865/health');
    } catch {
      first = 'gagal';
    }
    const body = await (await fetch('http://127.0.0.1:17865/health')).json();
    return { first, engine: body.engine, log: window.__labMock.helper.log.map((r) => ({ ...r })) };
  });
  assert.equal(out.first, 'gagal', 'failNext menggagalkan satu permintaan');
  assert.equal(out.engine, 'lab-fixture');
  assert.equal(out.log.length, 2);
  assert.equal(out.log[0].result, 'Failed to fetch');
  assert.equal(out.log[1].result, '200');
  assert.ok(out.log[1].delayMs >= 100, `tunda tercatat (${out.log[1].delayMs} ms)`);
  assert.ok(!Number.isNaN(Date.parse(out.log[1].time)), 'stempel waktu ISO');
  await pause(100);
  assert.equal(await page.$$eval('#mock-log tr', (r) => r.length), 3, 'tabel: header + 2 baris');
  assert.equal(await page.$$eval('#mock-log tr.bad', (r) => r.length), 1, 'baris galat ditandai');

  await page.evaluate(() => document.getElementById('mock-reset').click());
  assert.deepEqual(
    await page.evaluate(() => ({ m: window.__labMock.helper.mode, l: window.__labMock.helper.latencyMs, f: window.__labMock.helper.failNext, n: window.__labMock.helper.log.length })),
    { m: 'passthrough', l: 0, f: 0, n: 0 },
  );
  assert.match(await page.$eval('#mock-log', (e) => e.textContent), /No requests yet/);
  await tab('panel');
});

test('rel kanan mencerminkan Helper mock; daftar sampel CC0 sama dengan bilah panel', async () => {
  await page.evaluate(() => {
    window.__labMock.helper.mode = 'offline';
  });
  await tab('mock');
  await tab('panel');
  assert.equal(await page.$eval('#rail-mode', (e) => e.textContent), 'offline');
  await page.evaluate(() => window.__labMock.reset());
  await pause(1800);
  const n = await page.evaluate(() => document.getElementById('rail-sample').options.length);
  const src = await page.evaluate(() => document.getElementById('qa-sample-select')?.options.length || 0);
  assert.equal(n, src, 'daftar sampel rel sama dengan bilah sampel panel');
});

test('tidak ada galat runtime', () => {
  assert.deepEqual(pageErrors, [], `galat halaman: ${pageErrors.join(' | ')}`);
});
