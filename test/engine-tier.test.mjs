/**
 * Mesin inferensi berjenjang — deteksi kemampuan, pemilihan mesin, failover.
 *   node --test test/engine-tier.test.mjs
 *
 * Tiga modul murni yang menentukan mesin mana yang dipakai dan ke mana jatuh
 * bila gagal. Sampai tes ini ada, perilakunya hanya "kelihatan benar" di UI.
 * `engine-session` menyentuh jaringan lewat nativeHealth(); fetch distub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDeviceCapabilities,
  tierFromScore,
  pickEngineFromTier,
  withEngineFallback,
} from '../src/lib/engine-tier.js';
import { detectCapabilities, tierFromCapabilities, selectEngine } from '../src/lib/device-tier.js';

/* ---------------- engine-tier ---------------- */

test('skor kemampuan: WebGPU dan helper menaikkan tier; mesin lemah tetap low', () => {
  const weak = detectDeviceCapabilities({ webgpu: false, ramGb: 4, cores: 2, nativeOnline: false });
  assert.equal(weak.score, 2 * 5 + 4 * 3);
  assert.equal(tierFromScore(weak.score), 'low');

  const gpu = detectDeviceCapabilities({ webgpu: true, ramGb: 8, cores: 4, nativeOnline: false });
  assert.equal(tierFromScore(gpu.score), 'medium');

  const full = detectDeviceCapabilities({ webgpu: true, ramGb: 16, cores: 8, nativeOnline: true });
  assert.equal(tierFromScore(full.score), 'high');
  assert.equal(full.nativeOnline, true);
});

test('tierFromScore: batas 50 dan 90 inklusif', () => {
  assert.equal(tierFromScore(49), 'low');
  assert.equal(tierFromScore(50), 'medium');
  assert.equal(tierFromScore(89), 'medium');
  assert.equal(tierFromScore(90), 'high');
});

test('pickEngineFromTier: helper hidup + preferNative → native; tanpa helper → WebGPU bila tier cukup, else WASM', () => {
  const caps = detectDeviceCapabilities({ webgpu: true, ramGb: 16, cores: 8, nativeOnline: true });
  assert.equal(pickEngineFromTier(caps).engine, 'native');
  assert.equal(pickEngineFromTier(caps, { preferNative: false }).device, 'webgpu', 'mode manual: pengguna memaksa browser');

  const noHelper = detectDeviceCapabilities({ webgpu: true, ramGb: 8, cores: 4, nativeOnline: false });
  assert.equal(pickEngineFromTier(noHelper).device, 'webgpu');

  // WebGPU menyumbang 40 poin: 2 GB/1 core + GPU sudah 'medium' (51) dan memang
  // dipilihkan WebGPU. Baru di bawah 50 (1 GB/1 core) WebGPU dilewati demi WASM.
  const gpuMedium = detectDeviceCapabilities({ webgpu: true, ramGb: 2, cores: 1, nativeOnline: false });
  assert.equal(tierFromScore(gpuMedium.score), 'medium');
  assert.equal(pickEngineFromTier(gpuMedium).device, 'webgpu');
  const weakGpu = detectDeviceCapabilities({ webgpu: true, ramGb: 1, cores: 1, nativeOnline: false });
  assert.equal(tierFromScore(weakGpu.score), 'low');
  assert.equal(pickEngineFromTier(weakGpu).device, 'wasm', 'tier low memakai WASM walau GPU ada');

  // Tugas ikut diteruskan supaya sesi tahu ini transcribe atau translate.
  assert.equal(pickEngineFromTier(caps, { task: 'translate' }).task, 'translate');
});

test('withEngineFallback: sukses → tetap; gagal → cadangan WASM dengan alasan, dan mesin utama disimpan', () => {
  const primary = pickEngineFromTier(detectDeviceCapabilities({ nativeOnline: true }));
  const ok = withEngineFallback(primary, true);
  assert.equal(ok.active, primary);
  assert.equal(ok.fallback, null);

  const fb = withEngineFallback(primary, false);
  assert.equal(fb.active.engine, 'browser');
  assert.equal(fb.active.device, 'wasm');
  assert.equal(fb.fallback, primary, 'mesin utama harus tersimpan agar bisa dicoba lagi');
  assert.match(fb.reason, /cadangan/i);
  assert.equal(fb.active.task, primary.task);
});

/* ---------------- device-tier ---------------- */

