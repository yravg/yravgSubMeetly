/**
 * Helper page in the app window: status, model and Restart on top; install guide and diagnostics behind Troubleshooting.
 *   node --test test/web-host-helper.test.mjs
 *
 * A stub engine serves dist/ under /app/. /shutdown makes /health go dark for a moment, like the island's respawn.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
let server; let origin; let browser; let darkUntil = 0; let shutdowns = 0;

before(async () => {
  assert.ok(existsSync(join(DIST, 'sidepanel.html')), 'dist/ not built: run `npm run build`');
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (body, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname === '/health') return Date.now() < darkUntil ? req.socket.destroy() : json({ ok: true, device: 'cpu', engine: 'whisper', model: 'openai/whisper-base', models: [] });
    if (url.pathname === '/shutdown') { shutdowns += 1; darkUntil = Date.now() + 1500; return json({ ok: true }); }
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

const visible = (page, sel) => page.$eval(sel, (e) => e.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }));

test('Helper page: install steps hide behind Troubleshooting; Restart brings the engine back', { timeout: 90_000 }, async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 520, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((engine) => localStorage.setItem('settings', JSON.stringify({ nativeUrl: engine, uiLang: 'en' })), origin);
  const go = () => page.goto(`${origin}/app/sidepanel.html?view=helper`, { waitUntil: 'networkidle0' });
  await go().catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; return go(); }); // shortcut: first navigation of a fresh Chrome sometimes aborts, cause not found
  await page.waitForSelector('#btn-helper-restart');
  if (process.env.HELPER_SHOT) { await new Promise((r) => setTimeout(r, 1200)); await page.screenshot({ path: process.env.HELPER_SHOT + '-a.png' }); }

  assert.equal(await visible(page, '#helper-status-mount'), true);
  assert.equal(await page.$eval('.helper-steps-block', (e) => getComputedStyle(e).display), 'none', 'dev steps (native\run.bat, "choose Engine") are hidden');
  assert.ok(!/run\.bat/.test(await page.$eval('#view-helper', (e) => e.innerText)), 'no dev install text on the page');
  assert.equal(await page.$eval('#helper-troubleshoot', (e) => e.open), false, 'Troubleshooting starts closed');
  assert.equal(await visible(page, '#helper-guide-mount'), false);
  assert.equal(await page.$eval('#helper-troubleshoot > summary', (e) => e.textContent), 'Troubleshooting');
  await page.click('#helper-troubleshoot > summary');
  assert.equal(await visible(page, '#helper-guide-mount'), true, 'the guide is one click away');

  await page.click('#btn-helper-restart');
  await page.waitForFunction(() => document.querySelector('#btn-helper-restart')?.disabled, { timeout: 5000 });
  assert.equal(shutdowns, 1);
  await page.waitForFunction(() => { const b = document.querySelector('#btn-helper-restart'); return b && !b.disabled; }, { timeout: 30_000 });
  assert.deepEqual(errors, []);
  await page.close();
});

test('naming: the app window says Engine, never Helper, on its own pages', { timeout: 90_000 }, async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 520, height: 900 });
  await page.evaluateOnNewDocument((engine) => localStorage.setItem('settings', JSON.stringify({ nativeUrl: engine, uiLang: 'en' })), origin);
  const go = () => page.goto(`${origin}/app/sidepanel.html?view=helper`, { waitUntil: 'networkidle0' });
  await go().catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; return go(); });
  await page.waitForSelector('#btn-helper-restart');
  await page.click('#helper-troubleshoot > summary'); // the install guide is part of the page too
  // textContent: hidden pieces count, so a closed disclosure cannot hide the old word
  const text = await page.evaluate(() => ['#view-helper', '#bottom-nav', '.set-card[data-pane="engine"]', '#settings-modal .settings-tabs'].map((s) => document.querySelector(s)?.textContent || '').join('\n'));
  const labels = await page.evaluate(() => [...document.querySelectorAll('[aria-label],[title]')].map((e) => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).join('\n'));
  const hits = (text + '\n' + labels).match(/.{0,30}helper.{0,30}/gi) || [];
  // the engine's own address and the CLI file names keep their real spelling
  assert.deepEqual(hits.filter((h) => !/com\.yraveragesubmin\.helper|helper-/i.test(h)), []);
  assert.match(await page.$eval('#view-helper h2', (e) => e.textContent), /Engine/);
  await page.close();
});
