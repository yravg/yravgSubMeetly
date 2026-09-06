// Sinkronisasi notulen ekstensi ↔ Native Helper (macOS membaca berkas JSON
// yang sama di ~/.yraveragesubmin/notes.json). Register v2 ekstensi dipetakan
// ke skema dokumen v1 helper — lihat _normalize_note_doc di native/server.py.
// Semua fungsi best-effort: null saat helper tak terjangkau.
import {
  nativeGetNotes,
  nativeSaveNote,
  nativeDeleteNote,
} from './native.js';
import { pickText } from './notes-schema.js';

function textOf(t, lang = 'en') {
  if (!t) return '';
  if (typeof t === 'string') return t;
  return t[lang] || t.en || Object.values(t)[0] || '';
}

/** Register v2 → dokumen v1 helper. */
export function meetingToDoc(meeting, lang = meeting?.locale || 'en') {
  const items = meeting?.items || [];
  return {
    id: meeting.id,
    title: meeting.title || 'Notulen sesi',
    date: meeting.date || '',
    source: 'extension',
    status: meeting.issuedAt ? 'issued' : 'ready',
    summary: textOf(meeting.summary, lang),
    decisions: items
      .filter((i) => i.type === 'decision')
      .map((i) => textOf(i.text, lang))
      .filter(Boolean),
    actions: items
      .filter((i) => i.type === 'action')
      .map((i, n) => ({
        id: i.ref || `act-${n + 1}`,
        text: textOf(i.text, lang),
        owner: i.owner || null,
        due: i.due || null,
        status: i.status === 'closed' ? 'closed' : 'open',
      }))
      .filter((a) => a.text),
    transcriptPreview: '',
  };
}

/** Dokumen v1 helper → bentuk ringkas untuk daftar bersama. */
export function docToSummary(doc, lang = 'en') {
  return {
    id: doc?.id || '',
    title: doc?.title || 'Notulen sesi',
    date: doc?.date || '',
    source: doc?.source || 'helper',
    summary: typeof doc?.summary === 'string' ? doc.summary : textOf(doc?.summary, lang),
    decisions: Array.isArray(doc?.decisions) ? doc.decisions.length : 0,
    actions: Array.isArray(doc?.actions) ? doc.actions.length : 0,
  };
}

/** Dorong satu rapat aktif ke penyimpanan bersama. Null bila gagal. */
export async function pushMeetingToHelper(url, meeting, lang) {
  if (!meeting) return null;
  const res = await nativeSaveNote(url, meetingToDoc(meeting, lang));
  return res?.note || null;
}

/** Tarik ringkasan dokumen bersama. [] bila helper tak terjangkau. */
export async function pullSharedNotes(url, lang = 'en') {
  const res = await nativeGetNotes(url);
  const notes = res?.notes;
  if (!Array.isArray(notes)) return [];
  return notes.map((n) => docToSummary(n, lang));
}

/** Hapus dokumen bersama. True bila terhapus. */
export async function deleteSharedNote(url, id) {
  const res = await nativeDeleteNote(url, id);
  return !!res?.ok;
}
