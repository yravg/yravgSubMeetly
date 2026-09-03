/**
 * Deteksi kemampuan perangkat + tier mesin ASR/terjemahan lokal.
 * Digunakan UI Settings dan pemilih mesin (frontend + kontrak backend).
 */

export function detectDeviceCapabilities({
  webgpu = typeof navigator !== 'undefined' && !!navigator.gpu,
  ramGb = 8,
  cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
  nativeOnline = false,
} = {}) {
  let score = cores * 5 + ramGb * 3;
  if (webgpu) score += 40;
  if (nativeOnline) score += 25;
  return { webgpu: !!webgpu, ramGb, cores, nativeOnline: !!nativeOnline, score };
}

export function tierFromScore(score) {
  if (score >= 90) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

/**
 * Pilih mesin aktif dari tier + preferensi bahasa/tugas.
 * @returns {{ engine: 'native'|'browser', device: string, label: string, tier: string }}
 */
export function pickEngineFromTier(caps, { preferNative = true, task = 'transcribe' } = {}) {
  const tier = tierFromScore(caps.score);
  if (preferNative && caps.nativeOnline) {
    return {
      engine: 'native',
      device: 'helper',
      label: 'Native helper',
      tier,
      task,
    };
  }
  if (caps.webgpu && tier !== 'low') {
    return { engine: 'browser', device: 'webgpu', label: 'Browser WebGPU', tier, task };
  }
  return { engine: 'browser', device: 'wasm', label: 'Browser WASM', tier, task };
}

export function withEngineFallback(primary, ok) {
  if (ok) return { active: primary, fallback: null, reason: null };
  const fallback = {
    engine: 'browser',
    device: 'wasm',
    label: 'Browser WASM (cadangan)',
    tier: primary.tier || 'low',
    task: primary.task,
  };
  return {
    active: fallback,
    fallback: primary,
    reason: 'Mesin utama gagal — beralih ke cadangan browser',
  };
}
