/**
 * Protokol JSON sederhana untuk cuplikan transkrip/terjemahan (Fase 3).
 */

/**
 * @typedef {object} TranscriptCue
 * @property {number} t0
 * @property {number} t1
 * @property {string} src
 * @property {string} [tgt]
 * @property {string} [id]
 */

export function encodeTranscriptMessage(cues, meta = {}) {
  return {
    v: 1,
    type: 'transcript',
    at: new Date().toISOString(),
    meta,
    cues: (cues || []).map((c) => ({
      id: c.id || null,
      t0: c.t0,
      t1: c.t1,
      src: c.src || c.source || '',
      tgt: c.tgt || c.translation || '',
    })),
  };
}

export function decodeTranscriptMessage(msg) {
  if (!msg || msg.v !== 1 || msg.type !== 'transcript') {
    throw new Error('protocol mismatch');
  }
  return msg.cues || [];
}
