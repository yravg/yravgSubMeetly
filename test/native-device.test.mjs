/**
 * Helper compute-device client (src/lib/native.js): GET/POST /engine/device,
 * 404 on old helpers → { supported: false }.
 *   node --test test/native-device.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const URL_ = 'http://127.0.0.1:17865';

function fakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    return handler(String(url), init);
  };
  return calls;
}
const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test('nativeGetDevice: new helper → supported + fields; old helper 404 → supported:false', async () => {
  fakeFetch((u) => json(200, { device: 'auto', active: 'cuda', compute: 'float16', cuda_available: true }));
  const { nativeGetDevice } = await import('../src/lib/native.js');
  const r = await nativeGetDevice(URL_);
  assert.deepEqual(r, { supported: true, device: 'auto', active: 'cuda', compute: 'float16', cuda_available: true });
  fakeFetch(() => json(404, { error: 'not found' }));
  assert.deepEqual(await nativeGetDevice(URL_), { supported: false });
});

test('nativeSetDevice: validates option, POSTs JSON, 404 → manual restart hint', async () => {
  const calls = fakeFetch((u, init) => json(200, { ok: true, device: JSON.parse(init.body).device, restart_required: true }));
  const { nativeSetDevice, HELPER_DEVICE_OPTIONS } = await import('../src/lib/native.js');
  assert.deepEqual(HELPER_DEVICE_OPTIONS, ['auto', 'cpu', 'cuda']);
  const r = await nativeSetDevice(URL_, 'cpu');
  assert.equal(r.supported, true);
  assert.equal(r.device, 'cpu');
  assert.equal(r.restart_required, true);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/engine\/device$/);
  assert.deepEqual(calls[0].body, { device: 'cpu' });
  await assert.rejects(nativeSetDevice(URL_, 'metal'), /device must be one of/);
  fakeFetch(() => json(404, { error: 'not found' }));
  assert.deepEqual(await nativeSetDevice(URL_, 'cuda'), { supported: false, device: 'cuda', restart_required: true });
});

test('helper status card shows a device pill from /health.device', async (t) => {
  let JSDOM;
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch {
    return t.skip('jsdom not installed');
  }
  const dom = new JSDOM('<!doctype html><body><div id="m"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Blob = dom.window.Blob;
  global.URL = dom.window.URL;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Windows NT 10.0' } });
  const { renderHelperStatusCard } = await import('../src/helper-status.js');
  const root = document.getElementById('m');
  const base = { online: true, engine: 'native', task: 'transcribe', mode: 'offline', lang: 'en', largeFile: null };
  renderHelperStatusCard(root, { ...base, health: { engine: 'faster-whisper', model: 'large-v3-turbo', device: 'cuda', compute: 'float16' } });
  assert.match(root.querySelector('#helper-device-pill').textContent, /GPU · CUDA · float16/);
  renderHelperStatusCard(root, { ...base, health: { engine: 'faster-whisper', model: 'small', device: 'cpu', compute: 'int8' } });
  assert.match(root.querySelector('#helper-device-pill').textContent, /^CPU · int8$/);
  assert.ok(root.querySelector('#helper-device-pill').classList.contains('idle'));
  renderHelperStatusCard(root, { ...base, os: 'macos', health: { engine: 'mlx-whisper', model: 'x', device: 'apple-silicon' } });
  assert.match(root.querySelector('#helper-device-pill').textContent, /Apple Silicon · MLX/);
});
