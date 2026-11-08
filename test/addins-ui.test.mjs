/**
 * Settings › Add-ins on app.html (board T05, PRD ADD-001): trust gate, enable, remove, undo,
 * and one bundled example action writing a real item.
 *   node --test test/addins-ui.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8885;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;
let browser;
let page;
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

const SEED = async () => {
  const { saveMeeting } = await import('/src/lib/notes-store.js');
  await saveMeeting({
    id: 'MOM-K3-W2', seriesId: 'komite-k3', seq: 2, title: 'Komite K3', date: '2026-09-02', locale: 'en',
    projectType: 'hse',
    items: [
      { ref: 'W2-001', type: 'decision', text: { en: 'Secure cranes' }, status: 'closed' },
      { ref: 'W2-002', type: 'action', text: { en: 'Issue checklist' }, status: 'open', owner: 'Lai' },
    ],
  });
};

async function boot(setup) {
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/app.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); });
  if (setup) await page.evaluate(setup);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#app-mount .bottom-nav-item');
  await page.waitForFunction(() => document.getElementById('addins-mount')?.children.length > 0, { timeout: 10_000 });
}

const openAddins = async () => {
  await page.evaluate(() => {
    document.getElementById('btn-settings').click();
    document.querySelector('#settings-tabs button[data-stab="addins"]').click();
  });
  await page.waitForSelector('.ai-wrap');
};
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const text = (sel) => page.$eval(sel, (e) => e.textContent);
const state = () => page.$eval('.ai-wrap', (e) => e.dataset.state);

before(async () => {
  assert.ok(existsSync('dist/sidepanel.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`${ORIGIN}/app.html`);
  browser = await puppeteer.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('Add-ins tab: both bundled add-ins wait for trust, nothing runs', async () => {
  await boot(`(${SEED})()`);
  await openAddins();
  assert.equal(await state(), 'needs');
  const rows = await page.$$eval('.ai-row', (r) => r.map((e) => e.textContent));
  assert.equal(rows.length, 2);
  await click('.ai-row');
  assert.ok((await text('.ai-gate')).length > 10);
  // untrusted: no chip in the notes strip
  assert.equal(await page.$$eval('.ai-chb:not(.ai-chb-demo)', (e) => e.length), 0);
  // the old tabs are all still there
  const tabs = await page.$$eval('#settings-tabs button', (b) => b.map((x) => x.dataset.stab));
  assert.deepEqual(tabs, ['general', 'engine', 'models', 'output', 'addins', 'about']);
});

test('trust, enable, remove, undo', async () => {
  await boot(`(${SEED})()`);
  await openAddins();
  await click('.ai-row');
  await click('[data-ai="trust"]');
  await page.waitForSelector('.ai-pill-enabled');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ysmAddinTrust') || 'null'));
  assert.ok(stored && Object.keys(stored).length === 1, 'trust hash stored');
  assert.match(Object.values(stored)[0], /^[0-9a-f]{16}$/);
  // remove -> section Removed + undo toast
  await click('[data-ai="remove"]');
  await page.waitForSelector('.ai-toast');
  assert.equal(await page.$$eval('.ai-pill-enabled', (e) => e.length), 0);
  await click('[data-ai="undo"]');
  await page.waitForSelector('.ai-pill-enabled');
  assert.equal(await page.$('.ai-toast'), null);
});

test('Flag decision chip writes a decision into the open meeting', async () => {
  await boot(`(${SEED})()`);
  await openAddins();
  // trust the flag-decision row
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ai-row')];
    rows.find((r) => /Flag decision/.test(r.textContent)).click();
  });
  await click('[data-ai="trust"]');
  await page.waitForSelector('.ai-pill-enabled');
  await click('#btn-close-settings');
  await page.waitForSelector('[data-addin="flag-decision:flag"]', { timeout: 8000 });
  const before = await page.evaluate(async () => (await (await import('/src/lib/notes-store.js')).listMeetings())[0].items.length);
  await click('[data-addin="flag-decision:flag"]');
  await page.waitForFunction(async (n) => {
    const { listMeetings } = await import('/src/lib/notes-store.js');
    return (await listMeetings())[0].items.length === n + 1;
  }, { timeout: 8000 }, before);
  const last = await page.evaluate(async () => (await (await import('/src/lib/notes-store.js')).listMeetings())[0].items.at(-1));
  assert.equal(last.type, 'decision');
});

test('390px: panes stack, no horizontal scroll', async () => {
  await boot(`(${SEED})()`);
  await page.setViewport({ width: 390, height: 844 });
  await openAddins();
  await click('.ai-row');
  const m = await page.evaluate(() => {
    const w = document.querySelector('.ai-wrap');
    const list = document.querySelector('.ai-list').getBoundingClientRect();
    const main = document.querySelector('.ai-main').getBoundingClientRect();
    return { over: document.documentElement.scrollWidth - innerWidth, wrapOver: w.scrollWidth - w.clientWidth, stacked: main.top >= list.bottom - 1 };
  });
  assert.ok(m.over <= 0, `page scrolls horizontally by ${m.over}`);
  assert.ok(m.wrapOver <= 0);
  assert.equal(m.stacked, true);
});

test('locked: an issued meeting blocks Trust and says why', async () => {
  await boot(`(${async () => {
    const { saveMeeting } = await import('/src/lib/notes-store.js');
    await saveMeeting({ id: 'MOM-X', seriesId: 'x', seq: 1, title: 'X', date: '2026-09-02', locale: 'en', issuedAt: '2026-09-03', projectType: 'hse' });
  }})()`);
  await openAddins();
  assert.equal(await state(), 'locked');
  await click('.ai-row');
  assert.equal(await page.$eval('[data-ai="trust"]', (b) => b.disabled), true);
});

test('empty and no page errors', async () => {
  await boot();
  await page.evaluateOnNewDocument(() => { window.__ysmAddinsBundled = []; });
  await page.reload({ waitUntil: 'networkidle0' });
  await openAddins();
  assert.equal(await state(), 'empty');
  assert.deepEqual(pageErrors, []);
});
