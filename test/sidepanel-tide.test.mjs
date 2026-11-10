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

test('pilihan Tide ada di Reskin, dipasang di :root dan tersimpan', async () => {
  assert.equal(await page.$$eval('#reskin-toggle [data-reskin]', (l) => l.length), 4);
  await page.evaluate(() => document.querySelector('#reskin-toggle [data-reskin="tide"]').click());
  await page.waitForFunction(() => document.documentElement.dataset.reskin === 'tide');
  assert.equal(await page.$eval('#reskin-toggle [data-reskin="tide"]', (b) => b.getAttribute('aria-checked')), 'true');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.documentElement.dataset.reskin === 'tide');
});

test('terang sistem: token Tide menang atas tema terang panel', async () => {
  const r = await page.evaluate(() => ({ color: getComputedStyle(document.body).color, font: getComputedStyle(document.body).fontFamily }));
  assert.equal(r.color, 'rgb(10, 15, 12)', 'teks = tinta Tide');
  assert.match(r.font, /Plus Jakarta Sans/);
});

test('gelap: token Tide gelap', async () => {
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

test('kembali ke Yraverage memulihkan tampilan lama', async () => {
  await page.evaluate(() => document.querySelector('.bottom-nav-item[data-view="settings"]').click());
  await wait(300);
  await page.evaluate(() => document.querySelector('#reskin-toggle [data-reskin="yraverage"]').click());
  await page.waitForFunction(() => document.documentElement.dataset.reskin === 'yraverage');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).color), 'rgb(10, 15, 12)');
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));
