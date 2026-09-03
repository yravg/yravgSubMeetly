/**
 * Penyimpanan notulen lokal di chrome.storage.local (kunci `meetingNotes`).
 */
import { wrapNotesStore, assertMeetingNote, createMeetingNote } from './notes-schema.js';

const KEY = 'meetingNotes';

async function readRaw() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { schemaVersion: 1, updatedAt: null, notes: [] };
  }
  const { [KEY]: data } = await chrome.storage.local.get(KEY);
  if (!data || !Array.isArray(data.notes)) {
    return { schemaVersion: 1, updatedAt: null, notes: [] };
  }
  return data;
}

async function writeRaw(store) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return store;
  await chrome.storage.local.set({ [KEY]: store });
  return store;
}

export async function listNotes() {
  const store = await readRaw();
  return store.notes.map((n) => assertMeetingNote(n));
}

export async function getNote(id) {
  const notes = await listNotes();
  return notes.find((n) => n.id === id) || null;
}

export async function saveNote(partial) {
  const note = createMeetingNote({ ...partial, savedLocally: true, status: partial.status || 'saved' });
  assertMeetingNote(note);
  const prev = await listNotes();
  const next = [note, ...prev.filter((n) => n.id !== note.id)].slice(0, 50);
  await writeRaw(wrapNotesStore(next));
  return note;
}

export async function deleteNote(id) {
  const prev = await listNotes();
  const next = prev.filter((n) => n.id !== id);
  await writeRaw(wrapNotesStore(next));
  return next.length;
}
