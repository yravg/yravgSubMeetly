// QA sample helpers (CC0 clips under test/samples). Available in lab / app.html;
// silent no-op when the catalog is not reachable (packaged extension).

import { MT_PAIRS } from './registry.js';

let catalogCache = null;
let catalogTried = false;

/** Base URL for sample files when running under the Translation Lab server. */
export function samplesBaseUrl() {
  try {
    const { protocol, hostname, port, pathname } = location;
    if (protocol === 'http:' || protocol === 'https:') {
      if (pathname.startsWith('/app/')) return null; // engine-hosted app window: no lab samples there
      if (port === '8799' || hostname === '127.0.0.1' || hostname === 'localhost') {
        return '/samples/';
      }
      if (pathname.includes('/test/') || pathname.endsWith('/app.html')) {
        return '/samples/';
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

let catalogPromise = null;
// One shared promise: a second caller while the first fetch is in flight must wait for it,
// not read the still-empty cache (that made an early Start fall back to a missing /speech.wav).
export function loadSampleCatalog() {
  if (!catalogPromise) catalogPromise = fetchCatalog();
  return catalogPromise;
}

async function fetchCatalog() {
  catalogTried = true;
  const base = samplesBaseUrl();
  if (!base) {
    catalogCache = null;
    return null;
  }
  try {
    const r = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
    if (!r.ok) {
      catalogCache = null;
      return null;
    }
    const data = await r.json();
    catalogCache = {
      base,
      samples: Array.isArray(data.samples) ? data.samples : [],
    };
    return catalogCache;
  } catch {
    catalogCache = null;
    return null;
  }
}

export function samplesForPair(catalog, pairKey) {
  if (!catalog?.samples?.length || !pairKey) return [];
  const [src, tgt] = pairKey.split('-');
  const exact = catalog.samples.filter((s) => s.src === src && s.tgt === tgt);
  if (exact.length) return exact;
  return catalog.samples.filter((s) => s.src === src);
}

export function firstSampleForPair(catalog, pairKey) {
  return samplesForPair(catalog, pairKey)[0] || null;
}

/** Unique MT source languages (includes en from en→* pairs). */
export function mtSourceLangs() {
  const set = new Set();
  for (const key of Object.keys(MT_PAIRS)) {
    const [src] = key.split('-');
    if (src) set.add(src);
  }
  return [...set];
}

export async function fetchSampleFile(catalog, sample) {
  if (!catalog || !sample?.file) throw new Error('Sample unavailable');
  const url = `${catalog.base}${sample.file}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Sample fetch failed (${r.status}): ${sample.file}`);
  const blob = await r.blob();
  const name = sample.file.split('/').pop() || `${sample.id}.mp3`;
  return new File([blob], name, { type: blob.type || 'audio/mpeg' });
}
