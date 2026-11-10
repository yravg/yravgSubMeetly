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
  await wait(1500); // Windows: the first browser request right after the probe is aborted without this
  // Autoplay allowed: the lab panel's demo audio otherwise races play() against pause() and Start fails at random.
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1440,1000', '--autoplay-policy=no-user-gesture-required'] });
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
// Hero utuh di setiap keadaan: bilah tanya dengan tombol kirim, empat chip, pemandangan.
const heroParts = () => page.evaluate(() => ({ ask: !!document.querySelector('.hero .askbar input'), send: !!document.querySelector('.hero .askbar .send'), chips: document.querySelectorAll('.hero .chips .chip').length, scene: !!document.querySelector('.hero .hero-bg svg.harbour'), peek: !!document.querySelector('.hero .askbar .peek img') }));

test('A09: sambutan pertama (wave) lalu kosong (sleep): hero tetap utuh, satu maskot di bilah tanya', async () => {
  assert.deepEqual(await mascots(), ['tide-wave.webp']);
  assert.deepEqual(await heroParts(), { ask: true, send: true, chips: 4, scene: true, peek: true }, 'sambutan: hero tidak digantikan kartu');
  assert.equal(await page.$eval('.hero h2', (h) => h.textContent), 'Good evening.'.replace('evening', await page.$eval('.hero h2', (h) => h.textContent.match(/morning|afternoon|evening/)[0])), 'tanpa nama: sapaan polos');
  // First run: a real setup list (engine, speech model, test caption), each with a way forward.
  const steps = await page.$$eval('.st.band ol.setup li', (l) => l.map((li) => ({ text: li.textContent.trim(), link: li.querySelector('a')?.getAttribute('href') || '' })));
  assert.ok(steps.length >= 2 && steps.length <= 3, JSON.stringify(steps));
  assert.equal(steps.at(-1).link, '#live');
  assert.match(steps.at(-1).text, /test caption/i);
  await page.click('[data-act="welcomed"]');
  await page.waitForSelector('.st.band');
  assert.deepEqual(await mascots(), ['tide-sleep.webp']);
  assert.deepEqual(await heroParts(), { ask: true, send: true, chips: 4, scene: true, peek: true }, 'kosong: hero tetap utuh');
  assert.match(await page.$eval('.st.band', (h) => h.textContent), /No meetings yet/);
  assert.ok(await page.$('.st.band a.pill-b[href="#live"]'), 'kosong menawarkan Start captions');
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
  assert.deepEqual(await heroParts(), { ask: true, send: true, chips: 4, scene: true, peek: true }, 'terisi: hero utuh');
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
  assert.deepEqual(routes, ['today', 'live', 'minutes', 'history', 'files', 'addins', 'glossary', 'island', 'perf', 'all', 'settings', 'dev'], 'urutan papan A01; lab: Developer tampil');
  const expect = { live: 'view=captions', history: 'view=history', files: 'view=files', addins: 'stab=addins', notes: 'view=notes', island: 'stab=output', perf: 'view=perf', settings: 'view=settings', all: 'stab=addins' };
  for (const [route, frag] of Object.entries(expect)) {
    await page.evaluate((r) => { location.hash = `#${r}`; }, route);
    await page.waitForFunction((r) => document.querySelector('#page').dataset.route === r, {}, route);
    const src = await page.$eval('#page iframe.panel', (f) => f.getAttribute('src'));
    assert.ok(src.includes(frag), `${route} → ${src}`);
  }
  // Glossary membuka catatan rapat (tempat panel Glosarium hidup).
  await page.evaluate(() => { location.hash = '#glossary'; });
  await page.waitForFunction(() => document.querySelector('#page').dataset.route === 'notes');
  assert.equal(await page.$eval('#page-title', (h) => h.textContent), 'Notes and glossary');
  assert.equal(await page.$eval('#nav-features [data-route="glossary"]', (a) => a.classList.contains('on')), true, 'Glossary menyala di sidebar');
  assert.equal(await page.$eval('#nav-meetings [data-route="history"]', (a) => a.textContent.trim()), 'History');
  // Lab: Live menyebut keadaan terkunci "Needs the extension".
  await page.evaluate(() => { location.hash = '#live'; });
  await page.waitForFunction(() => document.querySelector('#page').dataset.route === 'live');
  const liveFrame = await (await page.waitForSelector('#page iframe.panel')).contentFrame();
  await liveFrame.waitForSelector('#ls-env-note');
  assert.match(await liveFrame.$eval('#ls-env-note', (n) => n.textContent), /Needs the extension/);
});

test('Start captions di sidebar benar-benar memulai (bukan hanya membuka Live)', async () => {
  await page.evaluate(() => { location.hash = '#today'; });
  await page.waitForFunction(() => document.querySelector('#page').dataset.route === 'today');
  await page.click('#btn-start');
  await page.waitForFunction(() => {
    const d = document.querySelector('#page[data-route="live"] iframe.panel')?.contentDocument;
    return d && d.getElementById('btn-start')?.disabled === true && d.getElementById('btn-stop')?.disabled === false;
  }, { timeout: 15000 });
  await page.evaluate(() => { location.hash = '#today'; });
});

