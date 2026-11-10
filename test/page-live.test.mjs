/**
 * Papan A02 "Live captions" sebagai halaman shell (TIDE-006) pada dist/app.html#live.
 *   node --test test/page-live.test.mjs
 *
 * Halaman memasang panel dalam mode ?shell=1: kendali lama dipindah ke tiga kartu papan
 * (Capture | Live preview | Captions show on) tanpa mengubah id-nya, jadi Start/Stop,
 * bahasa, mesin, dan surface memakai kode panel yang sama.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8841;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page; let frame;
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

before(async () => {
  assert.ok(existsSync('dist/app.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/app.html`);
  await wait(1500);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1440,1000', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/dist/app.html#live`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ysmShellWelcomed', 'true'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  frame = await (await page.waitForSelector('#page iframe.panel')).contentFrame();
  await frame.waitForSelector('#live-shell');
  await wait(600);
});
after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

const text = (sel) => frame.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const visible = (sel) => frame.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).catch(() => false);

test('three board cards: Capture, Live preview, Captions show on', async () => {
  assert.equal(await text('#live-shell .ls-capture > h2'), 'Capture');
  assert.match(await text('#live-shell .ls-preview .ls-eyebrow'), /live preview/i);
  assert.match(await text('#live-shell .ls-surface > h2'), /captions show on/i);
  const r = await frame.evaluate(() => ['.ls-capture', '.ls-preview', '.ls-surface'].map((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width)]; }));
  // Capture on the left, preview above surface on the right (board layout at 1440).
  assert.ok(r[0][0] < r[1][0], 'capture is left of preview');
  assert.ok(r[1][1] < r[2][1], 'preview is above the surface card');
  assert.equal(r[1][0], r[2][0], 'preview and surface share a column');
});

test('Capture lists source, mode, task, density, languages, engine line, Start and End', async () => {
  assert.deepEqual(await frame.$$eval('#ls-source button', (b) => b.map((x) => x.textContent.trim())), ['Tab audio', 'File', 'Microphone']);
  for (const id of ['mode-toggle', 'task-toggle', 'src-lang', 'tgt-lang', 'engine-line', 'btn-engine-line', 'btn-start', 'btn-stop']) {
    assert.ok(await frame.$eval(`#live-shell .ls-capture #${id}`, () => true).catch(() => false), `${id} sits in the Capture card`);
  }
  assert.ok(await frame.$('#live-shell .ls-capture [data-density-mode="detail"]'), 'Simple / Detail is in the Capture card');
});

test('idle: preview says Nothing yet, End is disabled', async () => {
  assert.match(await text('#ls-preview-empty'), /Nothing yet/);
  assert.equal(await visible('#ls-preview-empty'), true, 'the empty message is on screen, not just in the DOM');
  assert.equal(await frame.$eval('#btn-stop', (b) => b.disabled), true);
});

test('Captions show on: three tiles drive the same captionSurface setting', async () => {
  assert.deepEqual(await frame.$$eval('#ls-surface-tiles button', (b) => b.map((x) => x.querySelector('b').textContent.trim())), ['Page overlay', 'Island', 'Both']);
  await frame.click('#ls-surface-tiles button[data-surface="island"]');
  await wait(300);
  const stored = await frame.evaluate(() => chrome.storage.local.get('captionSurface'));
  assert.equal(stored.captionSurface, 'island');
  assert.equal(await frame.$eval('#ls-surface-tiles button[data-surface="island"]', (b) => b.getAttribute('aria-checked')), 'true');
  // The shell's Island switch follows the same key.
  await page.waitForFunction(() => document.querySelector('#island-switch').checked === true);
});

test('Start captions listens, the preview fills from real segments, End returns to idle', async () => {
  await frame.click('#btn-start');
  await frame.waitForFunction(() => document.getElementById('btn-stop').disabled === false, { timeout: 60_000 });
  await frame.waitForFunction(() => /listening · \d\d:\d\d/i.test(document.getElementById('ls-live-state')?.textContent || ''), { timeout: 30_000 });
  assert.match(await text('#ls-preview-empty'), /Listening/);
  // Segments arrive on the panel's own receiver (fields are source/translation, not src/tgt).
  await frame.evaluate(async () => {
    const send = (type, data) => chrome.runtime.sendMessage({ target: 'panel', type, data });
    send('subtitle', { source: 'Sedang bicara…', translation: 'Speaking…', interim: true, partial: true });
    await new Promise((r) => setTimeout(r, 250));
    send('subtitle', { source: 'Selamat pagi', translation: 'Good morning', t0: 10, t1: 12, dir: { src: 'id', tgt: 'en' } });
  });
  await frame.waitForFunction(() => document.getElementById('live-tgt-lines').textContent.includes('Good morning'), { timeout: 10_000 });
  await frame.waitForFunction(() => document.getElementById('ls-preview-empty').hidden === true, { timeout: 5_000 });
  await frame.click('#btn-stop');
  await frame.waitForFunction(() => document.getElementById('btn-stop').disabled === true, { timeout: 15_000 });
  assert.match(await text('#ls-live-state'), /stopped|idle/i);
});

test('Microphone source: Start opens the mic stream and the pipeline starts, End releases it', async () => {
  await frame.click('#ls-source button[data-src="mic"]');
  assert.equal(await frame.$eval('#ls-source button[data-src="mic"]', (b) => b.getAttribute('aria-checked')), 'true');
  await frame.click('#btn-start');
  await frame.waitForFunction(() => document.getElementById('btn-stop').disabled === false, { timeout: 60_000 });
  const live = await frame.evaluate(() => window.__ysmCaptureStream?.getAudioTracks()[0]?.readyState);
  assert.equal(live, 'live', 'the page holds a live microphone track');
  await frame.click('#btn-stop');
  await frame.waitForFunction(() => document.getElementById('btn-stop').disabled === true, { timeout: 15_000 });
  assert.equal(await frame.evaluate(() => window.__ysmCaptureStream ?? null), null, 'End released the stream');
  await frame.click('#ls-source button[data-src="tab"]');
});

test('error state is a plain red callout with Retry, no mascot', async () => {
  await frame.evaluate(() => window.__ysmShowError?.('Audio capture failed: helper did not answer'));
  assert.ok(await visible('#error-box'));
  assert.equal(await frame.$eval('#error-box', (e) => !!e.querySelector('img')), false);
  assert.ok(await frame.$eval('#live-shell .ls-preview #error-box', () => true).catch(() => false), 'error shows inside the preview card');
});

test('no page errors', () => { assert.deepEqual(pageErrors, []); });
