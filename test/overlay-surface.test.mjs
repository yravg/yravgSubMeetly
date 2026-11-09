/**
 * Caption overlay (src/content.js + src/overlay.css) in test/overlay-lab.html.
 *   node --test test/overlay-surface.test.mjs      (needs `npm run build`)
 * Guards: captionSurface contract (overlay | island | both, default overlay,
 * live via storage.onChanged), tokens reaching the shadow root, translation
 * colour, no overflow at 390 px, the locked panel can be unlocked.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8812;
const URL_ = `http://127.0.0.1:${PORT}/overlay-lab.html`;
let server;
let browser;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  assert.ok(existsSync('dist/content.js'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT), PYTHONIOENCODING: 'utf-8' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(URL_)).ok) break;
    } catch {
      /* retry */
    }
    await wait(120);
  }
  browser = await puppeteer.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function open({ width = 1200, scheme = 'dark', storage = {} } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 800 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  for (let i = 0; i < 4; i++) {
    try {
      await page.goto(URL_, { waitUntil: 'load' });
      break;
    } catch {
      await wait(400);
    }
  }
  if (Object.keys(storage).length) await page.evaluate((s) => chrome.storage.local.set(s), storage);
  return page;
}

const emit = (page, type, data) =>
  page.evaluate((t, d) => window.__mockEmit({ target: 'content', type: t, data: d }), type, data);
const hasHost = (page) => page.evaluate(() => !!document.getElementById('__local_transsub_overlay'));
const startSession = async (page) => {
  await emit(page, 'session', { active: true, config: { taskMode: 'translate', dualLine: true }, cacheCues: [] });
  await wait(300);
};
const cue = (page, t0, text) =>
  emit(page, 'subtitle', { final: true, t0, t1: t0 + 2, source: text, translation: text + ' EN', rawSource: text, rawTranslation: text + ' EN' });
// Runs `body` (a function source taking the shadow root) inside the page.
const inShadow = (page, body) =>
  page.evaluate((src) => new Function('sr', `return (${src})(sr)`)(document.getElementById('__local_transsub_overlay')?.shadowRoot), body.toString());

test('captionSurface: missing value shows the overlay', async () => {
  const page = await open();
  await startSession(page);
  assert.equal(await hasHost(page), true);
  await page.close();
});

test('captionSurface: island hides it fully and live; both brings it back with its lines', async () => {
  const page = await open();
  await startSession(page);
  await cue(page, 1, 'Kept line');
  await wait(200);
  await page.evaluate(() => chrome.storage.local.set({ captionSurface: 'island' }));
  await wait(200);
  assert.equal(await hasHost(page), false, 'island must remove the overlay, not just minimise it');
  await cue(page, 3, 'While hidden');
  await emit(page, 'pipeline-status', { state: 'listening' }); // must not throw while hidden
  await page.evaluate(() => chrome.storage.local.set({ captionSurface: 'both' }));
  await wait(300);
  assert.equal(await hasHost(page), true);
  const lines = await inShadow(page, (sr) => [...sr.querySelectorAll('.block.tgt')].map((e) => e.textContent));
  assert.deepEqual(lines, ['Kept line EN', 'While hidden EN']);
  await page.close();
});

test('captionSurface: island stored before the session means no overlay is ever built', async () => {
  const page = await open({ storage: { captionSurface: 'island' } });
  await startSession(page);
  await cue(page, 1, 'x');
  assert.equal(await hasHost(page), false);
  await page.close();
});

test('tokens reach the shadow root; translation colour follows settings (dark and light)', async () => {
  for (const [scheme, rgb] of [
    ['dark', 'rgb(92, 199, 221)'],
    ['light', 'rgb(11, 110, 131)'],
  ]) {
    const page = await open({ scheme, storage: { settings: { translationColour: 'teal', dualLine: true } } });
    await startSession(page);
    await cue(page, 1, 'Hello');
    await wait(250);
    const r = await inShadow(page, (sr) => {
      const panel = sr.querySelector('.panel');
      return {
        radius: getComputedStyle(panel).getPropertyValue('--radius-xl').trim(),
        tgt: getComputedStyle(sr.querySelector('.block.tgt')).color,
        bg: getComputedStyle(panel).backgroundColor,
      };
    });
    assert.equal(r.radius, '16px', 'tokens.css not applied inside the shadow root');
    assert.equal(r.tgt, rgb, `${scheme} translation colour`);
    assert.notEqual(r.bg, 'rgba(0, 0, 0, 0)');
    await page.close();
  }
});

test('390 px: toolbar and options fit inside the panel', async () => {
  const page = await open({ width: 390 });
  await startSession(page);
  const r = await inShadow(page, (sr) => {
    const p = sr.querySelector('.panel').getBoundingClientRect();
    const out = [...sr.querySelectorAll('.toolbar *, .options *')].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width && (b.right > p.right + 1 || b.left < p.left - 1);
    }).length;
    return { left: p.left, right: p.right, out };
  });
  assert.ok(r.left >= 0 && r.right <= 390);
  assert.equal(r.out, 0, 'a control sticks out of the panel');
  await page.close();
});

test('force-translate menu, lock and compact stay usable', async () => {
  const page = await open();
  await startSession(page);
  await cue(page, 1, 'a');
  const r = await inShadow(page, (sr) => {
    const out = {};
    const btn = sr.querySelector('.force-btn');
    btn.click();
    out.expanded = btn.getAttribute('aria-expanded');
    out.items = sr.querySelectorAll('.force-menu [role=menuitem]').length;
    document.body.click();
    const lock = [...sr.querySelectorAll('button')].find((b) => b.title.startsWith('Lock'));
    lock.click();
    out.locked = sr.querySelector('.panel').classList.contains('locked');
    out.pressed = lock.getAttribute('aria-pressed');
    lock.click(); // the unlock button must still respond while locked
    out.unlocked = !sr.querySelector('.panel').classList.contains('locked');
    return out;
  });
  assert.equal(r.expanded, 'true');
  assert.equal(r.items, 3);
  assert.equal(r.locked, true);
  assert.equal(r.pressed, 'true');
  assert.equal(r.unlocked, true);
  await page.close();
});
