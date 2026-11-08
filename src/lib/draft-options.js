/**
 * Opsi draf untuk "End & draft" (board T03): tiga draf dari baris transkrip yang
 * sama, Diff terhadap register hari ini, dan penulisan lewat addItem/editItem.
 *
 * Semuanya lokal: tiga gaya memakai generateNotesFromTranscript yang sama
 * (heuristik, tanpa jaringan, tanpa model). Modul ini murni — tidak menyentuh
 * DOM maupun penyimpanan; pemanggil yang menyimpan hasilnya.
 *
 *  A Short      keputusan dan tindak lanjut lebih dulu, dibatasi enam butir
 *  B Full       semua butir terdeteksi, urut waktu
 *  C Bilingual  A dengan baris "sumber / terjemahan" dari pasangan bahasa sesi
 */
import { generateNotesFromTranscript } from './notes-generate.js';
import { addItem, editItem, RegisterError } from './notes-actions.js';
import { createRevision } from './notes-schema.js';

const SHORT_MAX = 6;
const TYPE_ORDER = ['decision', 'action', 'risk', 'question'];
/** Sama dengan ambang "mirip" di Diff: di bawahnya dianggap butir baru. */
const SIMILAR = 0.6;
const SEP = ' / ';

const typeRank = (t) => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? TYPE_ORDER.length : i; };
const byType = (a, b) => typeRank(a.type) - typeRank(b.type) || a.src.t0 - b.src.t0;

const VARIANTS = [
  { key: 'a', name: 'Short', sub: 'decisions first' },
  { key: 'b', name: 'Full', sub: 'every item, in time order' },
  { key: 'c', name: 'Bilingual', sub: 'source + translation' },
];

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function metaLine(items, extra = '') {
  const c = (t) => items.filter((i) => i.type === t).length;
  const parts = [['decision', 'decision'], ['action', 'action'], ['risk', 'risk'], ['question', 'question']]
    .map(([t, w]) => [c(t), w]).filter(([n]) => n).map(([n, w]) => plural(n, w));
  return `${plural(items.length, 'item')}${parts.length ? ` · ${parts.join(', ')}` : ''}${extra}`;
}

const toDraftItem = (it, i, key) => ({
  id: `${key}${i + 1}`,
  type: it.type,
  text: Object.values(it.text || {})[0] || '',
  owner: it.owner || null,
  confidence: it.confidence,
  src: it.src,
});

/** Pembatas gaya dari catatan "None of these": hanya aturan lokal yang benar-benar ada. */
function readHint(hint) {
  const h = String(hint || '').toLowerCase();
  const applied = [];
  if (/short|brief|fewer/.test(h)) applied.push('shorter');
  if (/owner/.test(h)) applied.push('owners first');
  return { text: String(hint || '').trim(), applied, shorter: applied.includes('shorter'), owners: applied.includes('owners first') };
}

function shape(items, hint) {
  let out = items;
  if (hint?.owners) out = [...out].sort((a, b) => (b.owner ? 1 : 0) - (a.owner ? 1 : 0));
  return out;
}

/**
 * @param {object[]} lines  {t0,t1,speaker,source|text,translation?}
 * @param {{ locale?: string, title?: string, pair?: {src:string,tgt:string}|null, hint?: string }} [meta]
 * @param {{ generate?: Function, only?: 'a'|'b'|'c' }} [opts]
 */
export function buildDraftVariants(lines, meta = {}, opts = {}) {
  const generate = opts.generate || generateNotesFromTranscript;
  const rows = (Array.isArray(lines) ? lines : []).filter((l) => String(l?.source ?? l?.text ?? '').trim());
  if (!rows.length) return { empty: true, drafts: [], suggested: null, hint: null };
  const locale = meta.locale || 'en';
  const hint = meta.hint ? readHint(meta.hint) : null;
  const gen = (ls) => generate(ls.map((l) => ({ ...l, text: l.source ?? l.text })), { title: meta.title, locale, source: 'draft-options' });

  const build = (v) => {
    const base = { ...v, status: 'ready', items: [], meta: '' };
    try {
      if (v.key === 'c') {
        if (!meta.pair) return { ...base, status: 'need', need: 'pair' };
        const tr = new Map(rows.filter((l) => String(l.translation || '').trim()).map((l) => [Number(l.t0) || 0, String(l.translation).trim()]));
        if (!tr.size) return { ...base, status: 'need', need: 'translation' };
        const items = gen(rows).items.map((it, i) => toDraftItem(it, i, 'c'))
          .filter((it) => tr.has(it.src.t0))
          .map((it) => ({ ...it, text: `${it.text}${SEP}${tr.get(it.src.t0)}` }));
        const kept = shape(items.sort(byType), hint).slice(0, hint?.shorter ? 4 : SHORT_MAX);
        return { ...base, items: kept, meta: metaLine(kept, ` · ${meta.pair.src} + ${meta.pair.tgt} lines`) };
      }
      const all = gen(rows).items.map((it, i) => toDraftItem(it, i, v.key));
      const items = v.key === 'a'
        ? shape([...all].sort(byType), hint).slice(0, hint?.shorter ? 4 : SHORT_MAX)
        : shape(all, hint);
      return { ...base, items, meta: metaLine(items) };
    } catch (e) {
      return { ...base, status: 'error', error: String(e?.message || e) };
    }
  };

  const drafts = VARIANTS.filter((v) => !opts.only || v.key === opts.only).map(build);
  return { empty: false, drafts, suggested: opts.only ? null : suggest(drafts), hint };
}

