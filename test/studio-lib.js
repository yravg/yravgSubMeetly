/**
 * Utilitas + data tiruan untuk halaman Transkripsi Berkas / Studio (Fase 3).
 */

export function wrapLines(text, maxChars = 42) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function scoreDevice({ webgpu = false, ramGb = 8, cores = 4 } = {}) {
  let score = cores * 5 + ramGb * 3;
  if (webgpu) score += 40;
  return score;
}

export function pickEngineMode(score) {
  if (score >= 70) return { engine: 'browser', device: 'webgpu', label: 'Browser WebGPU' };
  if (score >= 40) return { engine: 'browser', device: 'wasm', label: 'Browser WASM' };
  return { engine: 'native', device: 'cpu', label: 'Native helper (cadangan)' };
}

export function simulateFallback(primary, ok) {
  if (ok) return { active: primary, fallback: null };
  return {
    active: { engine: 'native', device: 'cpu', label: 'Native helper (cadangan)' },
    fallback: primary,
    reason: 'Mesin utama gagal dimuat — beralih ke cadangan',
  };
}

export const STUB_SEGMENTS = [
  { id: 's1', t0: 0, t1: 3.1, src: 'Welcome to the offline transcription studio.', tgt: 'Selamat datang di studio transkripsi offline.' },
  { id: 's2', t0: 3.1, t1: 7.4, src: 'All processing stays on this device.', tgt: 'Semua pemrosesan tetap di perangkat ini.' },
  { id: 's3', t0: 7.4, t1: 12.0, src: 'Drop a file to begin, or preview the mock session.', tgt: 'Jatuhkan berkas untuk mulai, atau pratinjau sesi tiruan.' },
  { id: 's4', t0: 12.0, t1: 16.8, src: 'Export to SRT, WebVTT, or plain text when ready.', tgt: 'Ekspor ke SRT, WebVTT, atau teks polos bila siap.' },
];

export const STUB_FILE = {
  name: 'meeting-demo.wav',
  size: 4_850_000,
  type: 'audio/wav',
  durationSec: 16.8,
};

export function formatTimecode(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}
