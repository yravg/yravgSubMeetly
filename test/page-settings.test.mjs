/**
 * Papan A07 "Settings and Helper" sebagai halaman shell (TIDE-011) pada dist/app.html#settings|#helper.
 *   node --test test/page-settings.test.mjs
 *
 * Tujuh tab (General, Engine, Models, Output, Add-ins, Helper, About) memakai tampilan Settings
 * panel; tab Helper memuat kartu helper dari tampilan Helper lama. Pengaturan tersimpan lewat
 * kode panel yang sama (chrome.storage.local `settings`) dan bertahan setelah muat ulang.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8843;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page; let frame;
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if ((await fetch(url)).ok) return; } catch { /* retry */ } await wait(120); }
  throw new Error(`lab server tidak menyala di ${url}`);
}
const vis = (sel) => frame.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).catch(() => false);
async function openPage(hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction((h) => document.querySelector('#page').dataset.route === 'settings', {}, hash);
  frame = await (await page.waitForSelector('#page iframe.panel')).contentFrame();
  await frame.waitForSelector('#set-shell');
  await wait(600);
}

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
  await page.goto(`${ORIGIN}/dist/app.html#settings`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ysmShellWelcomed', 'true'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openPage('#settings');
});
after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('seven tabs, Back and search on one row, no panel title card', async () => {
  assert.deepEqual(await frame.$$eval('#settings-tabs button', (b) => b.map((x) => x.textContent.trim())), ['General', 'Engine', 'Models', 'Output', 'Add-ins', 'Helper', 'About']);
  const r = await frame.evaluate(() => { const a = document.getElementById('btn-close-settings').getBoundingClientRect(); const b = document.getElementById('settings-search').getBoundingClientRect(); return { sameRow: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 12, backLeft: a.right <= b.left + 1 }; });
  assert.deepEqual(r, { sameRow: true, backLeft: true });
  assert.equal(await vis('.modal-head'), false);
  assert.equal(await frame.$eval('#btn-close-settings', (b) => b.getAttribute('aria-label')), 'Back');
  assert.equal(await vis('#set-dev-switch'), false, 'the Developer row is for the extension / app window; the lab always shows the Developer area');
});

test('search filters rows; clearing restores them', async () => {
  const total = await frame.$$eval('[data-pane="general"] .setting-row', (r) => r.length);
  await frame.type('#settings-search', 'Tab rows');
  await frame.waitForFunction(() => document.querySelectorAll('[data-pane="general"] .setting-row.search-hidden').length > 0);
  await frame.$eval('#settings-search', (i) => { i.value = ''; i.dispatchEvent(new Event('input')); });
  await frame.waitForFunction((n) => document.querySelectorAll('[data-pane="general"] .setting-row.search-hidden').length === 0 && n > 0, {}, total);
});

test('settings persist: theme and UI language survive a reload', async () => {
  await frame.click('#theme-toggle button[data-theme="dark"]');
  await frame.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings?.theme === 'dark');
  await frame.$eval('#ui-lang-toggle', (s) => { s.value = 'id'; s.dispatchEvent(new Event('change')); });
  await frame.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings?.uiLang === 'id');
  await openPage('#settings'); // same route: force a fresh frame
  await page.reload({ waitUntil: 'domcontentloaded' });
  frame = await (await page.waitForSelector('#page iframe.panel')).contentFrame();
  await frame.waitForSelector('#set-shell');
  await wait(800);
  assert.equal(await frame.$eval('#theme-toggle button[data-theme="dark"]', (b) => b.classList.contains('active')), true);
  assert.equal(await frame.$eval('#ui-lang-toggle', (s) => s.value), 'id');
  assert.equal(await frame.$eval('#settings-tabs [data-stab="general"]', (b) => b.textContent.trim()).then((t) => t.length > 0), true);
  // back to English for the remaining tests
  await frame.$eval('#ui-lang-toggle', (s) => { s.value = 'en'; s.dispatchEvent(new Event('change')); });
  await frame.click('#theme-toggle button[data-theme="auto"]');
  await frame.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings?.uiLang === 'en');
});

test('Engine tab shows the engine controls; Output tab shows font size and Captions show on', async () => {
  await frame.click('#settings-tabs [data-stab="engine"]');
  await frame.waitForFunction(() => document.getElementById('settings-modal').dataset.stab === 'engine');
  assert.equal(await vis('#engine-toggle'), true);
  await frame.click('#settings-tabs [data-stab="output"]');
  await frame.waitForFunction(() => document.getElementById('settings-modal').dataset.stab === 'output');
  assert.equal(await vis('#font-size'), true);
  assert.equal(await vis('#surface-toggle'), true);
});

test('#helper opens Settings on the Helper tab: status, install guide and compute device', async () => {
  await openPage('#helper');
  assert.equal(await page.$eval('#page-title', (h) => h.textContent), 'Settings');
  assert.equal(await frame.$eval('#settings-modal', (m) => m.dataset.stab), 'helper');
  assert.equal(await frame.$eval('#settings-tabs [data-stab="helper"]', (b) => b.classList.contains('active')), true);
  for (const id of ['helper-status-card', 'helper-compute-card', 'native-device-toggle']) assert.equal(await vis(`#${id}`), true, `${id} is visible on the Helper tab`);
  assert.ok(await frame.$('#set-shell ~ * #helper-status-mount, [data-pane="helper"] #helper-status-mount'), 'the status mount moved into the Helper pane');
  await frame.click('#native-device-toggle button[data-hdevice="cpu"]');
  await frame.waitForFunction(() => document.querySelector('#native-device-toggle button[data-hdevice="cpu"]').classList.contains('active'), { timeout: 10_000 });
  await frame.click('#settings-tabs [data-stab="general"]');
  assert.equal(await vis('#helper-status-card'), false, 'other tabs hide the Helper pane');
});

test('no page errors', () => { assert.deepEqual(pageErrors, []); });
