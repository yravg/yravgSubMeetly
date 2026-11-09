/**
 * Windows app window: dist/ served by the engine under /app/, no chrome.* at all.
 *   node --test test/web-host.test.mjs
 *
 * A tiny static server stands in for the engine (/app/<file>, /health, /notes),
 * so the test never touches the owner's engine or its register data.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';
import { createMeeting, wrapMeetingStore } from '../src/lib/notes-schema.js';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const posts = []; // { method, path, body }
let server; let origin; let browser; let failNotes = false;
const waitFor = async (fn, what, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timeout: ' + what);
};

before(async () => {
  assert.ok(existsSync(join(DIST, 'app.html')), 'dist/ belum dibangun — jalankan `npm run build`');
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: true, device: 'cpu', models: [] }));
    }
    if (failNotes && url.pathname.startsWith('/notes')) { res.statusCode = 503; return res.end('down'); }
    if (url.pathname === '/notes' || url.pathname.startsWith('/notes/')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (req.method !== 'GET') posts.push({ method: req.method, path: url.pathname, body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(req.method === 'GET' ? { notes: [] } : { ok: true, note: body ? JSON.parse(body).note : null }));
      });
      return undefined;
    }
    if (!url.pathname.startsWith('/app/')) { res.statusCode = 404; return res.end('no'); }
    const file = normalize(join(DIST, decodeURIComponent(url.pathname.slice(5)) || 'app.html'));
    if (!file.startsWith(normalize(DIST)) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; return res.end('no'); }
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    return res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--window-size=1280,900', '--autoplay-policy=no-user-gesture-required'],
  });
});

after(async () => { await browser?.close(); await new Promise((r) => server?.close(r)); });

async function open(path, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${origin}${path}`, { waitUntil: 'networkidle0' });
  return { page, errors };
}

test('sidepanel.html runs outside the extension: no page errors, every view switches', async () => {
  const { page, errors } = await open('/app/sidepanel.html');
  assert.equal(await page.evaluate(() => typeof chrome?.runtime?.sendMessage), 'function', 'web-host stand-in installed');
  const views = await page.evaluate(() => [...document.querySelectorAll('[data-view]')].map((b) => b.dataset.view));
  for (const v of ['captions', 'notes', 'history', 'helper', 'settings']) assert.ok(views.includes(v), `view button ${v}`);
  for (const v of ['captions', 'notes', 'history', 'helper', 'settings']) {
    await page.evaluate((x) => document.querySelector(`[data-view="${x}"]`).click(), v);
    await page.waitForFunction((x) => !document.getElementById(`view-${x}`)?.classList.contains('hidden'), { timeout: 5000 }, v);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test('app.html: every route paints something and none throws', async () => {
  const { page, errors } = await open('/app/app.html');
  await page.evaluate(() => localStorage.setItem('ysmDeveloper', 'true'));
  const routes = ['today', 'live', 'minutes', 'history', 'files', 'addins', 'glossary', 'island', 'perf', 'all', 'settings', 'helper', 'plans', 'dev'];
  const blank = [];
  for (const r of routes) {
    await page.evaluate((h) => { location.hash = h; }, `#${r}`);
    await new Promise((res) => setTimeout(res, 900));
    const len = await page.evaluate(() => {
      const f = document.querySelector('#page iframe');
      try { return f ? f.contentDocument.body.innerText.length : document.querySelector('#page').innerText.length; } catch { return -1; }
    });
    if (len <= 0) blank.push(r);
  }
  assert.deepEqual(blank, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test('minutes: boot pushes what the engine lacks, a UI save is pushed, failures show a toast', async () => {
  const { page, errors } = await open('/app/minutes.html');
  const m = createMeeting({ id: 'MOM-WEB-1', seriesId: 'WEB', seq: 1, title: 'Web host check', date: '2026-11-09', start: '09:00', end: '09:30', items: [{ ref: 'D1', type: 'decision', status: 'open', text: { en: 'Ship it' } }] });
  await page.evaluate((e) => localStorage.setItem('minutesRegister', JSON.stringify(e)), wrapMeetingStore([m]));
  posts.length = 0;
  await page.reload({ waitUntil: 'networkidle0' });
  await waitFor(() => posts.some((p) => p.method === 'POST' && p.body.includes('MOM-WEB-1')), 'boot push of MOM-WEB-1');

  posts.length = 0;
  await page.waitForSelector('#btn-add-item');
  await page.click('#btn-add-item');
  await page.waitForSelector('#f-text');
  await page.type('#f-text', 'Second decision from the app window');
  await page.click('#d-save');
  await waitFor(() => posts.some((p) => p.body.includes('Second decision from the app window')), 'debounced push after a UI save');
  assert.deepEqual(errors, []);
  await page.close();
});

test('minutes: an unreachable engine surfaces a visible error, not silence', async () => {
  const { page } = await open('/app/minutes.html');
  failNotes = true;
  try {
    await page.evaluate((e) => localStorage.setItem('minutesRegister', JSON.stringify(e)), wrapMeetingStore([createMeeting({ id: 'MOM-WEB-2', seriesId: 'WEB', seq: 2, title: 'Offline check', date: '2026-11-09', start: '10:00', end: '10:30', items: [] })]));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('#toast.show.bad'), { timeout: 8000 });
    assert.match(await page.$eval('#toast', (t) => t.textContent), /Could not save to the engine/);
  } finally { failNotes = false; }
  await page.close();
});

test('captions: Start in the app window reaches an active session through getDisplayMedia', async () => {
  const ctx = await browser.createBrowserContext(); // clean storage: earlier tests change the saved view
  const page = await ctx.newPage();
  await page.setViewport({ width: 480, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((engine) => {
    // Point the helper at the stub (never the owner's engine) and fake the screen-audio picker.
    localStorage.setItem('settings', JSON.stringify({ nativeUrl: engine }));
    navigator.mediaDevices.getDisplayMedia = async () => {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.connect(dest);
      osc.start();
      const video = document.createElement('canvas').captureStream(1).getVideoTracks();
      return new MediaStream([...dest.stream.getAudioTracks(), ...video]);
    };
  }, origin);
  await page.goto(`${origin}/app/sidepanel.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.querySelector('#btn-start').click());
  await page.waitForFunction(() => window.__ysmWebHost.session().active === true, { timeout: 15000 }).catch(async (e) => {
    throw new Error(`${e.message}; status: ${await page.evaluate(() => document.querySelector('#status-text,#status')?.textContent)}; errors: ${errors.join(' | ')}`);
  });
  assert.equal(await page.evaluate(() => !document.querySelector('#btn-stop').disabled), true, 'Stop enabled while captioning');
  await page.evaluate(() => document.querySelector('#btn-stop').click());
  await page.waitForFunction(() => window.__ysmWebHost.session().active === false, { timeout: 10000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});
