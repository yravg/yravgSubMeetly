/**
 * GLOSSARY — per-series term list applied to final captions and the minutes draft (add-in `glossary`).
 *
 * CONTRACT
 *  entry   = { term, heard: string[], translation }   term <= 80 chars; heard = "heard as" spellings;
 *            translation = fixed translation of the term ('' = none)
 *  applyGlossary(text, entries, 'source' | 'translation') -> { text, marks:[{from, to, at}] }
 *    One pass, longest spelling first, case-insensitive match on WORD boundaries (no boundary for
 *    Han/kana terms, which have no spaces). Replacement is the term ('source') or its fixed
 *    translation falling back to the term ('translation'). A match that already reads exactly as
 *    the replacement is left alone and not marked, so correct text never changes.
 *    `at` is the index of the replacement in the returned text.
 *  applyToLine({src, tgt}, entries)            -> { src, tgt, changes, marks:{src, tgt} }
 *  applyToMeeting(meeting, entries, {now})     -> { meeting, changes }   item text + summary, every
 *    language; each changed item gets one Revision by 'addin:glossary' so the register can show it.
 *    A language other than the meeting's own counts as a translation line.
 *  markedHtml(text, marks)                     -> escaped HTML with <mark class="gl-mark" title="heard form">
 *  parseCsv(text) / toCsv(entries)             header `term,heard_as,translation`; heard_as joined by "|".
 *  Pure: storage lives in addins-ui.js (chrome.storage.local `ysmGlossary` { [seriesId]: entries }).
 *
 * shortcut: a fixed translation replaces the term WHERE THE TERM STILL APPEARS in the translated line; if the
 * MT already rewrote the term into other words nothing is found, upgrade when the MT exposes alignment.
 */
import { createRevision } from './notes-schema.js';

export const GLOSSARY_MAX = 500;
const TERM_MAX = 80;
const TRANSLATION_MAX = 120;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORD = '[\\p{L}\\p{N}_]';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function applyGlossary(text, entries, mode = 'source') {
  const repl = new Map();
  for (const e of entries || []) {
    const to = mode === 'translation' && e.translation ? e.translation : e.term;
    for (const v of [e.term, ...(e.heard || [])]) if (v && !repl.has(v.toLowerCase())) repl.set(v.toLowerCase(), to);
  }
  if (!repl.size || !text) return { text: text ?? '', marks: [] };
  const alts = [...repl.keys()].sort((a, b) => b.length - a.length)
    .map((v) => (CJK.test(v) ? escRe(v) : `(?<!${WORD})${escRe(v)}(?!${WORD})`));
  const re = new RegExp(alts.join('|'), 'giu');
  let out = '';
  let last = 0;
  const marks = [];
  for (const m of text.matchAll(re)) {
    const to = repl.get(m[0].toLowerCase());
    out += text.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === to) {
      out += m[0];
      continue;
    }
    marks.push({ from: m[0], to, at: out.length });
    out += to;
  }
  return { text: out + text.slice(last), marks };
}

export function applyToLine(line, entries) {
  const s = applyGlossary(line.src, entries, 'source');
  const t = applyGlossary(line.tgt, entries, 'translation');
  return { src: s.text, tgt: t.text, changes: s.marks.length + t.marks.length, marks: { src: s.marks, tgt: t.marks } };
}

export function applyToMeeting(meeting, entries, { now = new Date() } = {}) {
  let changes = 0;
  const fixMap = (map) => {
    const next = {};
    let n = 0;
    for (const [lang, t] of Object.entries(map || {})) {
      const r = applyGlossary(t, entries, lang === meeting.locale ? 'source' : 'translation');
      next[lang] = r.text;
      n += r.marks.length;
    }
    return [next, n];
  };
  const [summary, sn] = fixMap(meeting.summary);
  changes += sn;
  const items = (meeting.items || []).map((it) => {
    const [text, n] = fixMap(it.text);
    if (!n) return it;
    changes += n;
    const rev = createRevision({ at: now.toISOString(), by: 'addin:glossary', field: 'text', from: it.text, to: text });
    return { ...it, text, history: [...(it.history || []), rev] };
  });
  return { meeting: changes ? { ...meeting, summary, items } : meeting, changes };
}

export function markedHtml(text, marks) {
  let out = '';
  let at = 0;
  for (const m of marks) {
    out += escHtml(text.slice(at, m.at)) + `<mark class="gl-mark" title="${escHtml(m.from)}">${escHtml(m.to)}</mark>`;
    at = m.at + m.to.length;
  }
  return out + escHtml(text.slice(at));
}

/* ---------- CSV ---------- */
function rows(text) {
  const out = [];
  let row = [];
  let cell = '';
  let q = false;
  let line = 1;
  let start = 1;
  let wasQuoted = false;
  const endRow = () => {
    row.push(cell);
    out.push({ line: start, cells: row, open: false });
    row = [];
    cell = '';
    wasQuoted = false;
    start = line + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else { if (ch === '\n') line++; cell += ch; }
    } else if (ch === '"' && !cell) { q = true; wasQuoted = true; } else if (ch === ',') { row.push(cell); cell = ''; wasQuoted = false; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (cell || row.length || wasQuoted) endRow(); else start = line + 1;
      line++;
      start = line;
    } else cell += ch;
  }
  if (q) out.push({ line: start, cells: [], open: true });
  else if (cell || row.length) endRow();
  return out;
}

export function parseCsv(text) {
  const byKey = new Map();
  const errors = [];
  let first = true;
  for (const r of rows(String(text || ''))) {
    const isFirst = first;
    first = false;
    if (r.open) { errors.push({ line: r.line, msg: 'unclosed quote' }); continue; }
    const [term = '', heard = '', translation = ''] = r.cells.map((c) => c.trim());
    if (isFirst && term.toLowerCase() === 'term') continue;
    if (!term) { errors.push({ line: r.line, msg: 'term is empty' }); continue; }
    if (term.length > TERM_MAX) { errors.push({ line: r.line, msg: `term longer than ${TERM_MAX} characters` }); continue; }
    if (translation.length > TRANSLATION_MAX) { errors.push({ line: r.line, msg: `translation longer than ${TRANSLATION_MAX} characters` }); continue; }
    const variants = heard.split('|').map((h) => h.trim()).filter(Boolean);
    if (variants.some((h) => h.length > TERM_MAX)) { errors.push({ line: r.line, msg: `heard-as longer than ${TERM_MAX} characters` }); continue; }
    if (byKey.size >= GLOSSARY_MAX && !byKey.has(term.toLowerCase())) { errors.push({ line: r.line, msg: `limit of ${GLOSSARY_MAX} terms reached; the rest were not imported` }); break; }
    byKey.set(term.toLowerCase(), { term, heard: variants, translation });
  }
  return { entries: [...byKey.values()], errors };
}

const csvCell = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function toCsv(entries) {
  return `${['term,heard_as,translation', ...entries.map((e) => [e.term, (e.heard || []).join('|'), e.translation || ''].map(csvCell).join(','))].join('\r\n')}\r\n`;
}