test('device-tier: navigator diinjeksi, bukan dibaca global; prefer-list per tier', () => {
  const cap = detectCapabilities({ deviceMemory: 16, hardwareConcurrency: 8 });
  assert.deepEqual([cap.ramGb, cap.cores], [16, 8]);

  const high = tierFromCapabilities({ ramGb: 16, cores: 8, webgpu: true });
  assert.equal(high.tier, 'high');
  assert.deepEqual(high.prefer, ['webgpu', 'native', 'wasm']);

  const mid = tierFromCapabilities({ ramGb: 8, cores: 4, webgpu: false });
  assert.equal(mid.tier, 'mid');
  assert.equal(mid.prefer[0], 'wasm');

  const low = tierFromCapabilities({ ramGb: 2, cores: 2, webgpu: false });
  assert.equal(low.tier, 'low');
  assert.equal(low.prefer[0], 'native', 'mesin lemah lebih baik menyerahkan kerja ke helper');
});

test('selectEngine mengikuti prefer-list dan melewati native bila helper mati', () => {
  const low = tierFromCapabilities({ ramGb: 2, cores: 2, webgpu: false });
  assert.equal(selectEngine({ tierInfo: low, helperOnline: true }).engine, 'native');
  assert.equal(selectEngine({ tierInfo: low, helperOnline: false }).device, 'wasm');

  const high = tierFromCapabilities({ ramGb: 16, cores: 8, webgpu: true });
  assert.equal(selectEngine({ tierInfo: high, helperOnline: true }).device, 'webgpu', 'tier high memilih WebGPU sebelum helper');
  assert.equal(selectEngine({ tierInfo: null, helperOnline: false }).reason, 'wasm fallback');
});

/* ---------------- engine-session (failover) ---------------- */

function stubHealth(reply) {
  globalThis.fetch = async () => {
    if (reply === 'down') throw new TypeError('connect ECONNREFUSED');
    return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
}

test('engine-session: helper hidup → native aktif; runWithFallback beralih ke browser saat native melempar', async () => {
  stubHealth({ ok: true, engine: 'mlx-whisper', model: 'large-v3-turbo' });
  const { createEngineSession } = await import('../src/lib/engine-session.js');
  const s = await createEngineSession({ nativeUrl: 'http://127.0.0.1:17865', webgpu: true, ramGb: 16, cores: 8 });
  assert.equal(s.active.engine, 'native');
  assert.equal(s.reason, null);

  let browserCalls = 0;
  const out = await s.runWithFallback(
    async () => { throw new Error('helper 500'); },
    async () => { browserCalls += 1; return { text: 'dari browser' }; },
  );
  assert.equal(browserCalls, 1);
  assert.equal(out.engine, 'browser');
  assert.match(out.reason, /cadangan|helper 500/);

  // Setelah jatuh, sesi tetap di browser — tidak memanggil native lagi.
  let nativeCalls = 0;
  const again = await s.runWithFallback(
    async () => { nativeCalls += 1; return { text: 'native' }; },
    async () => ({ text: 'browser lagi' }),
  );
  assert.equal(nativeCalls, 0, 'mesin yang sudah gagal tidak boleh dicoba lagi diam-diam di tengah sesi');
  assert.equal(again.engine, 'browser');
});

test('engine-session: helper mati sejak awal → langsung browser dengan alasan, tanpa melempar', async () => {
  stubHealth('down');
  const { createEngineSession } = await import('../src/lib/engine-session.js');
  const s = await createEngineSession({ nativeUrl: 'http://127.0.0.1:17865', webgpu: false, ramGb: 8, cores: 4 });
  assert.equal(s.primary.engine, 'browser', 'tanpa helper, mesin utama pun sudah browser');
  assert.equal(s.active.engine, 'browser');
  const out = await s.runWithFallback(
    async () => { throw new Error('tidak boleh dipanggil'); },
    async () => ({ text: 'ok' }),
  );
  assert.equal(out.text, 'ok');
  assert.equal(out.engine, 'browser');
});

test('engine-session.annotate membungkus cue dengan label mesin aktif', async () => {
  stubHealth({ ok: true });
  const { createEngineSession } = await import('../src/lib/engine-session.js');
  const s = await createEngineSession({ nativeUrl: 'http://127.0.0.1:17865', ramGb: 16, cores: 8 });
  const payload = s.annotate([{ t0: 0, t1: 1, src: 'a', tgt: 'b' }], 'Rapat');
  assert.equal(payload.engine, 'native');
  assert.equal(payload.title, 'Rapat');
  assert.equal(payload.cues.length, 1);
});
