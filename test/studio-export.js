/**
 * Generator format ekspor untuk studio (membungkus transcript-cache).
 */
import { formatSrt, formatVtt, formatTxt } from '../src/lib/transcript-cache.js';
import { wrapLines } from './studio-lib.js';

export function toCues(segments, { dual = false } = {}) {
  return (segments || []).map((s) => ({
    t0: s.t0,
    t1: s.t1,
    src: wrapLines(s.src).join('\n'),
    tgt: wrapLines(s.tgt || s.src).join('\n'),
  }));
}

export function generateSrt(segments, { dualLine = false, title = 'transcript' } = {}) {
  return formatSrt(toCues(segments), { dualLine, title });
}

export function generateVtt(segments, { dualLine = false, title = 'transcript' } = {}) {
  return formatVtt(toCues(segments), { dualLine, title });
}

export function generateTxt(segments, { dualLine = false, title = 'transcript' } = {}) {
  const cues = toCues(segments);
  if (!dualLine) {
    return formatTxt(
      cues.map((c) => ({ ...c, src: '', tgt: c.tgt || c.src })),
      { title },
    );
  }
  return formatTxt(cues, { title });
}
