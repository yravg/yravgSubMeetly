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

/* --------------------------------------------------------------------------
 * Sisi helper (native/server.py). test/native-device-probe.py mengimpor
 * server.py dengan faster_whisper/ctranslate2 palsu, jadi cabang CPU/CUDA
 * bisa diuji di mesin mana pun tanpa GPU dan tanpa memuat model sungguhan.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PY = existsSync('native/.venv/bin/python') ? 'native/.venv/bin/python' : 'python3';

function probe(env = {}, pref = null) {
  const dir = mkdtempSync(join(tmpdir(), 'lts-device-'));
  const prefPath = join(dir, 'device.json');
  if (pref) writeFileSync(prefPath, JSON.stringify({ device: pref }));
  const r = spawnSync(PY, ['test/native-device-probe.py'], {
    encoding: 'utf8',
    env: { ...process.env, DEVICE_PREF_PATH: prefPath, DEVICE: '', ...env },
  });
  assert.equal(r.status, 0, `probe gagal: ${r.stderr}`);
  const line = r.stdout.trim().split('\n').pop();
  return { ...JSON.parse(line), stderr: r.stderr, prefPath };
}

test('deteksi otomatis: tanpa CUDA → cpu/int8, dengan CUDA → cuda/float16', () => {
  const cpu = probe({ CUDA_COUNT: '0' });
  assert.equal(cpu.fw_device, 'cpu');
  assert.equal(cpu.fw_compute, 'int8');
  assert.equal(cpu.loaded_device, 'cpu', 'model harus dimuat pada device yang dipilih');
  assert.equal(cpu.state.cuda_available, false);

  const gpu = probe({ CUDA_COUNT: '1' });
  assert.equal(gpu.fw_device, 'cuda');
  assert.equal(gpu.fw_compute, 'float16');
  assert.equal(gpu.state.cuda_available, true);
});

test('preferensi tersimpan menang atas deteksi otomatis', () => {
  const r = probe({ CUDA_COUNT: '1' }, 'cpu');
  assert.equal(r.fw_device, 'cpu', 'pilihan pengguna tidak boleh ditimpa GPU yang terdeteksi');
  assert.equal(r.state.device, 'cpu');
  assert.equal(r.state.active, 'cpu');
  assert.equal(r.state.applied, true);
});

test('env DEVICE menang atas preferensi tersimpan', () => {
  const r = probe({ CUDA_COUNT: '1', DEVICE: 'cuda' }, 'cpu');
  assert.equal(r.fw_device, 'cuda');
});

test('preferensi cuda tanpa GPU jatuh ke cpu dan memperingatkan, bukan crash', () => {
  const r = probe({ CUDA_COUNT: '0' }, 'cuda');
  assert.equal(r.fw_device, 'cpu');
  assert.match(r.stderr, /cuda.*tidak tersedia/i);
  // Preferensi tetap 'cuda' tapi belum berlaku — UI perlu tahu bedanya.
  assert.equal(r.state.device, 'cuda');
  assert.equal(r.state.applied, false);
});

test('pref rusak / nilai asing diabaikan, tidak melempar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lts-device-'));
  const p = join(dir, 'device.json');
  writeFileSync(p, 'bukan json {{{');
  const r = probe({ CUDA_COUNT: '0', DEVICE_PREF_PATH: p });
  assert.equal(r.state.device, 'auto');
  assert.equal(r.fw_device, 'cpu');
});

test('simpan preferensi: roundtrip ke disk, tolak device tak dikenal', () => {
  const ok = probe({ CUDA_COUNT: '0', PROBE_SAVE: 'cuda' });
  assert.equal(ok.saved, 'cuda');
  assert.equal(ok.reloaded, 'cuda', 'harus terbaca lagi setelah restart');
  assert.equal(JSON.parse(readFileSync(ok.prefPath, 'utf8')).device, 'cuda');
  // Baru berlaku setelah restart — helper masih jalan di cpu.
  assert.equal(ok.state_after.active, 'cpu');
  assert.equal(ok.state_after.applied, false);

  const bad = probe({ CUDA_COUNT: '0', PROBE_SAVE: 'quantum' });
  assert.match(bad.save_error, /auto, cpu, or cuda/);
  assert.equal(bad.saved, undefined, 'nilai asing tidak boleh tertulis');
});
