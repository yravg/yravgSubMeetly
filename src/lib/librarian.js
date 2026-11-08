/**
 * LIBRARIAN — pure filing rules for Minutes > Projects (board T02).
 *
 * Contract
 *   suggestFiling(meeting, { meetings, lines? })
 *     -> { seriesId, projectType, title, confidence, unfiled, reasons[], why }
 *   - Signals: same chair, shared attendees, similar title (against OLDER meetings
 *     only, so the first meeting of a series never gets pulled into a later one),
 *     and project-type keywords in title, agenda and transcript lines.
 *   - confidence < UNFILED_BELOW  =>  unfiled: the series is left as it is.
 *   - Deterministic: same input, same output. No clock, no network, no storage.
 *   - A suggestion never changes a meeting. Only applySuggestion does, only for the
 *     fields named in its patch, and never on an issued meeting. The caller calls it
 *     only after the user pressed Accept (or Change).
 *   look history: [{meetingId, outcome:'accepted'|'changed'|'dismissed', suggestion, at}].
 *   A meeting with any look is not suggested again.
 */
import { PROJECT_TYPES, normalizeProjectType } from './notes-schema.js';
import { RegisterError } from './notes-actions.js';

export const UNFILED_BELOW = 0.6;
const LOOK_CAP = 200;

const TYPE_WORDS = {
  hse: /\b(k3|hse|safety|keselamatan|near[- ]?miss|toolbox|ppe|apd|evakuasi|drill|incident|insiden|heat stress)\b/gi,
  sprint: /\b(sprint|backlog|scrum|retro(?:spective)?|velocity|grooming)\b/gi,
  standup: /\b(stand[- ]?up|daily)\b/gi,
  'weekly-progress': /\b(progress|progres|s[- ]curve)\b/gi,
  'design-review': /\b(design review|drawings?|gambar kerja|p&id|hazop)\b/gi,
  'client-review': /\b(client|klien|owner review)\b/gi,
  sales: /\b(pipeline|deals?|prospect|quote|penawaran)\b/gi,
  finance: /\b(budget|anggaran|invoice|cashflow|forecast|capex|opex)\b/gi,
  legal: /\b(contract|kontrak|clause|klausul|legal|nda|compliance)\b/gi,
  training: /\b(training|pelatihan|workshop|onboarding)\b/gi,
  research: /\b(research|riset|experiment|hypothesis|hipotesis)\b/gi,
  healthcare: /\b(patient|pasien|clinic|klinik|nurse)\b/gi,
  education: /\b(lecture|kuliah|syllabus|kurikulum|student|mahasiswa|siswa)\b/gi,
};

const text = (m) => (v) => Object.values(v || {}).join(' ');
const hits = (re, s) => (String(s).match(re) || []).length;

