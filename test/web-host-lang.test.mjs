/**
 * Languages in the app window: spoken language defaults to Auto, and the pair lives in the engine's /ui-prefs.
 *   node --test test/web-host-lang.test.mjs
 *
 * A stub engine serves dist/ under /app/ and a /ui-prefs it can seed and record (never the real engine).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
let server; let origin; let browser; let stored = null; let posts = [];

before(async () => {
  assert.ok(existsSync(join(DIST, 'sidepanel.html')), 'dist/ not built: run `npm run build`');
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (body, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname === '/health') return json({ ok: true, device: 'cpu', models: [] });
    if (url.pathname === '/ui-prefs' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { posts.push(JSON.parse(body || '{}')); json({ ok: true, prefs: {} }); });
      return undefined;
    }
    if (url.pathname === '/ui-prefs') return json(stored ? { stored: true, prefs: stored } : { stored: false, prefs: {} });
    if (!url.pathname.startsWith('/app/')) return json({});
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

async function open() {
  const page = await (await browser.createBrowserContext()).newPage(); // fresh storage per test
  await page.setViewport({ width: 520, height: 900 });
  await page.evaluateOnNewDocument((engine) => localStorage.setItem('settings', JSON.stringify({ nativeUrl: engine, uiLang: 'en' })), origin);
  const go = () => page.goto(`${origin}/app/sidepanel.html`, { waitUntil: 'networkidle0' });
  await go().catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; return go(); }); // shortcut: first navigation of a fresh Chrome sometimes aborts, cause not found
  return page;
}
const langs = (page) => page.evaluate(() => [document.getElementById('src-lang').value, document.getElementById('tgt-lang').value]);

test('fresh engine: spoken language is Auto, not a hard-coded one', { timeout: 60_000 }, async () => {
  stored = null; posts = [];
  const page = await open();
  assert.deepEqual(await langs(page), ['auto', 'en']);
  await page.close();
});

test('the pair comes from the engine and goes back to it when changed', { timeout: 60_000 }, async () => {
  stored = { theme: 'auto', srcLang: 'id', tgtLang: 'ja' }; posts = [];
  const page = await open();
  assert.deepEqual(await langs(page), ['id', 'ja'], 'engine pair applied');
  await page.select('#src-lang', 'en');
  await page.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 400));
  const last = posts.at(-1);
  assert.equal(last.srcLang, 'en');
  assert.equal(last.tgtLang, 'ja');
  await page.close();
});

test('an engine value that is not a known language is ignored', { timeout: 60_000 }, async () => {
  stored = { theme: 'auto', srcLang: 'xx', tgtLang: 'yy' }; posts = [];
  const page = await open();
  assert.deepEqual(await langs(page), ['auto', 'en']);
  await page.close();
});
