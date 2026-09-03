/**
 * Protokol JSON bridge ekstensi ↔ Native Helper (kontrak lokal).
 * Transport: Chrome Native Messaging (`com.localtranssub.helper`)
 * atau HTTP loopback `http://127.0.0.1:17865`.
 */

export const NATIVE_MESSAGING_HOST = 'com.localtranssub.helper';
export const LOCAL_HELPER_ORIGIN = 'http://127.0.0.1:17865';

/** Pesan native messaging yang didukung host. */
export const NATIVE_HOST_ACTIONS = Object.freeze([
  'start',
  'stop',
  'restart',
  'status',
  'ensure_lab',
]);

/**
 * Bentuk respons tipikal /health
 * @typedef {{ ok: boolean, engine: string, model?: string, translate?: boolean, ffmpeg?: boolean }} HealthResponse
 */

/**
 * Segmen transkrip / terjemahan seragam untuk UI & ekspor.
 * @typedef {{ t0: number, t1: number, src?: string, tgt?: string, text?: string, engine?: string }} TranscriptCue
 */

export function assertLocalUrl(url) {
  const u = String(url || LOCAL_HELPER_ORIGIN);
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error('URL helper tidak valid');
  }
  const host = parsed.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Helper hanya boleh alamat lokal (127.0.0.1 / localhost)');
  }
  return u.replace(/\/+$/, '');
}

export function wrapTranscriptPayload(cues, { engine = 'browser', title = '' } = {}) {
  return {
    version: 1,
    title,
    engine,
    cues: (cues || []).map((c) => ({
      t0: Number(c.t0) || 0,
      t1: Number(c.t1) || 0,
      src: c.src || c.source || '',
      tgt: c.tgt || c.translation || c.text || '',
    })),
  };
}
