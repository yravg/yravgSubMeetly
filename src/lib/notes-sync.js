// Sinkronisasi notulen ekstensi ↔ Native Helper (macOS membaca berkas JSON
// yang sama di ~/.yraveragesubmin/notes.json). Register v2 ekstensi dipetakan
// ke skema dokumen v1 helper — lihat _normalize_note_doc di native/server.py.
// Semua fungsi best-effort: null saat helper tak terjangkau.
import {
  nativeGetNotes,
  nativeSaveNote,
  nativeDeleteNote,
} from './native.js';
import { LOW_CONFIDENCE, normalizeProjectType } from './notes-schema.js';

function textOf(t, lang = 'en') {
  if (!t) return '';
  if (typeof t === 'string') return t;
  return t[lang] || t.en || Object.values(t)[0] || '';
}

/**
 * Satu butir register → bentuk datar yang dibawa dokumen bersama.
 * Yang dibuang di sini hanya `history` dan teks multi-bahasa mentah: pembaca
 * di sisi lain tidak bisa memilih bahasa, jadi teks sudah diratakan ke `lang`.
 */
function itemToDoc(item, lang, n) {
  const conf = Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 1;
  return {
    ref: item.ref || `I-${n + 1}`,
    type: item.type || 'info',
    topic: item.topic || '',
    text: textOf(item.text, lang),
    owner: item.owner || null,
    org: item.org || null,
    due: item.due || null,
    status: item.status || 'open',
    priority: item.priority || null,
    likelihood: item.likelihood || null,
    review: item.review || 'ai',
    confidence: conf,
    // Ambangnya dihitung di sini, bukan di pembaca: kalau tiap permukaan
    // menghitung sendiri, satu di antaranya pasti ketinggalan saat ambangnya
    // berubah.
    needsReview: conf < LOW_CONFIDENCE,
    tc: item.src?.tc || null,
    speaker: item.src?.speaker || null,
    carriedFrom: item.carriedFrom || null,
    links: Array.isArray(item.links) ? item.links.slice(0, 20) : [],
    metric: item.metric
      ? {
          measure: item.metric.measure || '',
          value: Number(item.metric.value),
          unit: item.metric.unit || '',
          baseline: item.metric.baseline ?? null,
          variance: item.metric.variance ?? null,
          asOf: item.metric.asOf || null,
        }
      : null,
  };
}

/**
 * Register v2 → dokumen bersama.
 *
 * `decisions` dan `actions` v1 SENGAJA dipertahankan meski `items` sudah
 * memuat keduanya: aplikasi macOS versi lama dan daftar ringkas di ekstensi
 * membacanya, dan dokumen ini tersimpan di disk pengguna — sebuah build lama
 * bisa membacanya kapan saja setelah build baru menulisnya.
 */
export function meetingToDoc(meeting, lang = meeting?.locale || 'en') {
  const items = meeting?.items || [];
  const agenda = Array.isArray(meeting?.agenda) ? meeting.agenda : [];
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

    schemaVersion: 2,
    meeting: {
      seriesId: meeting.seriesId || '',
      seq: Number.isFinite(Number(meeting.seq)) ? Number(meeting.seq) : null,
      projectType: normalizeProjectType(meeting.projectType),
      locale: meeting.locale || lang,
      tz: meeting.tz || '',
      start: meeting.start || null,
      end: meeting.end || null,
      chair: meeting.chair || null,
      attendees: (meeting.attendees || [])
        .map((p) => (p?.org ? `${p.name} (${p.org})` : p?.name || ''))
        .filter(Boolean)
        .slice(0, 60),
      agenda: { total: agenda.length, covered: agenda.filter((a) => a?.covered).length },
      issuedAt: meeting.issuedAt || null,
      generatedAt: meeting.generatedAt || '',
      engine: meeting.engine
        ? {
            asr: meeting.engine.asr || '',
            mt: meeting.engine.mt || null,
            segments: Number(meeting.engine.segments) || 0,
            durationSec: meeting.engine.durationSec ?? null,
          }
        : null,
    },
    items: items.map((i, n) => itemToDoc(i, lang, n)).filter((i) => i.text),
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
    items: Array.isArray(doc?.items) ? doc.items.length : 0,
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
