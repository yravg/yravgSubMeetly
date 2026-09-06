/**
 * Protokol JSON bridge ekstensi ↔ Native Helper (kontrak lokal).
 * Transport: Chrome Native Messaging (`com.localtranssub.helper`)
 * atau HTTP loopback `http://127.0.0.1:17865`.
 */

export const NATIVE_MESSAGING_HOST = 'com.localtranssub.helper';
export const LOCAL_HELPER_ORIGIN = 'http://127.0.0.1:17865';

/** Pesan native messaging yang didukung host. */
export const NATIVE_HOST_ACTIONS = Object.freeze([
  'ping',
  'start',
  'stop',
  'restart',
  'status',
  'ensure_lab',
]);

/**
 * Keadaan sambungan Native Messaging. Dibedakan karena perbaikannya berbeda:
 * host belum dipasang butuh installer, `forbidden` butuh id ekstensi ditambah
 * ke allowed_origins, `crashed` menunjuk ke Python yang tidak bisa dijalankan.
 */
export const NATIVE_CONNECTION_STATES = Object.freeze([
  'connected',
  'unsupported',
  'not-installed',
  'forbidden',
  'crashed',
  'timeout',
  'error',
]);

/**
 * Petakan pesan galat chrome.runtime.lastError ke satu keadaan.
 * Teksnya milik Chrome dan tidak stabil antar versi, jadi pencocokan sengaja
 * longgar dan selalu punya jalan keluar 'error'.
 *
 * @param {unknown} err  Error, string, atau apa pun
 * @returns {typeof NATIVE_CONNECTION_STATES[number]}
 */
export function classifyNativeHostError(err) {
  const m = String(err?.message ?? err ?? '');
  if (!m) return 'error';
  // "Access to the specified native messaging host is forbidden."
  if (/forbidden|not allowed|allowed_origins/i.test(m)) return 'forbidden';
  // "Specified native messaging host not found." / Windows: "is not registered"
  if (/not found|not registered|no such (native )?host|tidak ditemukan/i.test(m)) return 'not-installed';
  // "Native host has exited." / "Failed to start native messaging host."
  if (/has exited|failed to start|exited early|terminated/i.test(m)) return 'crashed';
  if (/timed out|timeout/i.test(m)) return 'timeout';
  if (/not available|unavailable|unsupported/i.test(m)) return 'unsupported';
  return 'error';
}

/**
 * Apakah keadaan ini membuktikan host Native Messaging terpasang?
 * `crashed` tetap true: manifestnya ketemu dan Chrome sempat menjalankannya —
 * yang salah adalah proses hostnya, bukan pemasangan bridge-nya.
 * null = belum bisa disimpulkan (browser tanpa dukungan, atau belum dicoba).
 *
 * @returns {boolean|null}
 */
export function hostInstalledFromState(state) {
  if (state === 'connected' || state === 'crashed' || state === 'forbidden') return true;
  if (state === 'not-installed') return false;
  return null;
}

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