/** Pilihan yang disarankan: A bila ia memuat setiap keputusan dan tindak lanjut, kalau tidak B. */
export function suggest(drafts) {
  const a = drafts.find((d) => d.key === 'a' && d.status === 'ready');
  const b = drafts.find((d) => d.key === 'b' && d.status === 'ready');
  if (!a && !b) return null;
  const core = (d) => d.items.filter((i) => i.type === 'decision' || i.type === 'action').length;
  if (a && (!b || core(a) >= core(b))) {
    return { key: 'a', reason: 'Covers every decision and action in the fewest lines.' };
  }
  const missing = core(b) - core(a);
  return { key: 'b', reason: `Keeps all ${plural(core(b), 'decision and action')}; Short drops ${missing}.` };
}

/* ------------------------------------------------------------------ Diff */

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));
function jaccard(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n += 1;
  return n / (A.size + B.size - n);
}

/** Beda per kata (LCS): [{t:'same'|'del'|'ins', s}] — spasi ikut kata di depannya. */
export function wordDiff(from, to) {
  const A = String(from).match(/\S+\s*/g) || [];
  const B = String(to).match(/\S+\s*/g) || [];
  const key = (w) => w.trim();
  const n = A.length; const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = key(A[i]) === key(B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (t, s) => { const last = out[out.length - 1]; if (last && last.t === t) last.s += s; else out.push({ t, s }); };
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (key(A[i]) === key(B[j])) { push('same', B[j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { push('del', A[i]); i++; }
    else { push('ins', B[j]); j++; }
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('ins', B[j++]);
  return out;
}

const textsOf = (it) => Object.values(it.text || {}).filter(Boolean);

/**
 * Draf terhadap isi rapat sekarang.
 * @param {object} meeting
 * @param {{ items: object[] }} draft
 * @param {Set<string>|null} [include]  id butir yang ikut; null = semua
 * @returns {{ changes: object[], counts: {add:number,change:number,dup:number}, locked: boolean }}
 */
export function diffDraft(meeting, draft, include = null) {
  const existing = meeting.items || [];
  const changes = [];
  const counts = { add: 0, change: 0, dup: 0 };
  for (const it of draft.items) {
    if (include && !include.has(it.id)) continue;
    const parts = [it.text, ...it.text.split(SEP)].map(norm);
    const dup = existing.find((e) => textsOf(e).some((t) => parts.includes(norm(t))));
    if (dup) {
      counts.dup += 1;
      changes.push({ id: it.id, kind: 'dup', type: it.type, text: it.text, ref: dup.ref });
      continue;
    }
    let best = null;
    for (const e of existing) {
      if (e.type !== it.type) continue;
      for (const t of textsOf(e)) {
        const s = jaccard(t, it.text);
        if (s >= SIMILAR && (!best || s > best.s)) best = { s, ref: e.ref, from: t };
      }
    }
    if (best) {
      counts.change += 1;
      changes.push({ id: it.id, kind: 'change', type: it.type, text: it.text, ref: best.ref, from: best.from, parts: wordDiff(best.from, it.text), item: it });
    } else {
      counts.add += 1;
      changes.push({ id: it.id, kind: 'add', type: it.type, text: it.text, item: it });
    }
  }
  return { changes, counts, locked: !!meeting.issuedAt };
}

/**
 * Terapkan hasil Diff. decisions[id] = 'accept' | 'reject'; yang belum diputuskan
 * hanya diterapkan bila `undecided: 'accept'` ("Use picked draft"). Duplikat
 * tidak pernah ditulis, hanya dihitung. Rapat terbit beku → RegisterError('issued').
 * @returns {{ meeting: object, added: number, edited: number, skipped: number, rejected: number }}
 */
export function applyChanges(meeting, changes, decisions = {}, { note = '', by = 'local', undecided = 'skip' } = {}) {
  if (meeting.issuedAt) {
    throw new RegisterError('issued', `${meeting.id} sudah diterbitkan ${meeting.issuedAt}. Buat amandemen, jangan ubah catatannya.`);
  }
  let m = meeting;
  const out = { added: 0, edited: 0, skipped: 0, rejected: 0 };
  for (const c of changes) {
    if (c.kind === 'dup') { out.skipped += 1; continue; }
    const d = decisions[c.id] || (undecided === 'accept' ? 'accept' : null);
    if (d === 'reject') { out.rejected += 1; continue; }
    if (d !== 'accept') continue;
    if (c.kind === 'change') {
      m = editItem(m, c.ref, { text: { [m.locale || 'en']: c.text } }, { by });
      out.edited += 1;
      continue;
    }
    m = addItem(m, {
      type: c.item.type, text: c.text, owner: c.item.owner, confidence: c.item.confidence, review: 'ai', src: c.item.src,
    }, { by });
    if (note) m.items[m.items.length - 1].history.push(createRevision({ by, field: 'draft-note', to: note }));
    out.added += 1;
  }
  return { meeting: m, ...out };
}
