// Central transformers.js environment config. Works on the main thread and
// inside the AI worker (which has no chrome.runtime — pass baseUrl instead).
import { env } from '@huggingface/transformers';

export function configureHF(settings = {}, baseUrl = '') {
  const base = baseUrl || (typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('') : '/');
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true; // Cache API — models persist, fully offline after first download
  // MV3: ORT runtime files must be served from inside the extension package.
  env.backends.onnx.wasm.wasmPaths = base + 'ort/';
  // Extension pages are not crossOriginIsolated → no SharedArrayBuffer → single thread.
  env.backends.onnx.wasm.numThreads = 1;
  env.remoteHost = settings.mirror === 'hf-mirror' ? 'https://hf-mirror.com' : 'https://huggingface.co';
}

// Aggregates transformers.js progress_callback events (one per file) into a
// single throttled {loaded, total, pct, file} stream.
export function makeProgressAggregator(emit, throttleMs = 300) {
  const files = new Map();
  let last = 0;
  return (ev) => {
    if (!ev || !ev.file) return;
    if (ev.status === 'progress' || ev.status === 'done' || ev.status === 'initiate') {
      const f = files.get(ev.file) || { loaded: 0, total: 0 };
      if (ev.total) f.total = ev.total;
      if (ev.loaded != null) f.loaded = ev.loaded;
      if (ev.status === 'done' && f.total) f.loaded = f.total;
      files.set(ev.file, f);
    }
    const now = Date.now();
    if (now - last < throttleMs && ev.status !== 'done') return;
    last = now;
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    emit({ loaded, total, pct: total ? Math.min(100, (loaded / total) * 100) : 0, file: ev.file });
  };
}
