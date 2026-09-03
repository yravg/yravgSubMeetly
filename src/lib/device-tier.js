/**
 * Deteksi kemampuan perangkat → tier mesin (Fase 3).
 */

export function detectCapabilities(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const mem = nav.deviceMemory || 4;
  const cores = nav.hardwareConcurrency || 4;
  const webgpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  return { ramGb: mem, cores, webgpu };
}

export function tierFromCapabilities(cap) {
  const score = (cap.cores || 4) * 5 + (cap.ramGb || 4) * 4 + (cap.webgpu ? 40 : 0);
  if (score >= 80) return { tier: 'high', prefer: ['webgpu', 'native', 'wasm'], score };
  if (score >= 45) return { tier: 'mid', prefer: ['wasm', 'native'], score };
  return { tier: 'low', prefer: ['native', 'wasm'], score };
}

export function selectEngine({ tierInfo, helperOnline, srcLang, tgtLang, task }) {
  const prefer = tierInfo?.prefer || ['wasm'];
  for (const p of prefer) {
    if (p === 'native' && helperOnline) {
      return { engine: 'native', device: 'auto', reason: 'helper online' };
    }
    if (p === 'webgpu') {
      return { engine: 'browser', device: 'webgpu', reason: 'tier high + webgpu' };
    }
    if (p === 'wasm') {
      return { engine: 'browser', device: 'wasm', reason: 'wasm fallback' };
    }
  }
  return { engine: 'browser', device: 'wasm', reason: 'default' };
}
