/**
 * Papan A04: halaman Minutes asli di kerangka (tanpa iframe register).
 *   node --test test/app-minutes-native.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { createMeeting, wrapMeetingStore } from '../src/lib/notes-schema.js';

const PORT = 8852;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page;
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if ((await fetch(url)).ok) return; } catch { /* retry */ } await wait(120); }
  throw new Error(`lab server tidak menyala di ${url}`);
}

function seed() {
  const it = (ref, type, o = {}) => ({ ref, type, owner: null, due: null, status: 'open', topic: 'hse', review: 'accepted', confidence: 0.95, text: { en: `${ref} text` }, src: { tc: '00:01:00' }, ...o });
  const m1 = createMeeting({ id: 'M1', seriesId: 'S', seq: 1, title: 'K3 Weekly', date: '2026-09-02', start: '07:00', end: '07:30', items: [
    it('ACT-01', 'action', { owner: 'Mei Lin' }), it('DEC-02', 'decision', { owner: 'James' }), it('ACT-03', 'action', { review: 'ai', confidence: 0.9 }),
    it('RSK-04', 'risk', { confidence: 0.5, topic: 'crane' }), it('QST-05', 'question'), it('MET-06', 'metric'),
  ] });
  const m0 = createMeeting({ id: 'M0', seriesId: 'S', seq: 0, title: 'K3 Weekly', date: '2026-08-26', start: '07:00', end: '07:30', items: [it('OLD-01', 'action')] });
  return wrapMeetingStore([m0, m1]);
}
const go = async (hash = '#minutes') => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForFunction((h) => document.querySelector('#page').dataset.route === h.slice(1).split('?')[0], {}, hash); await wait(500); };
const rows = () => page.$$eval('#page .mn-row', (r) => r.map((e) => e.dataset.ref));

