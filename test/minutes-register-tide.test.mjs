/**
 * Papan A04a (register Modern, minutes.html?skin=tide): header lengket, kepadatan
 * Review / Reading / Compact, aksi saat hover (Accept / Edit / Owner), chip status
 * Source berhuruf kalimat, tanggal jatuh tempo tetap tinta (hanya sub-baris merah),
 * label tema "Tide dark" / "Tide light". Classic (tanpa ?skin) tidak berubah (A04d).
 *   node --test test/minutes-register-tide.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8851;
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

/** Buka register di lebar/tinggi tertentu, isi dengan sampel W36, tunggu baris. */
async function open(search, width = 1440, height = 900) {
  await page.setViewport({ width, height });
  const q = /lang=/.test(search) ? search : `${search}${search ? '&' : '?'}lang=en`;
  await page.goto(`${ORIGIN}/dist/minutes.html${q}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.removeItem('ysmRowDensity'); });
  if (await page.$('#btn-load-sample')) {
    await page.evaluate(() => document.querySelector('#btn-load-sample').click());
  }
  await page.waitForSelector('tbody tr[data-ref]');
}
const stored = (ref) => page.evaluate((r) => {
  const env = JSON.parse(localStorage.getItem('minutesRegister'));
  const ms = env.meetings || env.items || Object.values(env).find(Array.isArray) || [];
  for (const m of ms) { const it = (m.items || []).find((i) => i.ref === r); if (it) return it.review; }
  return null;
}, ref);
const rowH = () => page.evaluate(() => document.querySelector('tbody tr[data-ref]').getBoundingClientRect().height);

before(async () => {
  assert.ok(existsSync('dist/minutes.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/minutes.html`);
  await wait(1200);
  browser = await puppeteer.launch({ headless: true });
  page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
});
after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('theme picker reads "Tide dark" / "Tide light" in Modern; Classic keeps its labels', async () => {
  await open('?skin=tide');
  const modern = await page.$$eval('[data-theme-pick] b', (bs) => bs.map((b) => b.textContent.trim()));
  assert.deepEqual(modern, ['Tide dark', 'Tide light']);
  await open('');
  const classic = await page.$$eval('[data-theme-pick] b', (bs) => bs.map((b) => b.textContent.trim()));
  assert.deepEqual(classic, ['Local · dark', 'Coretax · paper']);
});

test('theme labels have an Indonesian version', async () => {
  await open('?skin=tide&lang=id');
  const id = await page.$$eval('[data-theme-pick] b', (bs) => bs.map((b) => b.textContent.trim()));
  assert.deepEqual(id, ['Tide gelap', 'Tide terang']);
});

test('sticky header: stays at the top of the pane while rows scroll, shadow fades in after 4 px', async () => {
  await open('?skin=tide', 1440, 700);
  const before_ = await page.evaluate(() => document.querySelector('#pane').dataset.scrolled || '');
  assert.notEqual(before_, 'true', 'no shadow at scroll 0');
  const r = await page.evaluate(async () => {
    const pane = document.querySelector('#pane');
    pane.scrollTop = 240;
    await new Promise((res) => setTimeout(res, 250));
    const th = document.querySelector('thead th').getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    return { scrolled: pane.scrollTop, gap: Math.abs(th.top - pr.top), flag: pane.dataset.scrolled, shadow: getComputedStyle(document.querySelector('thead th')).boxShadow };
  });
  assert.ok(r.scrolled > 100, `pane must scroll (scrollTop ${r.scrolled})`);
  assert.ok(r.gap <= 1, `header pinned to pane top (gap ${r.gap})`);
  assert.equal(r.flag, 'true');
  assert.notEqual(r.shadow, 'none');
});

test('density Review / Reading / Compact: Reading by default, switching changes row height at once and is remembered', async () => {
  await open('?skin=tide');
  const labels = await page.$$eval('#reg-density button', (bs) => bs.map((b) => b.textContent.trim()));
  assert.deepEqual(labels, ['Review', 'Reading', 'Compact']);
  assert.equal(await page.$eval('#reg-density [aria-pressed="true"]', (b) => b.dataset.rowDensity), 'reading');
  const reading = await rowH();
  await page.click('#reg-density [data-row-density="compact"]');
  await wait(300);
  const compact = await rowH();
  await page.click('#reg-density [data-row-density="review"]');
  await wait(300);
  const review = await rowH();
  assert.ok(compact < review && review < reading, `compact ${compact} < review ${review} < reading ${reading}`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.rowDensity), 'review');
  assert.equal(await page.evaluate(() => localStorage.getItem('ysmRowDensity')), 'review');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('tbody tr[data-ref]');
  assert.equal(await page.$eval('#reg-density [aria-pressed="true"]', (b) => b.dataset.rowDensity), 'review');
});

