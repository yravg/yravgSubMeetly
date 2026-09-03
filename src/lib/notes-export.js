/**
 * Serialisasi ekspor notulen → TXT / Markdown.
 */
import { assertMeetingNote } from './notes-schema.js';

export function noteToMarkdown(raw) {
  const note = assertMeetingNote(raw);
  const lines = [
    `# ${note.title}`,
    '',
    `_Sumber: ${note.source}_ · _${note.generatedAt}_`,
    '',
    '## Ringkasan',
    note.summary || '_(kosong)_',
    '',
    '## Poin Keputusan',
    ...(note.decisions.length ? note.decisions.map((d) => `- ${d}`) : ['_(kosong)_']),
    '',
    '## Tindak Lanjut',
    ...(note.actions.length
      ? note.actions.map((a) => {
          const box = a.status === 'done' ? '[x]' : '[ ]';
          const due = a.due ? ` (due ${a.due})` : '';
          return `- ${box} **${a.owner || '?'}** — ${a.text}${due}`;
        })
      : ['_(kosong)_']),
    '',
  ];
  return lines.join('\n');
}

export function noteToTxt(raw) {
  const note = assertMeetingNote(raw);
  return [
    note.title,
    `Sumber: ${note.source}`,
    `Dibuat: ${note.generatedAt}`,
    '',
    'RINGKASAN',
    note.summary || '(kosong)',
    '',
    'POIN KEPUTUSAN',
    ...(note.decisions.length ? note.decisions.map((d) => `- ${d}`) : ['(kosong)']),
    '',
    'TINDAK LANJUT',
    ...(note.actions.length
      ? note.actions.map(
          (a) =>
            `- [${a.status}] ${a.owner || '?'} | ${a.text}${a.due ? ` | due ${a.due}` : ''}`,
        )
      : ['(kosong)']),
    '',
  ].join('\n');
}

export function serializeNote(note, format) {
  if (format === 'md' || format === 'markdown') return noteToMarkdown(note);
  return noteToTxt(note);
}