before(async () => {
  assert.ok(existsSync('dist/app.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/app.html`);
  await wait(1200);
  browser = await puppeteer.launch({ headless: true });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/dist/app.html`, { waitUntil: 'networkidle0' });
  await page.evaluate((env) => { localStorage.clear(); localStorage.setItem('minutesRegister', JSON.stringify(env)); }, seed());
  await page.reload({ waitUntil: 'networkidle0' });
});
after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('no iframe: the page is drawn natively; crumb links home; title and tabs present', async () => {
  await go();
  assert.equal(await page.$('#page iframe'), null);
  assert.equal(await page.$eval('#page .mn-crumb a', (a) => [a.textContent.trim(), a.getAttribute('href')].join('|')), 'Back to the main page|#today');
  assert.deepEqual(await page.$$eval('#page .mn-tabs button', (b) => b.map((x) => x.textContent.trim())), ['Register', 'By topic', 'Minutes', 'Carry-forward', 'Series', 'Inbox', 'Projects', 'Highlights']);
});

test('lists the newest meeting of the series with the summary line and type chips', async () => {
  assert.deepEqual(await rows(), ['ACT-01', 'DEC-02', 'ACT-03', 'RSK-04', 'QST-05', 'MET-06']);
  assert.match(await page.$eval('#page .mn-sum', (e) => e.textContent.replace(/\s+/g, ' ')), /6 items · 1 decision · 2 actions · 1 question · 1 risk · 1 metric/);
  assert.deepEqual(await page.$$eval('#page .mn-chips [data-type]', (c) => c.map((x) => x.textContent.replace(/\s+/g, '').trim())), ['All6', 'Decision1', 'Action2', 'Openquestion1', 'Risk1', 'Metric1']);
});

test('a type chip filters rows and leaves the counts; Needs review only narrows further', async () => {
  await page.click('#page .mn-chips [data-type="action"]');
  assert.deepEqual(await rows(), ['ACT-01', 'ACT-03']);
  assert.match(await page.$eval('#page .mn-chips [data-type="risk"]', (e) => e.textContent), /1/);
  await page.click('#page [data-mn="review-only"]');
  assert.deepEqual(await rows(), ['ACT-03']);
  await page.click('#page [data-mn="review-only"]');
  await page.click('#page .mn-chips [data-type="all"]');
  assert.equal((await rows()).length, 6);
});

test('Group select groups rows; By topic tab lists by topic', async () => {
  await page.select('#page [data-mn="group"]', 'topic');
  assert.ok(await page.$('#page .mn-ghead'));
  await page.select('#page [data-mn="group"]', 'none');
  await page.click('#page .mn-tabs [data-tab="topic"]');
  assert.ok((await page.$$('#page .mn-topic h3')).length >= 2);
  await page.click('#page .mn-tabs [data-tab="register"]');
});

test('meeting select switches meeting', async () => {
  await page.select('#page [data-mn="meeting"]', 'M0');
  assert.deepEqual(await rows(), ['OLD-01']);
  await page.select('#page [data-mn="meeting"]', 'M1');
});

// The More menu holds the secondary actions (Draft options, Library, Training, Apply correction, the other register, header, layout).
const inMore = async (sel) => { await page.click('#page [data-mn="more"]'); await page.waitForSelector('#page .mn-menu'); await page.click(sel); };

test('Open full register: the current kind is the main link, the other one lives in More; last choice remembered', async () => {
  const top = () => page.$eval('#page .mn-full', (a) => a.dataset.register);
  const first = await top();
  const other = first === 'modern' ? 'classic' : 'modern';
  await inMore(`#page .mn-menu a[data-register="${other}"]`).catch(() => {});
  await wait(300);
  await go();
  assert.equal(await top(), other);
});

test('Collapse header hides the summary and chips, and comes back', async () => {
  await inMore('#page .mn-menu [data-mn="collapse"]');
  assert.equal(await page.$('#page .mn-sum'), null);
  assert.equal(await page.$('#page .mn-chips'), null);
  assert.ok(await page.$('#page .mn-tabs'), 'tabs stay');
  await inMore('#page .mn-menu [data-mn="collapse"]');
  assert.ok(await page.$('#page .mn-sum'));
});

test('Layout & appearance: density changes row height; Collapse to rail and Reset layout write the register layout', async () => {
  await inMore('#page .mn-menu [data-mn="layout"]');
  const labels = await page.$$eval('#page .mn-pop [data-density]', (b) => b.map((x) => x.textContent.trim()));
  assert.deepEqual(labels, ['Review', 'Reading', 'Compact']);
  const h0 = await page.$eval('#page .mn-row', (r) => r.getBoundingClientRect().height);
  await page.click('#page .mn-pop [data-density="compact"]');
  await wait(300);
  assert.ok(await page.$eval('#page .mn-row', (r) => r.getBoundingClientRect().height) < h0);
  assert.equal(await page.evaluate(() => localStorage.getItem('ysmRowDensity')), 'compact');
  await page.click('#page .mn-pop [data-layout="rail"]');
  const L = await page.evaluate(() => JSON.parse(localStorage.getItem('ysmMinutesLayout')));
  assert.deepEqual([L.left.mode, L.right.mode, L.bottom.mode], ['rail', 'rail', 'rail']);
  await page.click('#page .mn-pop [data-layout="reset"]');
  assert.equal(await page.evaluate(() => localStorage.getItem('ysmMinutesLayout')), null);
});

test('register-only actions open the register with ?do=…; Issue MoM is the one black button', async () => {
  if (await page.$('#page .mn-pop')) await page.click('#page .mn-sum'); // a click elsewhere closes the layout popover
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  // The bar: Add item, Export, Issue MoM (the only primary) and More; the rest is in the More menu.
  const bar = await page.$$eval('#page .mn-bar > button, #page .mn-bar > .mn-more > button', (b) => b.map((x) => x.textContent.trim()));
  for (const l of ['Add item', 'Export', 'Issue MoM']) assert.ok(bar.some((x) => x.startsWith(l)), `${l} in ${bar}`);
  await page.click('#page [data-mn="more"]');
  await page.waitForSelector('#page .mn-menu');
  const menu = await page.$$eval('#page .mn-menu [role="menuitem"]', (b) => b.map((x) => x.textContent.trim()));
  for (const l of ['Draft options', 'Library', 'Training', 'Apply correction', 'Collapse header', 'Layout & appearance']) assert.ok(menu.includes(l), `${l} in ${menu}`);
  await page.click('#page .mn-menu [data-do="draft"]');
  await wait(400);
  await page.click('#page .mn-bar [data-do="add"]');
  await wait(400);
  const opened = await page.evaluate(() => window.__opened);
  assert.ok(opened.some((u) => /minutes\.html/.test(u) && /do=draft/.test(u)), JSON.stringify(opened));
  assert.ok(opened.some((u) => /minutes\.html/.test(u) && /do=add/.test(u) && /meeting=M1/.test(u)), JSON.stringify(opened));
  assert.equal(await page.$$eval('#page .mn-bar .pill-b', (b) => b.length), 1);
});

test('empty register: Tide asleep card with Load demo meetings, which fills the list', async () => {
  await page.evaluate(() => localStorage.removeItem('minutesRegister'));
  await page.reload({ waitUntil: 'networkidle0' });
  await go();
  assert.ok(await page.$('#page .mn-empty'));
  await page.evaluate(() => [...document.querySelectorAll('#page button')].find((b) => /Load demo meetings/.test(b.textContent)).click());
  await page.waitForSelector('#page .mn-row', { timeout: 8000 });
});

test('no page errors', () => { assert.deepEqual(pageErrors, []); });
