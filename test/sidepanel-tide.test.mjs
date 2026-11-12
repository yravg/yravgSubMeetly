/**
 * T8 / TIDE-012: panel samping dengan token Tide (pilihan reskin "Tide"), pada
 * /panel-test.html (dist/sidepanel.* + chrome-mock). Tab tetap sama; maskot hanya
 * di keadaan kosong.
 *   node --test test/sidepanel-tide.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8915;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page;
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

before(async () => {
  assert.ok(existsSync('dist/theme-tide.css'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/panel-test.html`);
  browser = await puppeteer.launch({ headless: true });
  page = await browser.newPage();
  await page.setViewport({ width: 480, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(`${ORIGIN}/panel-test.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#reskin-toggle [data-reskin="tide"]');
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('pengguna baru: Tide dan terang tanpa memilih apa pun, tetap terang walau sistem gelap', async () => {
  assert.equal(await page.$$eval('#reskin-toggle [data-reskin]', (l) => l.length), 9, 'nine themes');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.reskin), 'tide');
  assert.equal(await page.$eval('#reskin-toggle [data-reskin="tide"]', (b) => b.getAttribute('aria-checked')), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-light')), true);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await wait(200);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).color), 'rgb(10, 15, 12)', 'terang dulu: sistem gelap tidak menggelapkan bawaan');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
});

test('pengguna lama di bawaan lama (Yraverage + otomatis tersimpan) pindah ke Tide terang', async () => {
  await page.evaluate(() => chrome.storage.local.set({ settings: { reskin: 'yraverage', theme: 'auto' } }));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.documentElement.dataset.reskin === 'tide');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-light')), true);
});

test('pilihan eksplisit bertahan: Teal (dulu Klasik) dan gelap tidak dipindah', async () => {
  await page.evaluate(() => document.querySelector('.bottom-nav-item[data-view="settings"]').click());
  await wait(300);
  await page.evaluate(() => { document.querySelector('#reskin-toggle [data-reskin="teal"]').click(); document.querySelector('#theme-toggle [data-theme="dark"]').click(); });
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'teal' && document.documentElement.classList.contains('theme-dark'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'teal');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.reskin), 'tide', 'the structure stays Tide; only the palette changes');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-dark')), true);
  await page.evaluate(() => document.querySelector('.bottom-nav-item[data-view="settings"]').click());
  await wait(300);
  await page.evaluate(() => { document.querySelector('#reskin-toggle [data-reskin="tide"]').click(); document.querySelector('#theme-toggle [data-theme="light"]').click(); });
  await page.waitForFunction(() => document.documentElement.dataset.reskin === 'tide');
  await page.reload({ waitUntil: 'networkidle0' });
});

test('terang sistem: token Tide menang atas tema terang panel', async () => {
  const r = await page.evaluate(() => ({ color: getComputedStyle(document.body).color, font: getComputedStyle(document.body).fontFamily }));
  assert.equal(r.color, 'rgb(10, 15, 12)', 'teks = tinta Tide');
  assert.match(r.font, /Plus Jakarta Sans/);
});

test('gelap: dengan "Otomatis" yang dipilih sendiri, sistem gelap memberi token Tide gelap', async () => {
  await page.evaluate(() => chrome.storage.local.set({ settings: { reskin: 'tide', reskinExplicit: true, theme: 'auto', themeExplicit: true } }));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await wait(200);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).color), 'rgb(232, 242, 236)');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
});

test('Riwayat kosong: Tide tertidur; tab tetap lima', async () => {
  // chrome-mock membawa satu sesi demo; kosongkan dulu supaya keadaan kosong tampil.
  await page.evaluate(() => chrome.storage.local.set({ history: [] }));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => document.querySelector('.bottom-nav-item[data-view="history"]').click());
  await wait(400);
  const bg = await page.$eval('#history-list > .empty', (e) => getComputedStyle(e, '::before').backgroundImage);
  assert.match(bg, /tide-sleep\.webp/);
  assert.equal(await page.$$eval('.bottom-nav-item', (l) => l.length), 5);
});

test('480 dan 390 px: tanpa gulir mendatar', async () => {
  for (const w of [480, 390]) {
    await page.setViewport({ width: w, height: 900 }); await wait(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `meluber di ${w}`);
  }
});

test('kembali ke Tide memulihkan warna bawaan (tanpa palet)', async () => {
  await page.evaluate(() => document.querySelector('.bottom-nav-item[data-view="settings"]').click());
  await wait(300);
  await page.evaluate(() => document.querySelector('#reskin-toggle [data-reskin="teal"]').click());
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'teal');
  await page.evaluate(() => document.querySelector('#reskin-toggle [data-reskin="tide"]').click());
  await page.waitForFunction(() => !document.documentElement.dataset.palette);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.reskin), 'tide');
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));
