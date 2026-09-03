/**
 * Generator notulen lokal (heuristic stub + hook LLM nanti).
 * Ringkasan / keputusan / tindak lanjut dari baris transkrip.
 */

import { createMeetingNote, createActionItem } from './notes-schema.js';

/**
 * @param {{ text: string, speaker?: string, t0?: number, t1?: number }[]} lines
 * @param {{ title?: string, source?: string, locale?: string }} [meta]
 */
export function generateNotesFromTranscript(lines, meta = {}) {
  const texts = (lines || []).map((l) => String(l.text || l.src || l.tgt || '').trim()).filter(Boolean);
  const blob = texts.join(' ');

  const summary =
    texts.length === 0
      ? 'Transkrip kosong — tidak ada ringkasan.'
      : texts.length <= 2
        ? texts.join(' ')
        : `${texts[0]} … ${texts[texts.length - 1]} (${texts.length} segmen).`;

  const decisions = [];
  const decisionRe = /\b(keputusan|diputuskan|we (decided|agree)|decision)\b[:\s-]*(.+)/gi;
  let m;
  while ((m = decisionRe.exec(blob)) && decisions.length < 8) {
    const bit = (m[2] || '').trim().slice(0, 200);
    if (bit) decisions.push(bit);
  }

  const actions = [];
  const actionRe =
    /\b(action|tindak lanjut|todo|assign(?:ed)?(?: to)?)\b[:\s-]*([^.!?\n]{8,160})/gi;
  while ((m = actionRe.exec(blob)) && actions.length < 12) {
    const bit = (m[2] || '').trim();
    if (bit) actions.push(createActionItem({ text: bit, owner: null, due: null }));
  }

  // Fallback: speaker-based follow-ups if no explicit markers
  if (!actions.length) {
    for (const l of lines || []) {
      if (/\b(will|akan|kerjakan|siapkan)\b/i.test(l.text || '') && actions.length < 5) {
        actions.push(
          createActionItem({
            text: String(l.text).slice(0, 160),
            owner: l.speaker || null,
            due: null,
          }),
        );
      }
    }
  }

  return createMeetingNote({
    title: meta.title || 'Notulen sesi',
    source: meta.source || 'transcript',
    status: 'ready',
    summary,
    decisions,
    actions,
    transcriptPreview: texts.slice(0, 6).join('\n'),
    savedLocally: false,
    locale: meta.locale || 'id',
  });
}

export function extractDecisions(text) {
  return generateNotesFromTranscript([{ text }]).decisions;
}

export function extractActions(text) {
  return generateNotesFromTranscript([{ text }]).actions;
}
