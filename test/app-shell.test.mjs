/**
 * App shell Tide (TIDE-002..005, 008, 014; papan A01, A04, A09) pada dist/app.html.
 *   node --test test/app-shell.test.mjs
 *
 * Register diisi rapat bertanggal relatif terhadap hari ini, jadi angkanya
 * bisa dihitung tangan: hari ini 2 rapat (30 + 62 menit), minggu ini 4 butir
 * (bila hari ini Senin, kemarin masuk minggu lalu — dihitung di dalam tes).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { createMeeting, wrapMeetingStore } from '../src/lib/notes-schema.js';

const PORT = 8907;
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

/** Register uji: dua seri, tanggal relatif hari ini. */
function seed() {
  const d = (o) => { const x = new Date(); x.setDate(x.getDate() + o); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const it = (ref, type, owner = null, due = null) => ({ ref, type, owner, due, status: 'open', text: { en: `${ref} text` } });
  const m = (id, seriesId, date, start, end, issuedAt, items) => ({ ...createMeeting({ id, seriesId, seq: 1, title: `Meeting ${id}`, date, start, end, items }), issuedAt });
  const meetings = [
    m('T1', 'SA', d(0), '07:00', '07:30', '2026-01-01T00:00:00Z', [it('D1', 'decision', 'Mei'), it('A1', 'action', 'Mei', d(-3))]),
    m('T2', 'SB', d(0), '09:00', '10:02', null, [it('R1', 'risk', 'Lars'), it('Q1', 'question')]),
    m('Y1', 'SA', d(-1), '15:00', '15:45', null, [it('A2', 'action', 'Lars', d(5))]),
  ];
  return { env: wrapMeetingStore(meetings), mondayToday: new Date().getDay() === 1 };
}

before(async () => {
  assert.ok(existsSync('dist/app.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/app.html`);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1440,1000'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/dist/app.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.hero');
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

const mascots = () => page.$$eval('img.tide-art', (l) => l.map((i) => i.src.split('/').pop()));

test('A09: sambutan pertama (wave) lalu kosong (sleep), satu maskot per layar', async () => {
  assert.deepEqual(await mascots(), ['tide-wave.webp']);
  await page.click('[data-act="welcomed"]');
  await page.waitForSelector('.st.in-hero');
  assert.deepEqual(await mascots(), ['tide-sleep.webp']);
  const txt = await page.$eval('.hero', (h) => h.textContent);
  assert.match(txt, /No meetings yet/);
  assert.ok(await page.$('.hero a.pill-b[href="#live"]'), 'kosong menawarkan Start captions');
});

test('A01: angka dari register, satu maskot, kartu kemarin dan rapat hari ini', async () => {
  const { env, mondayToday } = seed();
  await page.evaluate((e) => localStorage.setItem('minutesRegister', JSON.stringify(e)), env);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.kpi');
  const r = await page.evaluate(() => ({
    big: document.querySelector('.bignum b').textContent.trim(),
    kpi: document.querySelector('.kpi').textContent.trim(),
    rows: [...document.querySelectorAll('.mrow b')].map((b) => b.textContent),
    yday: !!document.querySelector('.rail1 a.pill-b'),
    over: document.querySelector('.over')?.textContent || '',
    helper: document.querySelector('#helper-pill-text').textContent,
  }));
  assert.equal(r.big, '1h 32m', '30 + 62 menit');
  assert.equal(r.kpi, mondayToday ? '4' : '5', 'butir minggu ini (kemarin ikut bila hari ini bukan Senin)');
  assert.deepEqual(r.rows, ['Meeting T1', 'Meeting T2']);
  assert.ok(r.yday, 'Y1 kemarin belum terbit → Issue minutes');
  assert.match(r.over, /1 overdue/);
  assert.match(r.helper, /Helper/);
  assert.deepEqual(await mascots(), ['tide-shell.webp']);
  assert.equal(await page.$eval('.rail1 a.pill-b', (a) => a.getAttribute('href')), '#minutes?meeting=Y1');
});

test('A01: filter seri dan pemilik mengubah angka; mata menyembunyikan angka', async () => {
  await page.select('#series-select', 'SB');
  await page.waitForFunction(() => document.querySelector('.bignum b')?.textContent.trim() === '1h 02m');
  assert.equal(await page.$eval('.kpi', (k) => k.textContent.trim()), '2');
  await page.select('#series-select', '');
  await page.waitForFunction(() => document.querySelector('.bignum b')?.textContent.trim() === '1h 32m');
  await page.select('[data-act="owner"]', 'Mei');
  await page.waitForFunction(() => [...document.querySelectorAll('.brow .v')].map((v) => v.textContent).join(',') === '1,1,0,0');
  await page.click('[data-act="eye"]');
  assert.match(await page.$eval('.bignum b [data-num]', (n) => getComputedStyle(n).filter), /blur/);
  await page.click('[data-act="eye"]');
});

test('lonceng: jumlah pemberitahuan nyata, Escape menutup', async () => {
  assert.equal(await page.$eval('#btn-bell .badge', (b) => b.textContent), '2', 'kemarin belum terbit + lewat tenggat');
  await page.click('#btn-bell');
  assert.equal(await page.$eval('#bell-pop', (p) => getComputedStyle(p).display !== 'none'), true);
  assert.equal(await page.$$eval('#bell-pop .nt', (l) => l.length), 2);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#bell-pop', (p) => getComputedStyle(p).display), 'none');
});

test('⇧S membuka Live captions; setiap rute nav memasang halamannya', async () => {
  await page.evaluate(() => { location.hash = '#today'; document.body.focus(); });
  await page.keyboard.down('Shift'); await page.keyboard.press('S'); await page.keyboard.up('Shift');
  await page.waitForFunction(() => location.hash === '#live');
  const routes = await page.$$eval('#nav-meetings a, #nav-features a', (l) => l.map((a) => a.dataset.route));
  assert.deepEqual(routes, ['today', 'live', 'minutes', 'history', 'files', 'addins', 'glossary', 'island', 'perf', 'all', 'settings', 'dev'], 'lab: Developer tampil');
  const expect = { live: 'view=captions', history: 'view=history', files: 'view=files', addins: 'stab=addins', glossary: 'view=notes', island: 'stab=output', perf: 'view=perf', settings: 'view=settings' };
  for (const [route, frag] of Object.entries(expect)) {
    await page.evaluate((r) => { location.hash = `#${r}`; }, route);
    await page.waitForFunction((r) => document.querySelector('#page').dataset.route === r, {}, route);
    const src = await page.$eval('#page iframe.panel', (f) => f.getAttribute('src'));
    assert.ok(src.includes(frag), `${route} → ${src}`);
  }
  // Lab: Live menyebut keadaan terkunci "Needs the extension".
  await page.evaluate(() => { location.hash = '#live'; });
  await page.waitForFunction(() => document.querySelector('#page').dataset.route === 'live');
  assert.match(await page.$eval('#page', (p) => p.textContent), /Needs the extension/);
});

test('A04: Minutes memasang register, tautan Klasik dan jendela Minutes', async () => {
  await page.evaluate(() => { location.hash = '#minutes?meeting=Y1'; });
  await page.waitForSelector('#page iframe.reg');
  const r = await page.evaluate(() => ({ frame: document.querySelector('#page iframe.reg').getAttribute('src'), classic: document.querySelector('.seg-o a').getAttribute('href') }));
  assert.match(r.frame, /^minutes\.html\?lang=en&meeting=Y1$/);
  assert.equal(r.classic, r.frame);
  const n = (await browser.pages()).length;
  await page.click('[data-act="win"]');
  await page.waitForFunction((k) => true, {}, n);
  await wait(800);
  assert.equal((await browser.pages()).length, n + 1, 'jendela Minutes terbuka (lab: window.open bernama)');
  await page.click('[data-act="win"]'); await wait(800);
  assert.equal((await browser.pages()).length, n + 1, 'klik kedua tidak membuka jendela lain');
});

test('A04: Modern = minutes.html?skin=tide; pilihan terakhir diingat dan tampil lebih dulu', async () => {
  await page.evaluate(() => { location.hash = '#minutes'; });
  await page.waitForSelector('#page iframe.reg');
  assert.deepEqual(await page.$$eval('.seg-o a', (l) => l.map((a) => a.dataset.register)), ['classic', 'modern']);
  const n = (await browser.pages()).length;
  await page.click('.seg-o a[data-register="modern"]');
  await page.waitForFunction(() => document.querySelector('#page iframe.reg')?.getAttribute('src').includes('skin=tide'));
  await wait(1500);
  const tab = (await browser.pages()).slice(n)[0];
  assert.ok(tab, 'Modern membuka tab sendiri');
  assert.match(tab.url(), /minutes\.html\?lang=en&skin=tide/);
  await tab.close();
  assert.deepEqual(await page.$$eval('.seg-o a', (l) => l.map((a) => a.dataset.register)), ['modern', 'classic']);
  const frame = await (await page.$('#page iframe.reg')).contentFrame();
  await frame.waitForFunction(() => document.documentElement.dataset.reskin === 'tide' && getComputedStyle(document.body).fontFamily.includes('Plus Jakarta Sans'));
  // Classic tanpa lapisan Tide (TIDE-024).
  await page.click('.seg-o a[data-register="classic"]'); await wait(1200);
  for (const p of (await browser.pages()).slice(n)) await p.close();
  const cf = await (await page.$('#page iframe.reg')).contentFrame();
  await cf.waitForFunction(() => document.readyState === 'complete');
  assert.equal(await cf.evaluate(() => document.documentElement.dataset.reskin || null), null);
});

test('A06: delapan fitur, Island dengan sakelar nyata, add-in terpasang di halaman yang sama', async () => {
  await page.evaluate(() => { location.hash = '#all'; });
  await page.waitForSelector('.tiles');
  assert.equal(await page.$$eval('.tiles .tile2', (l) => l.length), 8);
  const sw = await page.$('.tiles [data-act="island"]');
  const before = await page.evaluate(() => chrome.storage.local.get('captionSurface'));
  await sw.click(); await wait(300);
  const afterOn = await page.evaluate(() => chrome.storage.local.get('captionSurface'));
  assert.notEqual(afterOn.captionSurface, before.captionSurface || 'overlay');
  assert.equal(await page.$eval('#island-switch', (i) => i.checked), afterOn.captionSurface === 'both');
  await sw.click(); await wait(300);
  assert.ok((await page.$eval('#addins-pane iframe', (f) => f.getAttribute('src'))).includes('stab=addins'));
});

test('A08: area Developer (lab) memasang lab yang ada', async () => {
  await page.evaluate(() => { location.hash = '#dev'; });
  const f = await (await page.waitForSelector('#page iframe.dev')).contentFrame();
  await f.waitForSelector('#ltabs', { timeout: 20000 });
  assert.equal(await page.$eval('#page iframe.dev', (x) => x.getAttribute('src')), '/app.html');
});

test('390 px: sidebar jadi lembar lewat tombol menu; tanpa gulir mendatar', async () => {
  await page.evaluate(() => { location.hash = '#today'; });
  await page.setViewport({ width: 390, height: 844 }); await wait(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  const off = await page.$eval('#sb', (s) => s.getBoundingClientRect().right);
  assert.ok(off <= 0, 'sidebar di luar layar');
  await page.click('#btn-menu'); await wait(350);
  assert.equal(await page.$eval('#sb', (s) => Math.round(s.getBoundingClientRect().left)), 0);
  await page.keyboard.press('Escape'); await wait(350);
  await page.setViewport({ width: 1440, height: 1000 });
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));