function detectType(meeting, lines) {
  const title = meeting.title || '';
  const agenda = (meeting.agenda || []).map((a) => text(meeting)(a.title)).join(' ');
  const said = (lines || []).map((l) => l.source || l.text || l.src || '').join(' ');
  let best = 'general';
  let bestScore = 0;
  for (const t of PROJECT_TYPES) {
    const re = TYPE_WORDS[t];
    if (!re) continue;
    const score = 3 * hits(re, title) + 2 * hits(re, agenda) + hits(re, said);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

/** Title without the running number ("W02", "#3", "Week 12") so a series compares equal. */
const stem = (t) => String(t || '').toLowerCase().replace(/\b(w|wk|week|minggu|no\.?|#)\s*\d+\b/g, ' ').replace(/\d+/g, ' ').split(/[^\p{L}]+/u).filter((w) => w.length > 1);
function titleSimilarity(a, b) {
  const x = new Set(stem(a));
  const y = new Set(stem(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both);
}

const older = (a, b) => (a.date || '').localeCompare(b.date || '') < 0 || ((a.date || '') === (b.date || '') && (a.seq || 0) < (b.seq || 0));

function score(meeting, cand) {
  const reasons = [];
  let s = 0;
  if (meeting.chair && cand.chair && meeting.chair.trim().toLowerCase() === cand.chair.trim().toLowerCase()) {
    s += 0.3;
    reasons.push({ code: 'chair', name: cand.chair });
  }
  const names = new Set((cand.attendees || []).map((a) => a.name.toLowerCase()));
  const shared = (meeting.attendees || []).filter((a) => names.has(a.name.toLowerCase())).length;
  if (shared && names.size) {
    s += 0.35 * (shared / names.size);
    reasons.push({ code: 'attendees', shared, of: names.size });
  }
  if (titleSimilarity(meeting.title, cand.title) >= 0.6) {
    s += 0.35;
    reasons.push({ code: 'title' });
  }
  return { s, reasons };
}

export function suggestFiling(meeting, { meetings = [], lines = [] } = {}) {
  let best = null;
  for (const cand of meetings) {
    if (cand.id === meeting.id || !older(cand, meeting)) continue;
    const r = score(meeting, cand);
    if (!best || r.s > best.s) best = { ...r, cand };
  }
  const filed = best && best.s >= UNFILED_BELOW;
  const confidence = Math.round((best ? best.s : 0) * 100) / 100;
  const reasons = filed ? best.reasons.slice() : [];
  let projectType = filed && best.cand.projectType !== 'general' ? best.cand.projectType : detectType(meeting, lines);
  if (projectType === 'general' && meeting.projectType !== 'general') projectType = meeting.projectType;
  if (projectType !== 'general') reasons.push({ code: 'type', type: projectType });
  const out = {
    seriesId: filed ? best.cand.seriesId : meeting.seriesId,
    projectType,
    title: meeting.title,
    confidence,
    unfiled: !filed,
    reasons,
  };
  return { ...out, why: whyText(out, 'en') };
}

const WHY = {
  en: {
    chair: (r) => `same chair (${r.name})`,
    attendees: (r) => `${r.shared} of ${r.of} attendees`,
    title: () => 'title match',
    type: (r) => `looks like ${r.type}`,
    none: 'no matching series yet',
  },
  id: {
    chair: (r) => `ketua sama (${r.name})`,
    attendees: (r) => `${r.shared} dari ${r.of} peserta`,
    title: () => 'judul mirip',
    type: (r) => `tampak seperti ${r.type}`,
    none: 'belum ada seri yang cocok',
  },
};

export function whyText(suggestion, lang = 'en') {
  const w = WHY[lang] || WHY.en;
  const parts = (suggestion.reasons || []).map((r) => w[r.code]?.(r)).filter(Boolean);
  return parts.length ? parts.join('; ') : w.none;
}

/** Only the named fields change; seq follows the series being joined. */
export function applySuggestion(meeting, patch, { meetings = [] } = {}) {
  if (meeting.issuedAt) {
    throw new RegisterError('issued', `${meeting.id} sudah diterbitkan ${meeting.issuedAt}. Buat amandemen, jangan ubah catatannya.`);
  }
  const next = JSON.parse(JSON.stringify(meeting));
  if (patch.projectType != null) next.projectType = normalizeProjectType(patch.projectType);
  if (patch.title != null && String(patch.title).trim()) next.title = String(patch.title).trim();
  if (patch.seriesId != null && patch.seriesId !== next.seriesId) {
    const seqs = meetings.filter((m) => m.seriesId === patch.seriesId && m.id !== meeting.id).map((m) => m.seq || 0);
    next.seriesId = String(patch.seriesId);
    next.seq = (seqs.length ? Math.max(...seqs) : 0) + 1;
  }
  return next;
}

export function recordLook(looks, { meetingId, suggestion, outcome, at }) {
  return [...looks, { meetingId, outcome, at, suggestion: { seriesId: suggestion.seriesId, projectType: suggestion.projectType, title: suggestion.title, why: suggestion.why } }].slice(-LOOK_CAP);
}

export function latestLook(looks, meetingId) {
  for (let i = looks.length - 1; i >= 0; i -= 1) if (looks[i].meetingId === meetingId) return looks[i];
  return null;
}

/** Meetings with an unseen suggestion that would change something. */
export function pendingSuggestions(meetings, looks, { linesFor = null, paused = false } = {}) {
  if (paused) return [];
  const out = [];
  for (const m of meetings) {
    if (m.issuedAt || latestLook(looks, m.id)) continue;
    const suggestion = suggestFiling(m, { meetings, lines: linesFor ? linesFor(m) : m.transcript });
    if (suggestion.seriesId === m.seriesId && suggestion.projectType === m.projectType) continue;
    out.push({ meeting: m, suggestion });
  }
  return out;
}
