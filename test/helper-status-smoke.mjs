// DOM smoke for src/helper-status.js — the Native Helper card with a REAL
// large-file job (progress, stage pill, cancel wiring) instead of the stub.
//   node --test test/helper-status-smoke.mjs   (skips without jsdom)
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function withDom() {
  let JSDOM;
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch {
    return null;
  }
  const dom = new JSDOM('<!doctype html><body><div id="m"></div></body>', { url: 'http://localhost/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.Blob = window.Blob;
  global.URL = window.URL;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'X11; Linux x86_64' } });
  const mod = await import('../src/helper-status.js');
  return { window, mod, root: window.document.getElementById('m') };
}

const base = { online: true, health: { engine: 'faster-whisper', model: 'large-v3-turbo' }, engine: 'native', task: 'transcribe', mode: 'offline', lang: 'id' };

test('no job → idle text, no progress bar', async (t) => {
  const env = await withDom();
  if (!env) return t.skip('jsdom not installed');
  env.mod.renderHelperStatusCard(env.root, { ...base, largeFile: null });
  const block = env.root.querySelector('#helper-large-file');
  assert.equal(block.dataset.state, 'idle');
  assert.ok(!block.querySelector('.helper-progress-track'));
  assert.match(block.textContent, /Tidak ada job berkas besar/);
});

test('upload stage shows bytes, running pill and an enabled Cancel that calls onCancelLargeFile', async (t) => {
  const env = await withDom();
  if (!env) return t.skip('jsdom not installed');
  let cancelled = 0;
  env.mod.renderHelperStatusCard(env.root, {
    ...base,
    largeFile: { name: 'rapat.mkv', sizeBytes: 2.5 * 1024 ** 3, progress: 0.18, status: 'running', stage: 'upload', loaded: 1.1 * 1024 ** 3, total: 2.5 * 1024 ** 3, cancellable: true },
    onCancelLargeFile: () => cancelled++,
  });
  const block = env.root.querySelector('#helper-large-file');
  assert.equal(block.dataset.state, 'running');
  assert.equal(block.querySelector('.helper-progress-track').getAttribute('aria-valuenow'), '18');
  assert.equal(block.querySelector('.helper-progress-bar').style.width, '18%');
  assert.match(block.querySelector('#helper-lf-state').textContent, /Mengunggah ke helper/);
  assert.match(block.querySelector('#helper-lf-pct').textContent, /1\.1 GiB \/ 2\.5 GiB/);
  const btn = block.querySelector('#btn-helper-lf-cancel');
  assert.equal(btn.disabled, false);
  btn.click();
  assert.equal(cancelled, 1);
  assert.equal(btn.disabled, true);
});

test('transcribe stage (helper side) → indeterminate shimmer + elapsed; done/error/cancelled states disable Cancel', async (t) => {
  const env = await withDom();
  if (!env) return t.skip('jsdom not installed');
  const { root, mod } = env;
  mod.renderHelperStatusCard(root, { ...base, lang: 'en', largeFile: { name: 'a.mp4', sizeBytes: 3e9, progress: 0.61, status: 'running', stage: 'transcribe', elapsedS: 125, cancellable: true } });
  assert.ok(root.querySelector('.helper-progress-bar.indeterminate'));
  assert.match(root.querySelector('#helper-lf-pct').textContent, /2m 5s elapsed/);
  assert.match(root.querySelector('#helper-lf-state').textContent, /Transcribing on helper/);

  for (const [status, re] of [['done', /Done/], ['error', /Failed/], ['cancelled', /Cancelled/]]) {
    mod.renderHelperStatusCard(root, { ...base, lang: 'en', largeFile: { name: 'a.mp4', sizeBytes: 3e9, progress: status === 'done' ? 1 : 0.4, status, stage: status, error: status === 'error' ? 'ffmpeg missing' : '', cancellable: false } });
    assert.equal(root.querySelector('#helper-large-file').dataset.state, status);
    assert.match(root.querySelector('#helper-lf-state').textContent, re);
    assert.equal(root.querySelector('#btn-helper-lf-cancel').disabled, true);
    if (status === 'error') assert.match(root.querySelector('#helper-lf-pct').textContent, /ffmpeg missing/);
  }
});

test('preview without largeFile option keeps the stub (harness pages)', async (t) => {
  const env = await withDom();
  if (!env) return t.skip('jsdom not installed');
  env.mod.renderHelperStatusCard(env.root, { ...base, largeFile: undefined });
  assert.equal(env.root.querySelector('#helper-large-file').dataset.state, 'running');
  assert.match(env.root.textContent, /conference-long\.wav/);
});
