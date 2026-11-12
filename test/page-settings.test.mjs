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

test('Engine tab shows the engine controls; Output tab shows refine and dual line', async () => {
  await frame.click('#settings-tabs [data-stab="engine"]');
  await frame.waitForFunction(() => document.getElementById('settings-modal').dataset.stab === 'engine');
  assert.equal(await vis('#engine-toggle'), true);
  await frame.click('#settings-tabs [data-stab="output"]');
  await frame.waitForFunction(() => document.getElementById('settings-modal').dataset.stab === 'output');
  assert.equal(await vis('#refine'), true);
  assert.equal(await vis('#dual-line'), true);
});

test('#helper opens Settings on the Helper tab; the compute device sits under Engine', async () => {
  await openPage('#helper');
  assert.equal(await page.$eval('#page-title', (h) => h.textContent), 'Settings');
  assert.equal(await frame.$eval('#settings-modal', (m) => m.dataset.stab), 'helper');
  assert.equal(await frame.$eval('#settings-tabs [data-stab="helper"]', (b) => b.classList.contains('active')), true);
  assert.equal(await vis('#helper-status-card'), true, 'status card is visible on the Helper tab');
  assert.ok(await frame.$('#set-shell ~ * #helper-status-mount, [data-pane="helper"] #helper-status-mount'), 'the status mount moved into the Helper pane');
  await tab('engine');
  await frame.click('#native-device-toggle button[data-hdevice="cpu"]');
  await frame.waitForFunction(() => document.querySelector('#native-device-toggle button[data-hdevice="cpu"]').classList.contains('active'), { timeout: 10_000 });
  await frame.click('#settings-tabs [data-stab="general"]');
  assert.equal(await vis('#helper-status-card'), false, 'other tabs hide the Helper pane');
});

test('no page errors', () => { assert.deepEqual(pageErrors, []); });

/* ---- Round 2: rows as drawn on A07 / A07-general / A07-engine ---- */
const rowLabels = (pane) => frame.$$eval(`[data-pane="${pane}"] .setting-row`, (r) => r.map((x) => x.querySelector('label, .set-lbl')?.textContent.replace(/\s+/g, ' ').trim()));
async function tab(name) {
  await frame.click(`#settings-tabs [data-stab="${name}"]`);
  await frame.waitForFunction((n) => document.getElementById('settings-modal').dataset.stab === n, {}, name);
}

test('R2 General rows, in the board order, each with its hint', async () => {
  await openPage('#settings');
  await tab('general');
  assert.deepEqual(await rowLabels('general'), ['Language', 'Appearance', 'Theme', 'Accent', 'Tab rows', 'Font size', 'Density and dock motion']);
  assert.equal(await frame.$eval('[data-pane="general"] .setting-row .set-hint', (h) => h.textContent.trim()), 'Interface language');
  assert.ok(await frame.$('[data-pane="general"] #theme-toggle'), 'Appearance keeps Auto / Light / Dark');
  assert.equal((await frame.$$('[data-pane="general"] #reskin-toggle [data-reskin]')).length, 9, 'all nine themes');
  assert.deepEqual(await frame.$$eval('[data-pane="general"] #tcolor-toggle button', (b) => b.map((x) => x.textContent.trim())), ['Indigo', 'Navy', 'Teal', 'Neutral', 'Bronze']);
  assert.ok(await frame.$('[data-pane="general"] #font-size'), 'font size moved to General');
  assert.equal(await vis('#btn-reskin-reset'), true);
  const last = await frame.evaluate(() => { const r = [...document.querySelectorAll('[data-pane="general"] > *')].filter((e) => e.getBoundingClientRect().height > 0); return r.at(-1).querySelector('#btn-reskin-reset') !== null || r.at(-1).id === 'btn-reskin-reset'; });
  assert.equal(last, true, 'Reset to default closes the list');
});

test('R2 Density row writes the Minutes row density; font size shows its value', async () => {
  await frame.click('[data-pane="general"] [data-row-density="compact"]');
  assert.equal(await frame.evaluate(() => localStorage.getItem('ysmRowDensity')), 'compact');
  assert.equal(await frame.$eval('[data-pane="general"] [data-row-density="compact"]', (b) => b.getAttribute('aria-pressed')), 'true');
  await frame.$eval('#font-size', (i) => { i.value = '30'; i.dispatchEvent(new Event('input')); });
  assert.match(await frame.$eval('[data-pane="general"] .set-font-val', (e) => e.textContent), /30 px/);
  await frame.click('[data-pane="general"] [data-row-density="reading"]');
});

test('R2 Engine rows in the board order; Captions show on is the last row', async () => {
  await tab('engine');
  assert.deepEqual(await rowLabels('engine'), ['Engine', 'Device', 'Browser engine', 'Model source', 'Quality', 'Export folder', 'Captions show on']);
  for (const id of ['engine-toggle', 'native-device-toggle', 'device-toggle', 'mirror-toggle', 'asr-preset-toggle', 'btn-pick-export-folder', 'surface-toggle', 'asr-models']) assert.ok(await frame.$(`[data-pane="engine"] #${id}`), `${id} is in the Engine pane`);
  assert.deepEqual(await frame.$$eval('[data-pane="engine"] #device-toggle button', (b) => b.map((x) => x.textContent.trim())), ['Auto', 'WebGPU', 'WASM']);
});

test('R2 Helper tab: Install row with a Windows / Linux / macOS picker that switches the guide; fits at 390', async () => {
  await tab('helper');
  assert.deepEqual(await frame.$$eval('[data-pane="helper"] .hg-os-tabs button', (b) => b.map((x) => x.textContent.replace(/[ ·]/g, ''))), ['Windows', 'Linux', 'macOS']);
  const guide = () => frame.$eval('[data-pane="helper"] .helper-guide', (g) => g.dataset.os);
  await frame.click('[data-pane="helper"] .hg-os-tabs [data-os="macos"]');
  await frame.waitForFunction(() => document.querySelector('[data-pane="helper"] .helper-guide')?.dataset.os === 'macos');
  assert.equal(await guide(), 'macos');
  await frame.click('[data-pane="helper"] .hg-os-tabs [data-os="windows"]');
  await page.setViewport({ width: 390, height: 900 });
  await wait(600);
  const clipped = await frame.evaluate(() => { const t = document.getElementById('settings-tabs'); return { sw: t.scrollWidth, cw: t.clientWidth, doc: document.documentElement.scrollWidth, win: innerWidth }; });
  assert.ok(clipped.sw <= clipped.cw + 1, `tabs fit without clipping at 390 (${clipped.sw} > ${clipped.cw})`);
  assert.ok(clipped.doc <= clipped.win + 1, 'no horizontal page scroll at 390');
  await page.setViewport({ width: 1440, height: 1000 });
});
