/**
 * A06: "Installed add-ins" sebagai baris kartu asli di halaman All features (tanpa bingkai panel),
 * memakai lib/addins.js: gerbang kepercayaan yang sama (hash manifes), tinjauan manifes, Trust and
 * enable, Disable, Remove, Restore, Undo; terkunci saat rapat terbuka sudah terbit.
 *   node --test test/addins-rows.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { manifestHash } from '../src/lib/addins.js';
import { createMeeting, wrapMeetingStore } from '../src/lib/notes-schema.js';

const PORT = 8833;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page;
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = (id) => JSON.parse(readFileSync(new URL(`../src/addins/${id}/manifest.json`, import.meta.url), 'utf8'));
const IDS = ['flag-decision', 'actions', 'recap-email', 'glossary', 'due-to-calendar'];

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await wait(120);
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}
const trust = () => page.evaluate(async () => (await chrome.storage.local.get(['ysmAddinTrust', 'ysmAddinRemoved'])));
const row = (id) => `.ia-row[data-id="${id}"]`;
const pill = (id) => page.$eval(`${row(id)} .ia-pill`, (e) => e.textContent.trim());
const btns = (id) => page.$$eval(`${row(id)} .ia-btns button`, (l) => l.map((b) => b.textContent.trim()));

before(async () => {
  assert.ok(existsSync('dist/app-pages/addins.css'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/app.html`);
  await wait(1500);
  browser = await puppeteer.launch({ headless: true });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/dist/app.html#all`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ysmShellWelcomed', 'true'); });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.ia-row');
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('baris asli untuk kelima add-in, tanpa bingkai; semua menunggu kepercayaan', async () => {
  assert.equal(await page.$('#addins-pane iframe'), null);
  assert.deepEqual(await page.$$eval('.ia-row', (l) => l.map((r) => r.dataset.id)), IDS);
  for (const id of IDS) {
    assert.equal(await pill(id), 'Needs trust', id);
    assert.deepEqual(await btns(id), ['Trust and enable', 'Review manifest', 'Remove'], id);
  }
  assert.match(await page.$eval(row('recap-email'), (r) => r.textContent), /Recap email/);
  assert.match(await page.$eval('#addins-pane', (p) => p.textContent), /5 add-ins wait for trust/);
});

test('Review manifest membuka manifes dan hash, menutup lagi', async () => {
  await page.click(`${row('glossary')} [data-ia="review"]`);
  await page.waitForSelector(`${row('glossary')} .ia-json`);
  assert.match(await page.$eval(`${row('glossary')} .ia-json`, (e) => e.textContent), /"id": "glossary"/);
  assert.ok((await page.$eval(row('glossary'), (r) => r.textContent)).includes(manifestHash(manifest('glossary'))), 'hash ditampilkan');
  await page.click(`${row('glossary')} [data-ia="review"]`);
  assert.equal(await page.$(`${row('glossary')} .ia-json`), null);
});

test('Trust and enable menyimpan hash manifes; baris jadi Enabled dengan Disable; sakelar tile ikut', async () => {
  await page.click(`${row('recap-email')} [data-ia="trust"]`);
  await page.waitForFunction(() => document.querySelector('.ia-row[data-id="recap-email"] .ia-pill')?.textContent.trim() === 'Enabled');
  assert.equal((await trust()).ysmAddinTrust['recap-email'], manifestHash(manifest('recap-email')));
  assert.deepEqual(await btns('recap-email'), ['Disable', 'Review manifest', 'Remove']);
  await page.waitForFunction(() => document.querySelector('[data-feat="recap-email"]')?.checked === true);
});

test('Disable mencabut kepercayaan; Undo memulihkannya', async () => {
  await page.click(`${row('recap-email')} [data-ia="disable"]`);
  await page.waitForFunction(() => document.querySelector('.ia-row[data-id="recap-email"] .ia-pill')?.textContent.trim() === 'Needs trust');
  assert.equal((await trust()).ysmAddinTrust['recap-email'], undefined);
  await page.click('.ia-toast [data-ia="undo"]');
  await page.waitForFunction(() => document.querySelector('.ia-row[data-id="recap-email"] .ia-pill')?.textContent.trim() === 'Enabled');
  assert.equal((await trust()).ysmAddinTrust['recap-email'], manifestHash(manifest('recap-email')));
});

test('Remove memindahkan ke Removed (bisa Restore); manifes yang berubah butuh persetujuan baru', async () => {
  await page.click(`${row('actions')} [data-ia="remove"]`);
  await page.waitForFunction(() => !document.querySelector('.ia-row[data-id="actions"] [data-ia="trust"]'));
  assert.ok((await trust()).ysmAddinRemoved.includes('actions'));
  await page.click('[data-ia="toggle-removed"]');
  await page.waitForSelector(`${row('actions')} [data-ia="restore"]`);
  await page.click(`${row('actions')} [data-ia="restore"]`);
  await page.waitForFunction(() => document.querySelector('.ia-row[data-id="actions"] .ia-pill')?.textContent.trim() === 'Needs trust');
  // hash lama (bukan hash manifes sekarang) = changed
  await page.evaluate(() => chrome.storage.local.set({ ysmAddinTrust: { 'due-to-calendar': 'deadbeefdeadbeef' } }));
  await page.waitForFunction(() => document.querySelector('.ia-row[data-id="due-to-calendar"] .ia-pill')?.textContent.trim() === 'Changed');
  assert.deepEqual(await btns('due-to-calendar'), ['Trust the change', 'Review manifest', 'Remove']);
  await page.evaluate(() => chrome.storage.local.set({ ysmAddinTrust: {}, ysmAddinRemoved: [] }));
});

test('rapat terbuka yang sudah terbit mengunci Trust (Disable dan Remove tetap bisa)', async () => {
  const x = new Date(); const day = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const env = wrapMeetingStore([{ ...createMeeting({ id: 'L1', seriesId: 'S', seq: 1, title: 'Issued', date: day, items: [] }), issuedAt: '2026-01-01T00:00:00Z' }]);
  await page.evaluate((e) => localStorage.setItem('minutesRegister', JSON.stringify(e)), env);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.ia-row');
  assert.match(await page.$eval('#addins-pane', (p) => p.textContent), /Locked: the open meeting is issued/);
  assert.equal(await page.$eval(`${row('glossary')} [data-ia="trust"]`, (b) => b.disabled), true);
  assert.equal(await page.$eval(`${row('glossary')} [data-ia="remove"]`, (b) => b.disabled), false);
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));
