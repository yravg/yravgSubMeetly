/**
 * Skema data Notulen Rapat + tindak lanjut (Fase 2).
 * Dipakai ekstensi (chrome.storage / OPFS) dan kontrak API helper.
 */

/** @typedef {'open' | 'done'} ActionStatus */
/** @typedef {'idle' | 'generating' | 'ready' | 'error' | 'saved'} NoteStatus */

/**
 * @typedef {object} ActionItem
 * @property {string} id
 * @property {string} text
 * @property {string | null} owner
 * @property {string | null} due  ISO date YYYY-MM-DD
 * @property {ActionStatus} status
 */

/**
 * @typedef {object} MeetingNote
 * @property {string} id
 * @property {string} title
 * @property {string} source
 * @property {NoteStatus} status
 * @property {string} generatedAt  ISO datetime
 * @property {string} summary
 * @property {string[]} decisions
 * @property {ActionItem[]} actions
 * @property {string} [transcriptPreview]
 * @property {boolean} savedLocally
 * @property {string} [locale]
 */

export const NOTE_SCHEMA_VERSION = 1;

/** @returns {ActionItem} */
export function createActionItem(partial = {}) {
  return {
    id: partial.id || `act-${cryptoRandom()}`,
    text: String(partial.text || '').trim(),
    owner: partial.owner == null ? null : String(partial.owner),
    due: partial.due == null ? null : String(partial.due),
    status: partial.status === 'done' ? 'done' : 'open',
  };
}

/** @returns {MeetingNote} */
export function createMeetingNote(partial = {}) {
  return {
    id: partial.id || `note-${cryptoRandom()}`,
    title: String(partial.title || 'Untitled meeting').trim(),
    source: String(partial.source || 'local').trim(),
    status: partial.status || 'ready',
    generatedAt: partial.generatedAt || new Date().toISOString(),
    summary: String(partial.summary || ''),
    decisions: Array.isArray(partial.decisions) ? partial.decisions.map(String) : [],
    actions: Array.isArray(partial.actions)
      ? partial.actions.map((a) => createActionItem(a))
      : [],
    transcriptPreview: partial.transcriptPreview ? String(partial.transcriptPreview) : '',
    savedLocally: !!partial.savedLocally,
    locale: partial.locale || 'id',
  };
}

function cryptoRandom() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Validasi ringan — lempar Error jika invalid.
 * @param {unknown} note
 * @returns {MeetingNote}
 */
export function assertMeetingNote(note) {
  if (!note || typeof note !== 'object') throw new Error('note harus objek');
  const n = /** @type {Record<string, unknown>} */ (note);
  if (typeof n.id !== 'string' || !n.id) throw new Error('note.id wajib string');
  if (typeof n.title !== 'string') throw new Error('note.title wajib string');
  if (!Array.isArray(n.decisions)) throw new Error('note.decisions wajib array');
  if (!Array.isArray(n.actions)) throw new Error('note.actions wajib array');
  for (const a of n.actions) {
    if (!a || typeof a !== 'object') throw new Error('action invalid');
    if (typeof /** @type {any} */ (a).text !== 'string') throw new Error('action.text wajib');
  }
  return createMeetingNote(n);
}

/**
 * Bentuk envelope penyimpanan lokal.
 * @param {MeetingNote[]} notes
 */
export function wrapNotesStore(notes) {
  return {
    schemaVersion: NOTE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    notes: notes.map((n) => assertMeetingNote(n)),
  };
}
