/**
 * T03 + D01 pada halaman sungguhan (dist/minutes.html, Puppeteer):
 *  - tiga draf di Compare; pilih lalu pakai menulis lewat addItem
 *  - pakai draf yang sama lagi: duplikat dilewati, tidak ada butir baru
 *  - Diff terima/tolak per perubahan
 *  - rapat terbit: tombol pakai dan aksi Diff nonaktif
 *  - D01: ringkasan menggantikan tujuh kartu, satu penanda keyakinan di kolom Sumber,
 *    topik "general" polos, tepi amber pada butir perlu-tinjau, dok mulai mini
 *   node --test test/draft-ui.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8897;
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

async function importSeries(domain, series) {
  await click('#btn-library'); await wait(300);
  await click(`[data-domain="${domain}"]`); await wait(200);
  await click(`[data-series="${series}"]`); await wait(300);
  await click('#lib-import'); await wait(3500);
  await click('#lt-close'); await wait(300);
}
const openDraft = async () => { await click('#btn-draft'); await page.waitForSelector('.do-ov:not([hidden]) .do-panel'); };
const closeDraft = async () => { await click('.do-panel [data-act="close"]'); await wait(100); };
const rowRefs = () => page.$$eval('#pane tbody tr[data-ref]', (r) => r.map((x) => x.dataset.ref));
/** Register nyata sudah memuat butir yang dihasilkan dari transkripnya; sisakan sedikit supaya draf punya sesuatu untuk ditambahkan. */
async function trimRegister(keep = 2) {
  await page.evaluate((n) => {
    const env = JSON.parse(localStorage.getItem('minutesRegister'));
    for (const m of env.meetings) m.items = m.items.slice(0, n);
    localStorage.setItem('minutesRegister', JSON.stringify(env));
  }, keep);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#pane tbody tr[data-ref]');
}
const overlayHidden = () => page.$eval('.do-ov', (e) => e.hidden);

