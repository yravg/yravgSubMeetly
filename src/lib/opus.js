// Opus-MT (Xenova ONNX) translation pipelines. Runs inside the AI worker.
import { pipeline } from '@huggingface/transformers';

const mtCache = new Map(); // pair.id -> translation pipeline

export async function loadOpusMT(pair, progress_callback) {
  if (mtCache.has(pair.id)) return mtCache.get(pair.id);
  // Seq2seq MT on WebGPU crashes (transformers.js #1518) — always WASM. q8 is
  // both smaller and faster than q4 for Marian models.
  const p = await pipeline('translation', pair.id, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback,
  });
  mtCache.set(pair.id, p);
  return p;
}

export async function translateWith(pairId, text) {
  const mt = mtCache.get(pairId);
  if (!mt) throw new Error(`MT pair not loaded: ${pairId}`);
  if (!text) return '';
  const out = await mt(text);
  return (out?.[0]?.translation_text || '').trim();
}

export async function preloadPair(pair, progress_callback) {
  return loadOpusMT(pair, progress_callback);
}

// Dispose one cached pair (weights remain in the Cache API).
export async function releasePair(pair) {
  const p = mtCache.get(pair.id);
  if (!p) return;
  mtCache.delete(pair.id);
  try {
    await p.dispose();
  } catch {}
}
