/**
 * Pengelola sesi mesin ASR/terjemahan dengan fallback otomatis.
 */
import {
  detectDeviceCapabilities,
  pickEngineFromTier,
  withEngineFallback,
} from './engine-tier.js';
import { nativeHealth } from './native.js';
import { wrapTranscriptPayload } from './native-protocol.js';

export async function createEngineSession({
  nativeUrl,
  preferNative = true,
  task = 'transcribe',
  webgpu,
  ramGb,
  cores,
} = {}) {
  const health = await nativeHealth(nativeUrl);
  const caps = detectDeviceCapabilities({
    webgpu,
    ramGb,
    cores,
    nativeOnline: !!health?.ok,
  });
  const primary = pickEngineFromTier(caps, { preferNative, task });
  let active = primary;
  let reason = null;

  if (primary.engine === 'native' && !health?.ok) {
    const fb = withEngineFallback(primary, false);
    active = fb.active;
    reason = fb.reason;
  }

  return {
    caps,
    primary,
    active,
    reason,
    health,
    engineLabel: active.label,
    /** Label mesin aktif untuk respons API / UI. */
    annotate(cues, title = '') {
      return wrapTranscriptPayload(cues, { engine: active.engine, title });
    },
    /** Coba native lagi; jika gagal, pakai browser. */
    async runWithFallback(nativeFn, browserFn) {
      if (active.engine === 'native') {
        try {
          const out = await nativeFn();
          return { ...out, engine: 'native', engineLabel: active.label };
        } catch (e) {
          const fb = withEngineFallback(active, false);
          active = fb.active;
          reason = fb.reason || String(e?.message || e);
        }
      }
      const out = await browserFn();
      return { ...out, engine: 'browser', engineLabel: active.label, reason };
    },
  };
}
