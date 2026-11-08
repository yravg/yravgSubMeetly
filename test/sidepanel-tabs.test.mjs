/**
 * Board D02: lima tujuan (Captions, Notes, History, Helper, Settings), peta fitur,
 * dan dua pengaturan baru (Tab rows, Translation colour).
 *   node --test test/sidepanel-tabs.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8882;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const VIEWS = ['captions', 'notes', 'history', 'helper', 'settings'];
let server;
let browser;
let page;
const pageErrors = [];

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}

before(async () => {
  assert.ok(existsSync('dist/sidepanel.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`${ORIGIN}/app.html`);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1280,900'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/app.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#app-mount .bottom-nav-item');
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

const openView = async (view) => {
  await page.evaluate((v) => document.querySelector(`.bottom-nav-item[data-view="${v}"]`)?.click(), view);
  await page.waitForFunction(
    (v) => {
      const el = document.getElementById(`view-${v}`);
      return !!el && !el.classList.contains('hidden');
    },
    { timeout: 10_000 },
    view,
  );
};
const stored = () => page.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));

test('bottom nav punya 5 tujuan dan tiap tujuan membuka panelnya sendiri', async () => {
  const views = await page.$$eval('.bottom-nav-item', (b) => b.map((x) => x.dataset.view));
  assert.deepEqual(views, VIEWS);
  for (const v of views) {
    await openView(v);
    const shown = await page.evaluate(
      (all) => all.filter((x) => !document.getElementById(`view-${x}`).classList.contains('hidden')).join(),
      VIEWS,
    );
    assert.equal(shown, v, `hanya view-${v} yang boleh terbuka`);
  }
  await openView('history');
  assert.equal(
    await page.evaluate(
      () =>
        !!document.querySelector('#view-history #history-list') &&
        !!document.querySelector('#view-history #history-search') &&
        !!document.querySelector('#view-history #export-mount'),
    ),
    true,
  );
  await openView('helper');
  assert.equal(
    await page.evaluate(
      () => !!document.querySelector('#view-helper #helper-status-mount') && !!document.querySelector('#view-helper #helper-guide-mount'),
    ),
    true,
  );
});

test('baris engine di Captions dan sakelar perangkat helper di tab Helper', async () => {
  await openView('captions');
  assert.equal(await page.evaluate(() => !!document.querySelector('#view-captions #engine-line')), true);
  await openView('helper');
  assert.equal(await page.evaluate(() => !!document.querySelector('#view-helper #native-device-toggle')), true);
});

test('Tab rows: bawaan One menyembunyikan baris atas; Two memunculkannya dan tersimpan', async () => {
  await openView('captions');
  const vis = () =>
    page.evaluate(() => {
      const t = document.getElementById('view-tabs');
      return getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().height > 0;
    });
  assert.equal(await vis(), false, 'default One: baris atas tersembunyi');
  assert.equal((await stored())?.tabRows ?? 'one', 'one');
  await openView('settings');
  await page.evaluate(() => document.querySelector('#tabrows-toggle button[data-tabrows="two"]').click());
  await pause();
  assert.equal((await stored()).tabRows, 'two');
  await openView('captions');
  assert.equal(await vis(), true, 'Two: baris atas Captions/Notes kembali');
  await page.evaluate(() => document.querySelector('#view-tabs button[data-view="notes"]').click());
  assert.equal(await page.evaluate(() => !document.getElementById('view-notes').classList.contains('hidden')), true);
  await openView('settings');
  await page.evaluate(() => document.querySelector('#tabrows-toggle button[data-tabrows="one"]').click());
  await pause();
  assert.equal(await vis(), false);
});

test('Translation colour: 5 swatch, indigo bawaan, baris terjemahan ikut dan tersimpan', async () => {
  await openView('settings');
  // Varian kartu gelap berbeda; pastikan tema terang supaya nilainya tetap.
  await page.evaluate(() => document.querySelector('#theme-toggle button[data-theme="light"]').click());
  await pause();
  const sw = await page.$$eval('#tcolor-toggle button', (b) => b.map((x) => [x.dataset.tcolor, x.classList.contains('active')]));
  assert.deepEqual(sw.map((s) => s[0]), ['indigo', 'navy', 'teal', 'neutral', 'bronze']);
  assert.equal(sw.find((s) => s[1])?.[0], 'indigo');
  const rgb = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
  const col = () => page.evaluate(() => getComputedStyle(document.getElementById('live-tgt-lines')).color);
  assert.equal(await col(), rgb('#4A3C94'));
  await page.evaluate(() => document.querySelector('#tcolor-toggle button[data-tcolor="teal"]').click());
  await pause();
  assert.equal(await col(), rgb('#0B6E83'));
  assert.equal((await stored()).translationColour, 'teal');
  await page.evaluate(() => document.querySelector('#tcolor-toggle button[data-tcolor="indigo"]').click());
  await pause();
  assert.equal(await col(), rgb('#4A3C94'));
});

test('peta fitur: 10 grup berwarna, klik melompat ke tab', async () => {
  await openView('settings');
  await page.evaluate(() => document.querySelector('#settings-tabs button[data-stab="about"]').click());
  assert.equal(await page.$$eval('#feature-map .mc', (c) => c.length), 10);
  await page.evaluate(() => document.querySelector('#feature-map .mc[data-tab="history"]').click());
  await page.waitForFunction(() => !document.getElementById('view-history').classList.contains('hidden'));
});

test('Settings adalah tab biasa: bukan lapisan tetap, enam kelompok (Add-ins dari board T05)', async () => {
  await openView('settings');
  const r = await page.evaluate(() => {
    const m = document.getElementById('settings-modal');
    return {
      pos: getComputedStyle(m).position,
      inMain: !!m.closest('main'),
      tabs: [...document.querySelectorAll('#settings-tabs button')].map((b) => b.dataset.stab),
    };
  });
  assert.notEqual(r.pos, 'fixed');
  assert.equal(r.inMain, true);
  assert.deepEqual(r.tabs, ['general', 'engine', 'models', 'output', 'addins', 'about']);
});

test('tidak ada galat runtime', () => {
  assert.deepEqual(pageErrors, [], `galat halaman: ${pageErrors.join(' | ')}`);
});
