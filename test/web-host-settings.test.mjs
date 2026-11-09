/**
 * Settings in the app window: engine models first; browser models, mirror and engine dev controls behind Advanced.
 *   node --test test/web-host-settings.test.mjs
 *
 * A stub engine serves dist/ under /app/ and a one-model catalog (never the real engine).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const catalog = [{ kind: 'asr', id: 'openai/whisper-base', label: 'Whisper base', approxBytes: 290_000_000, selected: true, downloaded: true, bytes: 290_000_000, partialBytes: 0, pulling: false, bytesDone: 0, bytesTotal: 0, pct: 0, pullError: null }];
let server; let origin; let browser;

before(async () => {
  assert.ok(existsSync(join(DIST, 'sidepanel.html')), 'dist/ not built: run `npm run build`');
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname === '/health') return json({ ok: true, device: 'cpu', models: [] });
    if (url.pathname === '/models') return json({ models: [], catalog });
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

async function open(stab) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 520, height: 900 });
  await page.evaluateOnNewDocument((engine) => localStorage.setItem('settings', JSON.stringify({ nativeUrl: engine, uiLang: 'en' })), origin);
  const go = () => page.goto(`${origin}/app/sidepanel.html?view=settings&stab=${stab}`, { waitUntil: 'networkidle0' });
  await go().catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; return go(); }); // shortcut: first navigation of a fresh Chrome sometimes aborts, cause not found
  await page.waitForSelector('#native-models .m-item');
  if (process.env.SETTINGS_SHOT) { await new Promise((r) => setTimeout(r, 1200)); await page.screenshot({ path: process.env.SETTINGS_SHOT + '-' + stab + '.png' }); }
  return page;
}
const shown = (page, sel) => page.$eval(sel, (e) => e.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }));
const openAdvanced = (page, pane) => page.click(`.set-card[data-pane="${pane}"] > details.set-adv > summary`);

test('Models: engine models lead; browser models and the mirror wait behind Advanced', { timeout: 60_000 }, async () => {
  const page = await open('models');
  assert.equal(await page.$eval('.set-card[data-pane="models"] .set-card-head', (e) => e.nextElementSibling.id), 'native-models');
  assert.equal(await shown(page, '#native-models'), true);
  assert.equal(await shown(page, '#asr-models'), false);
  assert.equal(await shown(page, '#mirror-toggle'), false);
  await openAdvanced(page, 'models');
  assert.equal(await shown(page, '#asr-models'), true);
  assert.equal(await shown(page, '#mirror-toggle'), true);
  await page.close();
});

test('Engine: status stays; Start/Stop/Restart, address and browser device wait behind Advanced', { timeout: 60_000 }, async () => {
  const page = await open('engine');
  assert.equal(await shown(page, '#native-status'), true);
  for (const sel of ['#btn-native-restart', '#native-url', '#device-toggle', '#engine-toggle']) assert.equal(await shown(page, sel), false, sel);
  await openAdvanced(page, 'engine');
  for (const sel of ['#btn-native-restart', '#native-url', '#device-toggle', '#engine-toggle']) assert.equal(await shown(page, sel), true, sel);
  await page.close();
});

test('Search opens Advanced so a match is never hidden', { timeout: 60_000 }, async () => {
  const page = await open('engine');
  await page.type('#settings-search', 'inference device');
  assert.equal(await shown(page, '#device-toggle'), true);
  await page.close();
});
