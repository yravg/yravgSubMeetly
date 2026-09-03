// Model download / cache management. Runs inside the AI worker; the caller
// (offscreen main thread) persists the downloaded-state via the background.
import { ASR_MODELS, MT_PAIRS } from './registry.js';
import { loadASR, disposeASR } from './asr.js';
import { preloadPair, releasePair } from './opus.js';
import { makeProgressAggregator } from './hf-env.js';

// modelKey is either an ASR key ('whisper-base') or an MT pair key ('ja-en').
export function resolveModel(modelKey) {
  if (ASR_MODELS[modelKey]) return { type: 'asr', id: ASR_MODELS[modelKey].id };
  if (MT_PAIRS[modelKey]) return { type: 'mt', id: MT_PAIRS[modelKey].id };
  return null;
}

// Resolves to {bytes} once all files are in the Cache API.
export async function downloadModel(modelKey, devicePref, emitProgress) {
  const spec = resolveModel(modelKey);
  if (!spec) throw new Error(`Unknown model: ${modelKey}`);
  const agg = makeProgressAggregator((p) => emitProgress({ key: modelKey, ...p }));
  let totalBytes = 0;
  const cb = (ev) => {
    if (ev?.status === 'done' && ev.total) totalBytes += ev.total;
    agg(ev);
  };
  if (spec.type === 'asr') {
    await loadASR(modelKey, devicePref, cb, { engine: 'browser' });
  } else {
    await preloadPair(MT_PAIRS[modelKey], cb);
    // free memory; weights stay in the Cache API
    await releasePair(MT_PAIRS[modelKey]);
  }
  emitProgress({ key: modelKey, pct: 100, done: true });
  return { bytes: totalBytes };
}

// Remove a model's files from the Cache API.
export async function deleteModel(modelKey) {
  const spec = resolveModel(modelKey);
  if (!spec) return;
  const needle = `/${spec.id}/`;
  const names = await caches.keys();
  for (const name of names) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (req.url.includes(needle)) await cache.delete(req);
    }
  }
  if (spec.type === 'asr') await disposeASR();
}
