/**
 * App window panel: no nested chrome inside the shell, one captions label, readable chip.
 *   node --test test/web-host-ux.test.mjs
 *
 * A stub engine serves dist/ under /app/ and answers every engine route with {} (never the real engine).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
let server; let origin; let browser;

before(async () => {
  assert.ok(existsSync(join(DIST, 'sidepanel.html')), 'dist/ not built: run `npm run build`');
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname === '/health') return json({ ok: true, device: 'cpu', models: [] });
    if (url.pathname === '/_frame') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><iframe id="f" src="/app/sidepanel.html" style="width:520px;height:860px;border:0"></iframe>'); }
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

async function open(path, { light = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 560, height: 900 });
  await page.evaluateOnNewDocument((engine, isLight) => {
    if (location.pathname.startsWith('/app/')) localStorage.setItem('settings', JSON.stringify({ nativeUrl: engine, theme: isLight ? 'light' : 'dark', uiLang: 'en' }));
  }, origin, light);
  const go = () => page.goto(`${origin}${path}`, { waitUntil: 'networkidle0' });
  await go().catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; return go(); }); // shortcut: first navigation of a fresh Chrome sometimes aborts, cause not found; drop the retry when found
  return page;
}
const panel = async (page) => (await (await page.waitForSelector('#f')).contentFrame());
const shown = (frame, sel) => frame.$eval(sel, (e) => getComputedStyle(e).display !== 'none');

test('embedded in the shell: the panel hides its own header and bottom bar; alone it keeps them', { timeout: 60_000 }, async () => {
  const page = await open('/_frame');
  const f = await panel(page);
  await f.waitForSelector('#btn-start');
  assert.equal(await shown(f, '.topbar'), false);
  assert.equal(await shown(f, '#bottom-nav'), false);
  assert.equal(await shown(f, '#btn-start'), true, 'the work area stays');
  await page.close();

  const alone = await open('/app/sidepanel.html');
  assert.equal(await shown(alone, '.topbar'), true);
  assert.equal(await shown(alone, '#bottom-nav'), true);
  await alone.close();
});

test('one label starts captions; the share picker says what it is', { timeout: 60_000 }, async () => {
  const page = await open('/app/sidepanel.html');
  assert.equal(await page.$eval('#btn-start', (e) => e.textContent.trim()), 'Start captions');
  assert.equal(await page.$eval('#btn-stop', (e) => e.textContent.trim()), 'Stop captions');
  assert.equal(await page.$eval('#btn-pick', (e) => e.textContent.trim()), 'Share a tab or window…');
  assert.ok(!/Start Task|End Task/.test(await page.$eval('body', (e) => e.innerText)), 'no Start Task anywhere');
  await page.close();
});

test('Current page chip: text on its tint is at least 4.5:1 in light mode', { timeout: 60_000 }, async () => {
  const page = await open('/app/sidepanel.html', { light: true });
  const [fg, bg] = await page.$eval('#target-tag', (e) => {
    const cs = getComputedStyle(e);
    // the tint is translucent: composite it over the card behind it
    const under = getComputedStyle(e.parentElement.closest('.target-card') || e.parentElement).backgroundColor;
    return [cs.color, cs.backgroundColor + '|' + under];
  });
  const rgba = (s) => s.match(/[\d.]+/g).map(Number);
  const [tint, base] = bg.split('|').map(rgba);
  const a = tint[3] ?? 1;
  const over = [0, 1, 2].map((i) => tint[i] * a + base[i] * (1 - a));
  const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const [hi, lo] = [lum(rgba(fg).slice(0, 3)), lum(over)].sort((x, y) => y - x);
  const ratio = (hi + 0.05) / (lo + 0.05);
  assert.ok(ratio >= 4.5, `contrast ${ratio.toFixed(2)}`);
  await page.close();
});
