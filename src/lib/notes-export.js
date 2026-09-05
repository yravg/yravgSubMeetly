/**
 * Ekspor register v2 → Markdown / CSV.
 *
 * Catatan lama (assertMeetingNote atas { summary, decisions:string[], actions[] })
 * dihapus di v2 — notes-store.js menaikkan versi data v1 sebelum sampai di sini,
 * jadi UI selalu memegang sebuah Meeting bertipe. XLSX/ICS/DOCX menyusul di 2.1+
 * lewat native helper (lihat docs/NOTES-V2-SPEC.md §5.4).
 *
 * v2 register export — Markdown / CSV. The v1 note serializer
 * (assertMeetingNote over { summary, decisions:string[], actions[] }) is gone in
 * v2 — notes-store.js upgrades v1 data before it reaches this layer, so callers
 * always hold a typed Meeting. XLSX/ICS/DOCX land in 2.1+ via the native helper
 * (see docs/NOTES-V2-SPEC.md §5.4).
 */
import { pickText, meetingStats } from './notes-schema.js';

const DOC_SECTIONS = [
  ['decision', 'docDecisions', 'Decisions'],
  ['action', 'docActions', 'Action register'],
  ['question', 'docQuestions', 'Open questions'],
  ['risk', 'docRisks', 'Risks'],
  ['metric', 'docMetrics', 'Progress'],
  ['info', 'docNotes', 'Discussion notes'],
];

function label(T, key, fallback) {
  if (!T) return fallback;
  const v = T(key);
  return v === key ? fallback : v;
}

/**
 * Notulen lengkap sebagai Markdown. `T` opsional (dari makeT(lang)) untuk judul
 * seksi terlokalisasi; tanpanya jatuh ke label bahasa Inggris.
 * @param {import('./notes-schema.js').Meeting} meeting
 * @param {string} [lang]
 * @param {(key:string, ...args:any[])=>string} [T]
 */
export function serializeMeetingMarkdown(meeting, lang = meeting.locale || 'en', T = null) {
  const stats = meetingStats(meeting);
  const lines = [
    `# ${meeting.title}`,
    '',
    `_${meeting.id}_ · ${meeting.date}${meeting.start ? ` · ${meeting.start}${meeting.end ? `–${meeting.end}` : ''}${meeting.tz ? ` ${meeting.tz}` : ''}` : ''}${meeting.chair ? ` · ${label(T, 'chair', 'Chair')}: ${meeting.chair}` : ''}`,
    meeting.issuedAt ? `_${label(T, 'issued', 'Issued')}: ${meeting.issuedAt}_` : '_Draft — not yet issued_',
    '',
    `${stats.total} items · ${stats.actionsOpen}/${stats.actionsTotal} actions open · ${stats.decisions} decisions · ${stats.questionsOpen} open questions · agenda ${stats.agendaPct}% covered`,
    '',
  ];

  if (meeting.agenda?.length) {
    lines.push(`## Agenda`, '');
    for (const a of meeting.agenda) {
      lines.push(`- [${a.covered ? 'x' : ' '}] ${a.ref} — ${pickText(a.title, lang)}`);
    }
    lines.push('');
  }

  for (const [type, key, fallback] of DOC_SECTIONS) {
    const rows = meeting.items.filter((i) => i.type === type);
    if (!rows.length) continue;
    lines.push(`## ${label(T, key, fallback)}`, '');
    for (const it of rows) {
      const meta = [];
      if (it.owner) meta.push(it.owner);
      if (it.due) meta.push(`due ${it.due}`);
      if (it.status && it.status !== 'open') meta.push(it.status);
      if (it.type === 'metric' && it.metric) {
        meta.push(`${it.metric.value}${it.metric.unit}${it.metric.baseline != null ? ` (baseline ${it.metric.baseline}${it.metric.unit})` : ''}`);
      }
      const suffix = meta.length ? ` — ${meta.join(' · ')}` : '';
      const flag = it.review === 'ai' ? ' ‡' : '';
      lines.push(`- **${it.ref}** ${pickText(it.text, lang)}${suffix}${flag}`);
    }
    lines.push('');
  }

  const unreviewed = meeting.items.filter((i) => i.review === 'ai');
  lines.push(
    '---',
    unreviewed.length
      ? `‡ ${unreviewed.length} item(s) still AI-drafted, not yet reviewed by a human.`
      : 'Every item has been reviewed by a human.',
    `Drafted on-device${meeting.engine ? ` — ${meeting.engine.asr}` : ''}. Nothing left this machine.`,
    '',
  );
  return lines.join('\n');
}

/** Notulen sebagai TXT polos — judul, ringkasan, keputusan, tindak lanjut. */
export function serializeMeetingTxt(meeting, lang = meeting.locale || 'en') {
  const stats = meetingStats(meeting);
  const lines = [
    meeting.title,
    `${meeting.id} · ${meeting.date}`,
    meeting.issuedAt ? `Issued: ${meeting.issuedAt}` : 'Draft — not yet issued',
    '',
    `${stats.total} items · ${stats.actionsOpen}/${stats.actionsTotal} actions open · ${stats.decisions} decisions`,
    '',
  ];
  const summary = meeting.summary?.[lang] || meeting.summary?.en || Object.values(meeting.summary || {})[0] || '';
  if (summary) lines.push('Summary', summary, '');
  for (const [type, title] of [['decision', 'Decisions'], ['action', 'Action items']]) {
    const rows = meeting.items.filter((i) => i.type === type);
    if (!rows.length) continue;
    lines.push(title);
    for (const it of rows) {
      const meta = [];
      if (it.owner) meta.push(it.owner);
      if (it.due) meta.push(`due ${it.due}`);
      if (it.status && it.status !== 'open') meta.push(it.status);
      lines.push(`- [${it.ref}] ${pickText(it.text, lang)}${meta.length ? ` — ${meta.join(' · ')}` : ''}`);
    }
    lines.push('');
  }
  lines.push('Drafted on-device. Nothing left this machine.', '');
  return lines.join('\n');
}

/** Register sebagai CSV datar — satu baris per butir. */
export function serializeMeetingCsv(meeting, lang = meeting.locale || 'en') {
  const cols = ['ref', 'type', 'topic', 'text', 'owner', 'due', 'status', 'review', 'confidence'];
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = meeting.items.map((it) => [
    it.ref, it.type, it.topic, pickText(it.text, lang), it.owner || '', it.due || '', it.status, it.review, it.confidence,
  ]);
  return [cols.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}