test('row hover shows Accept / Edit / Owner; Accept writes only after the click', async () => {
  await open('?skin=tide');
  const ref = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-ref]')].find((tr) => tr.querySelector('.rev[data-r="ai"]'))?.dataset.ref);
  assert.ok(ref, 'sample has an AI-draft row');
  const sel = `tbody tr[data-ref="${ref}"]`;
  assert.equal(await page.$eval(`${sel} .row-act`, (e) => getComputedStyle(e).opacity), '0', 'hidden until hover');
  await page.hover(`${sel} .c-item`);
  await wait(300);
  assert.equal(await page.$eval(`${sel} .row-act`, (e) => getComputedStyle(e).opacity), '1');
  assert.deepEqual(await page.$$eval(`${sel} .row-act button`, (bs) => bs.map((b) => b.textContent.trim())), ['Accept', 'Edit', 'Owner']);
  assert.equal(await stored(ref), 'ai', 'hovering writes nothing');
  await page.click(`${sel} .row-act [data-act="accept"]`);
  await page.waitForFunction((r) => document.querySelector(`tbody tr[data-ref="${r}"] .rev`)?.dataset.r === 'accepted', { timeout: 5000 }, ref);
  assert.equal(await stored(ref), 'accepted');
});

test('row hover Edit opens the existing editor; Owner focuses the owner field', async () => {
  await open('?skin=tide');
  const ref = await page.$eval('tbody tr[data-ref]', (tr) => tr.dataset.ref);
  const sel = `tbody tr[data-ref="${ref}"]`;
  await page.hover(`${sel} .c-item`);
  await page.click(`${sel} .row-act [data-act="edit"]`);
  await page.waitForFunction(() => !document.querySelector('#drawer').hidden, { timeout: 4000 });
  assert.ok((await page.$eval('#d-id', (e) => e.textContent.trim())).startsWith(ref));
  await page.click('#d-close');
  await page.hover(`${sel} .c-item`);
  await page.click(`${sel} .row-act [data-act="owner"]`);
  await page.waitForFunction(() => document.activeElement?.id === 'f-owner', { timeout: 4000 });
});

test('keyboard shortcut a still accepts the selected row', async () => {
  await open('?skin=tide');
  const ref = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-ref]')].find((tr) => tr.querySelector('.rev[data-r="ai"]'))?.dataset.ref);
  await page.click(`tbody tr[data-ref="${ref}"] .c-ref`);
  await page.keyboard.press('a');
  await page.waitForFunction((r) => document.querySelector(`tbody tr[data-ref="${r}"] .rev`)?.dataset.r === 'accepted', { timeout: 5000 }, ref);
});

test('Source status reads in sentence case chips; overdue date stays ink, only the sub-line is red', async () => {
  await open('?skin=tide');
  const chips = await page.$$eval('tbody tr[data-ref] .rev', (els) => els.map((e) => ({ t: e.textContent.trim(), tt: getComputedStyle(e).textTransform, bg: getComputedStyle(e).backgroundColor })));
  assert.ok(chips.some((c) => c.t === 'AI draft'), JSON.stringify(chips.slice(0, 3)));
  assert.ok(chips.some((c) => c.t === 'Accepted'));
  for (const c of chips) { assert.equal(c.tt, 'none'); assert.notEqual(c.bg, 'rgba(0, 0, 0, 0)', 'chip has a fill'); }
  const od = await page.$eval('tbody .due.over', (d) => {
    const rel = d.querySelector('.rel');
    return { date: getComputedStyle(d).color, rel: getComputedStyle(rel).color, weight: getComputedStyle(rel).fontWeight };
  });
  assert.notEqual(od.date, od.rel, 'date and sub-line differ');
  assert.ok(Number(od.weight) >= 600, 'sub-line is bold');
  const [r, g, b] = od.rel.match(/\d+/g).map(Number);
  assert.ok(r > g + 40 && r > b + 40, `sub-line is red (${od.rel})`);
  const [r2, g2, b2] = od.date.match(/\d+/g).map(Number);
  assert.ok(Math.abs(r2 - g2) < 40 && Math.abs(r2 - b2) < 40, `date is ink, not red (${od.date})`);
});

