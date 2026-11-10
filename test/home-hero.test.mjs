/**
 * Beranda Today seperti papan A01: terang bawaan, nama pada sapaan, kaki sidebar dengan pengguna,
 * pengalih seri dengan baris ketua, urutan nav. (Hero utuh di tiap keadaan: test/app-shell.test.mjs.)
 *   node --test test/home-hero.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { createMeeting, wrapMeetingStore } from '../src/lib/notes-schema.js';

const PORT = 8831;
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

const today = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const item = (ref, type, owner) => ({ ref, type, owner, due: null, status: 'open', text: { en: `${ref} text` } });
const env = wrapMeetingStore([
  { ...createMeeting({ id: 'H1', seriesId: 'SB', seq: 1, title: 'K3 Weekly', date: today(), start: '07:00', end: '07:30', chair: 'James Miller', items: [item('A1', 'action', 'Enrico'), item('A2', 'action', 'enrico'), item('A3', 'action', 'Mei Lin')] }), issuedAt: '2026-01-01T00:00:00Z' },
]);

before(async () => {
  assert.ok(existsSync('dist/app-pages/home.css'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/app.html`);
  await wait(1500);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1440,1000'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); // sistem gelap: bawaan tetap terang
  await page.goto(`${ORIGIN}/dist/app.html`, { waitUntil: 'networkidle0' });
  await page.evaluate((e) => { localStorage.clear(); localStorage.setItem('ysmShellWelcomed', 'true'); localStorage.setItem('minutesRegister', JSON.stringify(e)); }, env);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const setSettings = async (settings) => { await page.evaluate((s) => chrome.storage.local.set({ settings: s }), settings); await wait(300); };

test('terang bawaan walau sistem gelap; gelap bila dipilih; Auto mengikuti sistem', async () => {
  assert.equal(await bg(), 'rgb(255, 255, 255)', 'tanpa pilihan: terang');
  await setSettings({ theme: 'dark', themeExplicit: true });
  assert.equal(await bg(), 'rgb(17, 28, 24)', 'gelap dipilih');
  await setSettings({ theme: 'auto', themeExplicit: true });
  assert.equal(await bg(), 'rgb(17, 28, 24)', 'Auto + sistem gelap');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  assert.equal(await bg(), 'rgb(255, 255, 255)', 'Auto + sistem terang');
  await setSettings({ theme: 'light', themeExplicit: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  assert.equal(await bg(), 'rgb(255, 255, 255)', 'terang dipilih');
  await page.evaluate(() => chrome.storage.local.remove('settings')); await wait(300);
});

test('nav persis papan: Meetings, Features (All features 8), Developer di lab', async () => {
  assert.deepEqual(await page.$$eval('#nav-meetings a', (l) => l.map((a) => a.dataset.route)), ['today', 'live', 'minutes', 'history', 'files']);
  assert.deepEqual(await page.$$eval('#nav-features a', (l) => l.map((a) => a.dataset.route)), ['addins', 'glossary', 'island', 'perf', 'all', 'settings', 'dev']);
  const counts = await page.$$eval('.nav a .n', (l) => l.map((n) => `${n.parentElement.dataset.route}:${n.textContent}`));
  assert.deepEqual(counts, ['minutes:3', 'all:8', 'dev:lab']);
});

test('pengalih seri: nama seri dan baris ketua dari register', async () => {
  await page.select('#series-select', 'SB');
  await page.waitForFunction(() => document.querySelector('#series-sub').textContent.includes('chair James Miller'));
  assert.equal(await page.$eval('#series-sub', (e) => e.textContent), '1 meeting · chair James Miller');
  await page.select('#series-select', '');
});

test('nama: kaki sidebar meminta nama; setelah disimpan tampil di sapaan, inisial, dan hitungan "milik Anda"', async () => {
  assert.equal(await page.$eval('#foot-name', (e) => e.textContent), 'Set your name');
  assert.doesNotMatch(await page.$eval('.hero h2', (h) => h.textContent), /,/);
  assert.doesNotMatch(await page.$eval('.brow .nm small', (s) => s.textContent), /yours/);
  await page.click('#foot-av');
  await page.waitForSelector('#name-pop input', { visible: true });
  await page.type('#name-pop input', 'Enrico');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.hero h2')?.textContent.endsWith(', Enrico.'));
  assert.equal(await page.$eval('#foot-name', (e) => e.textContent), 'Enrico');
  assert.equal(await page.$eval('#foot-av', (e) => e.textContent), 'E');
  const actions = await page.$$eval('.brow', (l) => l.map((r) => r.querySelector('.nm small').textContent).find((t) => /yours/.test(t)));
  assert.match(actions, /3 of 3 items · 2 yours/, 'dua tindak lanjut atas nama Enrico (huruf besar/kecil diabaikan)');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.hero h2')?.textContent.endsWith(', Enrico.'));
  await page.click('#foot-av');
  await page.click('[data-act="name-clear"]');
  await page.waitForFunction(() => !document.querySelector('.hero h2').textContent.includes(','));
});

test('hero: pemandangan, jam sinkron helper; tanpa gulir mendatar di 1440, 1024, 390', async () => {
  assert.equal(await page.$$eval('.hero .hero-bg svg.harbour circle.sun', (l) => l.length), 1);
  assert.match(await page.$eval('.hero .sub', (e) => e.textContent), /last synced \d\d:\d\d/);
  for (const w of [1440, 1024, 390]) {
    await page.setViewport({ width: w, height: 900 }); await wait(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `meluber di ${w}`);
    const box = await page.$eval('.hero', (h) => { const r = h.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    assert.ok(box.l >= 0 && box.r <= w, `hero di luar layar di ${w}`);
    const ask = await page.$eval('.askbar', (a) => a.getBoundingClientRect().right);
    assert.ok(ask <= w, `bilah tanya terpotong di ${w}`);
  }
  await page.setViewport({ width: 1440, height: 1000 });
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));