before(async () => {
  assert.ok(existsSync('dist/minutes.js'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/minutes.html`);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1400,900'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${ORIGIN}/dist/minutes.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.removeItem('ysmMinutesLayout'); localStorage.removeItem('minutesRegister'); localStorage.removeItem('learningProgress'); });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#btn-library');
  await importSeries('hse', 'LIB-HSE2');
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('D01: ringkasan menggantikan tujuh kartu; angka-angkanya tetap terlihat', async () => {
  const r = await page.evaluate(() => {
    const t = (s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim();
    return {
      cards: document.querySelectorAll('#strip .stat').length,
      stack: document.querySelectorAll('#strip .sum-stack i').length,
      rank: document.querySelectorAll('#strip .sum-rank li').length,
      stats: t('#strip .sum-stats'),
    };
  });
  assert.equal(r.cards, 0);
  assert.ok(r.stack >= 2 && r.rank === r.stack, 'batang bertumpuk sejajar dengan daftar peringkat');
  for (const k of [/Actions open/i, /Overdue/i, /Agenda covered/i, /Unreviewed/i]) assert.match(r.stats, k);
});

test('D01: satu penanda keyakinan per baris, hanya di kolom Sumber', async () => {
  const r = await page.evaluate(() => {
    const low = [...document.querySelectorAll('#pane tbody tr[data-ref]')].filter((tr) => tr.querySelector('.pill-warn'));
    return {
      n: low.length,
      inItem: low.filter((tr) => tr.querySelector('.c-item .pill-warn')).length,
      inSrc: low.filter((tr) => tr.querySelector('.c-src .pill-warn')).length,
      barToo: low.filter((tr) => tr.querySelector('.c-src .conf')).length,
      most: Math.max(0, ...low.map((tr) => tr.querySelectorAll('.pill-warn').length)),
    };
  });
  assert.ok(r.n > 0, 'data contoh memuat baris berkeyakinan rendah');
  assert.equal(r.inItem, 0); assert.equal(r.inSrc, r.n); assert.equal(r.barToo, 0); assert.equal(r.most, 1);
});

test('D01: topik general polos; butir perlu-tinjau punya tepi amber 2px', async () => {
  const r = await page.evaluate(() => {
    const pillGeneral = [...document.querySelectorAll('.c-topic .topic:not(.plain)')].filter((e) => /^general$/i.test(e.textContent.trim())).length;
    const nr = document.querySelector('tbody tr.needs-review:not([aria-selected="true"]) td:first-child');
    return { pillGeneral, edge: nr ? getComputedStyle(nr).boxShadow : '' };
  });
  assert.equal(r.pillGeneral, 0);
  assert.match(r.edge, /2px/);
});

test('D01: dok mulai mini bila navigator terbuka', async () => {
  assert.equal(await page.$eval('#viewdock', (el) => el.classList.contains('mini')), true);
});

test('T03: tiga draf; pilih lalu pakai menulis lewat addItem', async () => {
  await trimRegister(2);
  const before = await rowRefs();
  await openDraft();
  const names = (await page.$$eval('.do-lane header b', (l) => l.map((x) => x.textContent))).join('|');
  assert.equal((await page.$$('.do-lane')).length, 3);
  for (const n of ['Short', 'Full', 'Bilingual']) assert.match(names, new RegExp(n));
  assert.ok(await page.$('.do-sug'), 'ada tanda Suggested');
  assert.equal(await page.$eval('.do-head [data-act="use"]', (b) => b.disabled), true, 'belum memilih → tombol pakai mati');
  await click('.do-lane[data-key="b"] [data-act="pick"]');
  assert.equal(await page.$eval('.do-head [data-act="use"]', (b) => b.disabled), false);
  await click('.do-head [data-act="use"]');
  await wait(500);
  assert.equal(await overlayHidden(), true, 'panel tertutup setelah dipakai');
  const after = await rowRefs();
  assert.ok(after.length > before.length, `butir bertambah (${before.length} → ${after.length})`);
  assert.equal(new Set(after).size, after.length, 'ref unik, dialokasikan addItem');
});

test('T03: memakai draf yang sama lagi menambah nol (duplikat dilewati)', async () => {
  const before = (await rowRefs()).length;
  await openDraft();
  await click('.do-lane[data-key="b"] [data-act="pick"]');
  await click('.do-tabs [data-tab="diff"]');
  const chips = (await page.$$eval('.do-dtools .do-chip', (c) => c.map((x) => x.textContent))).join(' ');
  assert.match(chips, /0 New/);
  assert.match(chips, /[1-9]\d* Duplicate/);
  await click('.do-head [data-act="use"]');
  await wait(300);
  assert.equal((await rowRefs()).length, before);
  if (!(await overlayHidden())) await closeDraft();
});

test('T03: Diff terima/tolak per perubahan', async () => {
  const other = await page.$$eval('#m-switch option', (o) => o.map((x) => x.value));
  await page.select('#m-switch', other[1]); // rapat lain, juga sudah dipangkas
  await wait(300);
  await openDraft();
  await click('.do-lane[data-key="a"] [data-act="pick"]');
  await click('.do-tabs [data-tab="diff"]');
  const sel = '.do-drow:not(.k-dup) [data-d="reject"]';
  assert.ok(await page.$(sel), 'ada perubahan yang bisa diputuskan');
  await click(sel);
  assert.equal(await page.$eval(sel, (b) => b.getAttribute('aria-pressed')), 'true');
  await click(sel);
  assert.equal(await page.$eval(sel, (b) => b.getAttribute('aria-pressed')), 'false', 'klik kedua melepas keputusan');
  await click('.do-drow:not(.k-dup) [data-d="accept"]');
  assert.equal(await page.$eval('.do-drow:not(.k-dup) [data-d="accept"]', (b) => b.getAttribute('aria-pressed')), 'true');
  await closeDraft();
});

test('T03: rapat terbit baca-saja — pakai dan aksi Diff nonaktif', async () => {
  await click('#btn-issue');
  await wait(800);
  assert.equal(await page.evaluate(() => !document.getElementById('issued-badge').classList.contains('hidden')), true, 'rapat berhasil diterbitkan');
  await openDraft();
  assert.ok(await page.$('.do-bar.lock'), 'bilah terkunci tampil');
  await click('.do-lane[data-key="a"] [data-act="pick"]');
  assert.equal(await page.$eval('.do-head [data-act="use"]', (b) => b.disabled), true);
  await click('.do-tabs [data-tab="diff"]');
  assert.equal(await page.$$eval('.do-drow [data-act="decide"]', (bs) => bs.length > 0 && bs.every((b) => b.disabled)), true);
  await closeDraft();
});

test('dok tidak menutup tombol aksi formulir (#d-save) di empat ukuran layar', async () => {
  // dok mengambang pernah jatuh tepat di atas "Add item" pada 1280x800 (QA TC010)
  const sizes = [[1440, 900], [1280, 800], [1024, 768], [390, 844]];
  const fresh = await browser.newPage();
  fresh.on('dialog', (d) => d.accept());
  try {
    for (const [w, h, open] of sizes.flatMap(([a, b]) => [[a, b, false], [a, b, true]])) {
      await fresh.setViewport({ width: w, height: h });
      await fresh.goto(`${ORIGIN}/dist/minutes.html`, { waitUntil: 'networkidle0' });
      await fresh.waitForSelector('#btn-add-item');
      if (open) { await fresh.evaluate(() => document.querySelector('#dock-mini')?.click()); await wait(600); } // dok dibuka penuh
      await fresh.evaluate(() => document.querySelector('#btn-add-item').click());
      await fresh.waitForSelector('#d-save', { visible: true });
      await wait(700); // animasi float-in dan dok selesai
      const r = await fresh.evaluate(() => {
        const b = document.querySelector('#d-save').getBoundingClientRect();
        const pts = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.15], [0.5, 0.85]];
        return pts.map(([fx, fy]) => {
          const x = b.left + b.width * fx; const y = b.top + b.height * fy;
          const el = document.elementFromPoint(x, y);
          return { ok: !!el && !!el.closest('#d-save'), hit: el ? (el.id || el.className || el.tagName) : null };
        });
      });
      for (const p of r) assert.ok(p.ok, `${w}x${h}${open ? ' dok terbuka' : ''}: #d-save tertutup oleh ${p.hit}`);
    }
  } finally { await fresh.close(); }
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));