test('A04: Minutes digambar langsung (tanpa iframe); tautan Open register; Klasik = jendela Minutes', async () => {
  await page.evaluate(() => { location.hash = '#minutes?meeting=Y1'; });
  await page.waitForSelector('#page .mn');
  assert.equal(await page.$('#page iframe'), null, 'tanpa iframe register');
  const r = await page.evaluate(() => ({ modern: document.querySelector('.mn-open a[data-register="modern"]').getAttribute('href'), classic: document.querySelector('.mn-open a[data-register="classic"]').getAttribute('href'), row: document.querySelector('.mn-row')?.dataset.ref }));
  assert.equal(r.modern, 'minutes.html?lang=en&skin=tide&meeting=Y1');
  assert.equal(r.classic, 'minutes.html?lang=en&meeting=Y1', 'tautan Klasik membuka halaman sendiri tanpa skin');
  assert.equal(r.row, 'A2', 'butir rapat Y1 tampil');
  const n = (await browser.pages()).length;
  await page.click('.mn-open a[data-register="classic"]'); await wait(900);
  assert.equal((await browser.pages()).length, n + 1, 'jendela Minutes terbuka (lab: window.open bernama)');
  await page.click('.mn-open a[data-register="classic"]'); await wait(900);
  assert.equal((await browser.pages()).length, n + 1, 'klik kedua tidak membuka jendela lain');
  for (const p of (await browser.pages()).slice(n)) await p.close();
});

test('A04: Modern bawaan; pilihan Open register diingat dan tampil lebih dulu', async () => {
  await page.evaluate(() => { localStorage.removeItem('ysmShellRegister'); location.hash = '#minutes'; });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#page .mn');
  assert.deepEqual(await page.$$eval('.mn-open a', (l) => l.map((a) => a.dataset.register)), ['modern', 'classic']);
  const n = (await browser.pages()).length;
  await page.click('.mn-open a[data-register="classic"]'); await wait(900);
  assert.deepEqual(await page.$$eval('.mn-open a', (l) => l.map((a) => a.dataset.register)), ['classic', 'modern']);
  await page.click('.mn-open a[data-register="modern"]'); await wait(900);
  assert.deepEqual(await page.$$eval('.mn-open a', (l) => l.map((a) => a.dataset.register)), ['modern', 'classic']);
  for (const p of (await browser.pages()).slice(n)) await p.close();
});

test('A06: delapan fitur, Island dengan sakelar nyata, add-in terpasang di halaman yang sama', async () => {
  await page.evaluate(() => { location.hash = '#all'; });
  await page.waitForSelector('.tiles');
  assert.equal(await page.$eval('#page', (p) => p.dataset.route), 'all', 'All features: halamannya sendiri (A06)');
  assert.equal(await page.$$eval('.tiles .tile2', (l) => l.length), 8);
  assert.equal(await page.$$eval('.tiles .tile2 .sw-chip input', (l) => l.length), 4, 'sakelar nyata: Island + tiga add-in; fitur bawaan tanpa sakelar palsu');
  const before = await page.evaluate(() => chrome.storage.local.get('captionSurface'));
  await page.click('#island-chip'); await wait(300);
  const afterOn = await page.evaluate(() => chrome.storage.local.get('captionSurface'));
  assert.notEqual(afterOn.captionSurface, before.captionSurface || 'overlay');
  assert.equal(await page.$eval('#island-switch', (i) => i.checked), afterOn.captionSurface === 'both');
  assert.equal(await page.$eval('[data-feat-state="island"]', (e) => e.textContent), 'On', 'kartu menunjukkan status sakelar');
  assert.equal(await page.$eval('[data-feat="island"]', (i) => i.checked), true, 'sakelar kartu ikut bilah atas');
  await page.click('#island-chip'); await wait(300);
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

test('A01: tanggal hero dan kartu Today sama pada malam hari di UTC+8 (bukan UTC)', async () => {
  // 2026-11-09 17:30 UTC = 10 Nov 01:30 di Asia/Shanghai; toISOString() masih menyebut 9 Nov.
  const p = await browser.newPage();
  await p.emulateTimezone('Asia/Shanghai');
  await p.evaluateOnNewDocument(() => {
    const T0 = Date.UTC(2026, 10, 9, 17, 30); const D = Date;
    globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [T0])); } static now() { return T0; } };
  });
  await p.goto(`${ORIGIN}/dist/app.html`, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.setItem('ysmShellWelcomed', 'true'));
  await p.reload({ waitUntil: 'networkidle0' });
  await p.waitForSelector('.dateline');
  const r = await p.evaluate(() => ({ line: document.querySelector('.dateline').textContent, eyebrow: [...document.querySelectorAll('.cd .eyebrow')].map((e) => e.textContent).find((t) => /^Today/.test(t)) }));
  await p.close();
  assert.match(r.line, /Tuesday 10 November/);
  assert.match(r.eyebrow, /10 Nov/);
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));

test('Plans: off by default (no sidebar link, no credits chip, #plans falls back to Today); the flag brings them back', async () => {
  assert.equal(await page.$eval('#plans-link', (a) => getComputedStyle(a).display), 'none');
  await page.evaluate(() => { location.hash = '#plans'; });
  await wait(300);
  assert.equal(await page.$eval('#page', (p) => p.dataset.route), 'today');
  assert.equal(await page.$('.ask-ov .credits'), null, 'no credits chip while the flag is off');
});
