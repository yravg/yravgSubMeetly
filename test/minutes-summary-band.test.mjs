/**
 * TIDE-024 (board A04d): ringkasan register di dist/minutes.html menjadi satu pita
 * ≤ 72 px. Hanya pita itu yang berubah; desain halaman lainnya tetap.
 *  - pita satu baris: total, batang tipe + legenda sebaris, angka-angka, Review, chevron
 *  - chevron membuka legenda penuh dengan jumlah dan persentase; klik lagi menutup
 *  - kosong: total 0, batang kosong, kalimat "No items yet"
 *  - ≤ 120 px pada lebar 1024
 *   node --test test/minutes-summary-band.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8902;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page;
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await wait(120);
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}

const bandHeight = () => page.$eval('#strip .sum', (e) => e.getBoundingClientRect().height);

before(async () => {
  assert.ok(existsSync('dist/minutes.js'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/minutes.html`);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1440,900'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${ORIGIN}/dist/minutes.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.removeItem('ysmMinutesLayout'); localStorage.removeItem('minutesRegister'); });
  await page.reload({ waitUntil: 'networkidle0' });
  await click('#btn-library'); await wait(300);
  await click('[data-domain="hse"]'); await wait(200);
  await click('[data-series="LIB-HSE2"]'); await wait(300);
  await click('#lib-import'); await wait(3500);
  await click('#lt-close'); await wait(300);
  await page.waitForSelector('#strip .sum-stack i');
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('pita satu baris ≤ 72 px pada 1440, dengan legenda sebaris', async () => {
  assert.ok(await bandHeight() <= 72, `tinggi pita ${await bandHeight()} px`);
  const r = await page.evaluate(() => ({
    stack: document.querySelectorAll('#strip .sum-stack i').length,
    legend: [...document.querySelectorAll('#strip .sum-legend li')].map((l) => l.textContent.trim()),
    stats: document.querySelector('#strip .sum-stats')?.textContent || '',
    review: !!document.querySelector('#strip #btn-sum-review'),
  }));
  assert.ok(r.stack >= 2, 'batang punya ruas');
  assert.equal(r.legend.length, r.stack, 'satu entri legenda per ruas');
  for (const l of r.legend) assert.match(l, /\d+$/, `legenda membawa jumlah: ${l}`);
  for (const k of [/Actions open/i, /Overdue/i, /Agenda covered/i, /Unreviewed/i]) assert.match(r.stats, k);
  assert.ok(r.review);
});

test('chevron membuka legenda penuh dengan persentase, lalu menutup', async () => {
  const state = () => page.evaluate(() => {
    const b = document.querySelector('#btn-sum-expand');
    const rank = document.querySelector('#strip .sum-rank');
    return { exp: b?.getAttribute('aria-expanded'), shown: !!rank && rank.offsetParent !== null, cells: [...(rank?.querySelectorAll('li') || [])].map((l) => l.querySelector('.sh')?.textContent || '') };
  });
  let s = await state();
  assert.equal(s.exp, 'false');
  assert.equal(s.shown, false, 'legenda penuh tertutup secara bawaan');
  await click('#btn-sum-expand'); await wait(250);
  s = await state();
  assert.equal(s.exp, 'true');
  assert.equal(s.shown, true);
  const pcts = s.cells.map((c) => Number((c.match(/^(\d+)%$/) || [])[1]));
  assert.ok(pcts.length >= 2 && pcts.every(Number.isFinite), `tiap sel punya persentase: ${s.cells.join(' | ')}`);
  const total = pcts.reduce((a, b) => a + b, 0);
  assert.ok(total >= 97 && total <= 103, `persentase menjumlah ~100 (${total})`);
  await click('#btn-sum-expand'); await wait(250);
  s = await state();
  assert.equal(s.exp, 'false');
  assert.equal(s.shown, false);
});

test('≤ 120 px pada lebar 1024', async () => {
  await page.setViewport({ width: 1024, height: 800 }); await wait(250);
  assert.ok(await bandHeight() <= 120, `tinggi pita ${await bandHeight()} px`);
  await page.setViewport({ width: 1440, height: 900 }); await wait(250);
});

test('kosong: total 0, batang kosong, "No items yet"', async () => {
  await page.evaluate(() => {
    const env = JSON.parse(localStorage.getItem('minutesRegister'));
    for (const m of env.meetings) m.items = [];
    localStorage.setItem('minutesRegister', JSON.stringify(env));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#strip .sum');
  await wait(400);
  const r = await page.evaluate(() => ({
    total: document.querySelector('#strip .sum-total .mo-num')?.getAttribute('aria-label'),
    seg: document.querySelectorAll('#strip .sum-stack i').length,
    legend: document.querySelector('#strip .sum-legend')?.textContent || '',
  }));
  assert.equal(r.total, '0');
  assert.equal(r.seg, 0);
  assert.match(r.legend, /No items yet/);
  assert.ok(await bandHeight() <= 72);
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));
