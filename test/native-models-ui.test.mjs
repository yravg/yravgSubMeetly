/**
 * Settings > Engine models in the app window: the engine's catalog with a picker, Download and progress.
 *   node --test test/native-models-ui.test.mjs
 *
 * A stub engine serves dist/ under /app/ and the Models API shapes of engine-rs/engine/tests/models_api.rs
 * (GET /models {models, catalog}, POST /models/pull, POST /engine/models). It never talks to the real engine.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const row = (kind, id, label, approxBytes, extra = {}) => ({ kind, id, label, approxBytes, selected: false, downloaded: false, bytes: 0, partialBytes: 0, pulling: false, bytesDone: 0, bytesTotal: 0, pct: 0, pullError: null, ...extra });
const catalog = () => [
  row('asr', 'openai/whisper-base', 'Whisper base', 290_000_000, { downloaded: true, bytes: 290_000_000, selected: true }),
  row('asr', 'openai/whisper-small', 'Whisper small', 967_000_000),
  row('translate', 'Qwen/Qwen2.5-0.5B-Instruct', 'Qwen 2.5 0.5B', 1_000_000_000, { partialBytes: 300_000_000, selected: true }),
  row('translate', 'Qwen/Qwen2.5-1.5B-Instruct', 'Qwen 2.5 1.5B', 3_100_000_000, { downloaded: true, bytes: 3_100_000_000 }),
];
let cat; let calls; let server; let origin; let browser; let pullFails = false;

before(async () => {
  assert.ok(existsSync(join(DIST, 'app.html')), 'dist/ not built: run `npm run build`');
  cat = catalog(); calls = [];
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname === '/health') return json(200, { ok: true, device: 'cpu', models: [] });
    if (url.pathname === '/models') return json(200, { models: [], catalog: cat });
    if (url.pathname === '/models/pull' || url.pathname === '/engine/models') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const b = JSON.parse(body || '{}');
        calls.push({ path: url.pathname, body: b });
        if (url.pathname === '/models/pull') {
          const m = cat.find((r) => r.id === b.id);
          if (!m) return json(400, { error: 'unknown model' });
          if (pullFails) { m.pullError = 'download failed: no network'; return json(202, { started: true }); }
          Object.assign(m, { pulling: true, bytesTotal: m.approxBytes, bytesDone: m.approxBytes / 2, pct: 50 });
          return json(202, { started: true });
        }
        const asr = b.asr && cat.find((r) => r.id === b.asr);
        if (b.asr && !asr) return json(400, { error: 'not a speech model' });
        for (const r of cat) if ((b.asr && r.kind === 'asr') || (b.translate && r.kind === 'translate')) r.selected = r.id === b.asr || r.id === b.translate;
        return json(200, { ok: true, applied: true });
      });
      return undefined;
    }
    if (!url.pathname.startsWith('/app/')) return json(200, {});
    const file = normalize(join(DIST, decodeURIComponent(url.pathname.slice(5)) || 'app.html'));
    if (!file.startsWith(normalize(DIST)) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; return res.end('no'); }
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    return res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser?.close(); await new Promise((r) => server?.close(r)); });

const rows = (page) => page.$$eval('#native-models .m-item', (els) => els.map((e) => ({
  title: e.querySelector('.m-name').textContent,
  sub: e.querySelector('.m-sub').textContent,
  selected: e.dataset.selected === 'true',
  buttons: [...e.querySelectorAll('button')].map((b) => ({ text: b.textContent, disabled: b.disabled })),
  bar: e.querySelector('.fill')?.style.width || null,
  error: e.querySelector('.m-error')?.textContent || null,
})));
const click = (page, title, text) => page.evaluate((ti, tx) => {
  const item = [...document.querySelectorAll('#native-models .m-item')].find((e) => e.querySelector('.m-name').textContent === ti);
  [...item.querySelectorAll('button')].find((b) => b.textContent.startsWith(tx)).click();
}, title, text);
// shortcut: the first navigation of a fresh Chrome sometimes ends net::ERR_ABORTED (cause not found); one retry, drop it when found.
const openModels = async (page) => {
  const go = () => page.goto(`${origin}/app/sidepanel.html?view=settings&stab=engine`, { waitUntil: 'domcontentloaded' });
  await go().catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; return go(); });
};
const waitRows = (page, fn, what) => page.waitForFunction(fn, { timeout: 8000 }).catch(() => { throw new Error('timeout: ' + what); });

test('Models: catalog rows say what is on disk, pick, download with progress, failure and retry', { timeout: 60_000 }, async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 520, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((engine) => localStorage.setItem('settings', JSON.stringify({ nativeUrl: engine })), origin);
  await openModels(page);
  await waitRows(page, () => document.querySelectorAll('#native-models .m-item').length >= 5, 'five rows');

  if (process.env.MODELS_SHOT) { await page.$eval('#native-models', (e) => e.scrollIntoView()); await page.screenshot({ path: process.env.MODELS_SHOT + '-a.png' }); }
  let r = await rows(page);
  assert.deepEqual(r.map((x) => x.title), ['Whisper base', 'Whisper small', 'Translation off', 'Qwen 2.5 0.5B', 'Qwen 2.5 1.5B']);
  assert.equal(r[0].selected, true);
  assert.match(r[0].sub, /On disk/);
  assert.match(r[1].sub, /Not downloaded, about 922 MB/, 'size comes from the catalog, not invented');
  assert.deepEqual(r[1].buttons.map((b) => b.text), ['Download']);
  assert.equal(r[2].selected, false, 'translation is on, so Off is not the choice');
  assert.match(r[3].sub, /286 MB of it was saved earlier/, 'partial bytes show');
  assert.deepEqual(r[4].buttons.map((b) => b.text), ['Use']);

  // Use a downloaded model: the engine is told, the row flips.
  await click(page, 'Qwen 2.5 1.5B', 'Use');
  await waitRows(page, () => [...document.querySelectorAll('#native-models .m-item')].find((e) => e.querySelector('.m-name').textContent === 'Qwen 2.5 1.5B')?.dataset.selected === 'true', 'selected 1.5B');
  assert.deepEqual(calls.at(-1), { path: '/engine/models', body: { translate: 'Qwen/Qwen2.5-1.5B-Instruct' } });

  // Translation off.
  await click(page, 'Translation off', 'Use');
  await waitRows(page, () => document.querySelector('#native-models .m-item[data-selected="true"] .m-name')?.textContent === 'Whisper base' && [...document.querySelectorAll('#native-models .m-item[data-selected="true"] .m-name')].some((n) => n.textContent === 'Translation off'), 'off selected');
  assert.deepEqual(calls.at(-1), { path: '/engine/models', body: { translate: 'off' } });

  // Download: 202 at once, then progress from the polled rows.
  await click(page, 'Whisper small', 'Download');
  await waitRows(page, () => document.querySelector('#native-models .fill'), 'progress bar');
  r = await rows(page);
  assert.deepEqual(calls.at(-1), { path: '/models/pull', body: { id: 'openai/whisper-small' } });
  assert.equal(r[1].bar, '50%');
  assert.deepEqual(r[1].buttons, [{ text: 'Downloading 50%', disabled: true }]);

  // A pull that fails shows its reason on the row, with Try again.
  pullFails = true;
  cat[1].pulling = false;
  await waitRows(page, () => [...document.querySelectorAll('#native-models .m-item')].some((e) => e.querySelector('.m-name').textContent === 'Whisper small' && e.querySelector('button')?.textContent === 'Download'), 'pull ended');
  await click(page, 'Whisper small', 'Download');
  await waitRows(page, () => document.querySelector('#native-models .m-error'), 'error shown');
  r = await rows(page);
  assert.match(r[1].error, /^download failed: no network$/);
  assert.deepEqual(r[1].buttons.map((b) => b.text), ['Try again']);
  if (process.env.MODELS_SHOT) { await page.$eval('#native-models', (e) => e.scrollIntoView()); await page.screenshot({ path: process.env.MODELS_SHOT + '-b.png' }); }
  assert.deepEqual(errors, []);
  await page.close();
});

test('Models: an engine without a catalog shows nothing instead of invented rows', { timeout: 30_000 }, async () => {
  const saved = cat; cat = undefined;
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((engine) => localStorage.setItem('settings', JSON.stringify({ nativeUrl: engine })), origin);
  await openModels(page);
  assert.equal((await rows(page)).length, 0);
  await page.close();
  cat = saved;
});
