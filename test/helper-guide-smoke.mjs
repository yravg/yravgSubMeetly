// DOM smoke test for src/helper-guide.js — the install guide & troubleshooting
// panel inside the Native Helper card. Renders against jsdom, no browser.
//   node --test test/helper-guide-smoke.mjs
// Skips cleanly when jsdom is not installed (`npm install --no-save jsdom`).
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function withDom() {
  let JSDOM;
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch {
    return null;
  }
  const dom = new JSDOM('<!doctype html><body><div id="m"></div></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', clipboard: { writeText: async (t) => { global.__copied = t; } } },
  });
  const mod = await import('../src/helper-guide.js');
  return { window, mod, root: window.document.getElementById('m') };
}

const HEALTH_LINUX = { ok: true, engine: 'faster-whisper', model: 'large-v3-turbo', ffmpeg: true, translate: false, device: 'cuda', platform: 'linux', features: { transcribe_file_jobs: true } };

test('renders offline Windows scenario: fail banner, 8 checks, flagged tips open, OS tab follows UA', async (t) => {
  const env = await withDom();
  if (!env) return t.skip('jsdom not installed');
  const { root, mod } = env;
  const r = mod.renderHelperGuide(root, { lang: 'id', health: null, engine: 'native', nativeHostSupported: true, hostInstalled: false });
  assert.equal(r.os, 'windows');
  assert.ok(root.querySelector('.hg-banner.fail'));
  assert.equal(root.querySelectorAll('.hg-check').length, 8);
  assert.equal(root.querySelector('.hg-check[data-check="reachable"]').classList.contains('fail'), true);
  assert.equal(root.querySelector('.hg-os-tabs [data-os="windows"]').classList.contains('active'), true);
  // install steps for Windows reference install-host.bat, and a copy button exists per command
  const cmds = [...root.querySelectorAll('.hg-install .hg-cmd code')].map((c) => c.textContent);
  assert.ok(cmds.some((c) => c.includes('install-host.bat')));
  assert.equal(root.querySelectorAll('.hg-install .hg-copy').length >= cmds.length - 3, true);
  // fail-flagged troubleshooting entries are expanded by default, others collapsed
  const flagged = [...root.querySelectorAll('.hg-ts-item.flagged-fail')];
  assert.ok(flagged.length >= 2);
  assert.ok(flagged.every((d) => d.open));
  assert.equal(root.querySelector('.hg-ts-item[data-ts="model-download"]').open, false);
  // Indonesian strings
  assert.match(root.querySelector('.hg-title').textContent, /Panduan pemasangan/);
});

test('OS tab switch + open-state survive a redraw; healthy Linux shows ok banner', async (t) => {
  const env = await withDom();
  if (!env) return t.skip('jsdom not installed');
  const { root, mod } = env;
  let health = null;
  const redraw = mod.mountHelperGuide(root, () => ({ lang: 'en', health, engine: 'native', nativeHostSupported: true, hostInstalled: true }));
  root.querySelector('.hg-os-tabs [data-os="linux"]').click();
  assert.equal(root.querySelector('.helper-guide').dataset.os, 'linux');
  assert.ok([...root.querySelectorAll('.hg-install code')].some((c) => c.textContent.includes('install-host-linux.sh')));
  // open the manifest details, then redraw with the helper online
  const det = root.querySelector('details[data-key="manifest"]');
  det.open = true;
  det.dispatchEvent(new env.window.Event('toggle'));
  health = HEALTH_LINUX;
  redraw();
  assert.equal(root.querySelector('.helper-guide').dataset.os, 'linux', 'tab kept');
  assert.equal(root.querySelector('details[data-key="manifest"]').open, true, 'details kept');
  assert.ok(root.querySelector('.hg-banner.ok'));
  assert.equal(root.querySelectorAll('.hg-check.fail').length, 0);
  assert.equal(root.querySelector('.hg-check[data-check="translate"]').classList.contains('warn'), true);
  assert.equal(root.querySelectorAll('.hg-ts-item.flagged-fail').length, 0);
});

test('copy button writes the command to the clipboard and shows feedback', async (t) => {
  const env = await withDom();
  if (!env) return t.skip('jsdom not installed');
  const { root, mod } = env;
  mod.renderHelperGuide(root, { lang: 'en', health: null, engine: 'native', nativeHostSupported: true });
  const btn = root.querySelector('.hg-install .hg-copy');
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(global.__copied, btn.getAttribute('data-copy'));
  assert.equal(btn.textContent, 'Copied');
});

test('browser engine + helper offline shows the neutral note, and Re-check calls onRecheck', async (t) => {
  const env = await withDom();
  if (!env) return t.skip('jsdom not installed');
  const { root, mod } = env;
  let called = 0;
  mod.renderHelperGuide(root, { lang: 'en', health: null, engine: 'browser', nativeHostSupported: false, onRecheck: () => called++ });
  assert.ok(root.querySelector('.hg-banner.idle'));
  root.querySelector('#hg-recheck').click();
  assert.equal(called, 1);
});