test('Classic (no ?skin) is unchanged: no density control, no hover actions, uppercase source status', async () => {
  await open('');
  assert.equal(await page.$eval('#reg-density', (e) => getComputedStyle(e).display), 'none');
  assert.equal(await page.$eval('tbody tr[data-ref] .row-act', (e) => getComputedStyle(e).display), 'none');
  assert.equal(await page.$eval('tbody tr[data-ref] .rev', (e) => getComputedStyle(e).textTransform), 'uppercase');
});

test('empty register in Modern: Tide asleep', async () => {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${ORIGIN}/dist/minutes.html?skin=tide`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  const bg = await page.$eval('#empty-state .empty', (e) => getComputedStyle(e, '::before').backgroundImage);
  assert.match(bg, /tide-sleep/);
});

test('a meeting with no items shows Tide asleep, "No items yet", Draft options and Add item; the band stays at zero', async () => {
  await open('?skin=tide');
  await page.evaluate(async () => {
    const env = JSON.parse(localStorage.getItem('minutesRegister'));
    for (const m of env.meetings) m.items = [];
    localStorage.setItem('minutesRegister', JSON.stringify(env));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#pane .empty.empty-items');
  const r = await page.evaluate(() => {
    const e = document.querySelector('#pane .empty.empty-items');
    const img = getComputedStyle(e, '::before').backgroundImage;
    return { h: e.querySelector('h3')?.textContent.trim(), btns: [...e.querySelectorAll('button')].map((b) => b.textContent.trim()), img, band: document.querySelector('#sum-total, .sum-total, .sum-count')?.textContent.trim() };
  });
  assert.equal(r.h, 'No items yet');
  assert.deepEqual(r.btns, ['Draft options', 'Add item']);
  assert.match(r.img, /tide-sleep/);
  // Add item here opens the same editor as the toolbar button.
  await page.click('#pane .empty-items [data-empty-act="add"]');
  await page.waitForFunction(() => !document.querySelector('#drawer').hidden, { timeout: 4000 });
  assert.equal(await page.$('#reg-tb:not([hidden])'), null, 'density control hides with no rows');
});

test('breadcrumb sits on its own line in the meeting header at 1440 and 1024; the Minutes home link stays in the toolbar', async () => {
  for (const w of [1440, 1024]) {
    await open('?skin=tide', w);
    const r = await page.evaluate(() => {
      const t = document.querySelector('#crumb-trail');
      const full = [...t.querySelectorAll('span:not(.sep)')].every((e) => e.scrollWidth <= e.clientWidth + 1);
      return { inHeader: !!t.closest('#top-panel'), home: !!document.querySelector('.appbar #crumb-home'), visible: t.getBoundingClientRect().width > 0, full, text: t.textContent };
    });
    assert.ok(r.inHeader && r.home && r.visible, `${w}: ${JSON.stringify(r)}`);
    assert.ok(r.full, `${w}: crumbs are not truncated (${r.text})`);
  }
});

test('?view= and ?do= from the shell page: the register opens on that view and runs that action', async () => {
  await open('?skin=tide');
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('minutesRegister')).meetings[0].id);
  await page.goto(`${ORIGIN}/dist/minutes.html?skin=tide&lang=en&meeting=${encodeURIComponent(id)}&view=topic`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#tabs [data-view="topic"][aria-selected="true"]', { timeout: 6000 });
  await page.goto(`${ORIGIN}/dist/minutes.html?skin=tide&lang=en&meeting=${encodeURIComponent(id)}&do=add`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.querySelector('#drawer').hidden, { timeout: 6000 });
  await page.goto(`${ORIGIN}/dist/minutes.html?skin=tide&lang=en&meeting=${encodeURIComponent(id)}&do=library`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => { const o = document.querySelector('.lt-overlay'); return o && !o.hidden && getComputedStyle(o).display !== 'none'; }, { timeout: 6000 });
});

test('no page errors', () => { assert.deepEqual(pageErrors, []); });
