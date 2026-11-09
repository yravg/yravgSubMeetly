/**
 * Register search reaches every meeting; the owner filter narrows the open one.
 *   node --test test/register-search.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8921;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page;
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
  assert.ok(existsSync('dist/minutes.js'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/src/minutes.html`);
  await wait(1500);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1280,900'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${ORIGIN}/dist/minutes.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.removeItem('minutesRegister'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#btn-load-sample');
  await page.click('#btn-load-sample');
  await page.waitForSelector('#pane table tbody tr[data-ref]');
});
after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

const rows = () => page.$$eval('#pane tbody tr[data-ref]', (r) => r.map((x) => ({ ref: x.dataset.ref, text: x.querySelector('.c-item')?.textContent.trim() || '' })));
const pick = async (id) => { await page.select('#m-switch', id); await wait(300); };

test('search finds items in other meetings and jumps to them', async () => {
  await pick('MOM-CPOC7-W35');
  const w35 = await rows();
  await pick('MOM-CPOC7-W36');
  const w36 = await rows();
  const only = w35.find((r) => !w36.some((o) => o.ref === r.ref));
  assert.ok(only, 'demo meetings share not every item');
  await page.evaluate(() => { document.getElementById('btn-search-open')?.click(); });
  await page.$eval('#q', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, only.ref);
  await wait(300);
  const xs = await page.$$eval('.xs-row', (r) => r.map((x) => x.dataset.xsMeeting));
  assert.ok(xs.includes('MOM-CPOC7-W35'), 'match in W35 listed while W36 is open');
  await page.click('.xs-row[data-xs-meeting="MOM-CPOC7-W35"]');
  await wait(300);
  assert.equal(await page.$eval('#m-switch', (s) => s.value), 'MOM-CPOC7-W35', 'jump opens the meeting');
});

test('owner filter narrows the table and stays on the owner', async () => {
  await page.$eval('#q', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(200);
  const before = (await rows()).length;
  const owners = await page.$$eval('#owner-filter option', (o) => o.map((x) => x.value).filter(Boolean));
  assert.ok(owners.length > 1, 'demo has several owners');
  await page.select('#owner-filter', owners[0]);
  await wait(300);
  const after = await page.$$eval('#pane tbody tr[data-ref] .c-owner', (c) => c.map((x) => x.textContent));
  assert.ok(after.length > 0 && after.length < before, `filtered ${before} -> ${after.length}`);
  assert.ok(after.every((t) => t.includes(owners[0])), 'every row has the owner');
  await page.select('#owner-filter', '');
});
