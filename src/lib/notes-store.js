/**
 * SERVICE — mekanika penyimpanan register. Tanpa aturan domain.
 *
 * Backend dipilih otomatis:
 *   chrome.storage.local  → di dalam ekstensi
 *   localStorage          → di lab (http://127.0.0.1:8799)
 *   memory                → di test / node
 *
 * Satu envelope `minutesRegister` menampung seluruh rapat, dinaikkan versinya
 * saat dibaca. Native helper (SQLite) akan menggantikan backend ini di Fase 2.1
 * lewat `setBackend()` — kontraknya sengaja kecil: get / set.
 */
import { wrapMeetingStore, assertMeeting, createMeeting } from './notes-schema.js';
import { migrateStore } from './notes-migrate.js';

const KEY = 'minutesRegister';
const LEGACY_KEY = 'meetingNotes';
const MAX_MEETINGS = 500;

const memory = new Map();

/** @typedef {{name:string, get(key:string):Promise<any>, set(key:string, value:any):Promise<void>}} Backend */

/** @type {Backend} */
const memoryBackend = {
  name: 'memory',
  async get(key) {
    return memory.get(key) ?? null;
  },
  async set(key, value) {
    memory.set(key, value);
  },
};

/** @type {Backend} */
const chromeBackend = {
  name: 'Saved on this device',
  async get(key) {
    const out = await chrome.storage.local.get(key);
    return out?.[key] ?? null;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};

/** @type {Backend} */
const localBackend = {
  name: 'Saved on this device',
  async get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* kuota penuh / mode privat — jatuh ke memori diam-diam */
      memory.set(key, value);
    }
  },
};

function detectBackend() {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) return chromeBackend;
  if (typeof localStorage !== 'undefined') return localBackend;
  return memoryBackend;
}

let backend = detectBackend();

/** Ganti backend (mis. klien native helper). Mengembalikan backend sebelumnya. */
export function setBackend(next) {
  const prev = backend;
  backend = next || detectBackend();
  return prev;
}

export function backendName() {
  return backend.name;
}

/** Baca envelope, naikkan versi bila perlu, tulis balik sekali kalau berubah. */
async function readStore() {
  let raw = await backend.get(KEY);
  let fromLegacy = false;
  if (!raw) {
    const legacy = await backend.get(LEGACY_KEY);
    if (legacy) {
      raw = legacy;
      fromLegacy = true;
    }
  }
  const upgraded = migrateStore(raw);
  if (upgraded.migrated > 0 || fromLegacy) {
    await backend.set(KEY, wrapMeetingStore(upgraded.meetings.map((m) => createMeeting(m))));
  }
  return upgraded;
}

let writtenHook = null;
/** Daftarkan satu pendengar yang dipanggil setelah setiap tulis (mis. sinkron ke engine). */
export function onMeetingsWritten(fn) {
  writtenHook = typeof fn === 'function' ? fn : null;
}

async function writeStore(meetings) {
  const env = wrapMeetingStore(meetings.slice(0, MAX_MEETINGS));
  await backend.set(KEY, env);
  try { writtenHook?.(); } catch { /* a sync listener must never fail a save */ }
  return env;
}

/** @returns {Promise<import('./notes-schema.js').Meeting[]>} terbaru dulu */
export async function listMeetings() {
  const { meetings } = await readStore();
  return meetings
    .map((m) => createMeeting(m))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq));
}

export async function getMeeting(id) {
  const all = await listMeetings();
  return all.find((m) => m.id === id) || null;
}

/** Simpan (buat atau ganti) satu rapat. */
export async function saveMeeting(partial) {
  const meeting = assertMeeting(createMeeting(partial));
  const prev = await listMeetings();
  const next = [meeting, ...prev.filter((m) => m.id !== meeting.id)];
  await writeStore(next);
  return meeting;
}

export async function deleteMeeting(id) {
  const prev = await listMeetings();
  const next = prev.filter((m) => m.id !== id);
  await writeStore(next);
  return next.length;
}

/** Semua rapat dalam satu seri, terlama dulu. */
export async function listSeries(seriesId) {
  const all = await listMeetings();
  return all.filter((m) => m.seriesId === seriesId).sort((a, b) => a.seq - b.seq);
}

/**
 * Register tindak lanjut berjalan: item terbuka di seluruh seri.
 * @returns {Promise<Array<{item:object, meeting:object}>>}
 */
export async function listOpenItems(seriesId) {
  const meetings = await listSeries(seriesId);
  const rows = [];
  for (const meeting of meetings) {
    for (const item of meeting.items) {
      if (item.status === 'closed') continue;
      if (item.type === 'info' || item.type === 'metric') continue;
      rows.push({ item, meeting });
    }
  }
  return rows;
}

/** Pencarian leksikal lintas rapat — cukup untuk register beberapa ribu baris. */
export async function searchItems(query, { seriesId = null } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const meetings = seriesId ? await listSeries(seriesId) : await listMeetings();
  const hits = [];
  for (const meeting of meetings) {
    for (const item of meeting.items) {
      const hay = [
        item.ref,
        item.owner || '',
        ...Object.values(item.text || {}),
        item.src?.orig || '',
        item.src?.tr || '',
        item.src?.speaker || '',
      ]
        .join(' ')
        .toLowerCase();
      if (hay.includes(q)) hits.push({ item, meeting });
    }
  }
  return hits;
}

/** Untuk test: kosongkan backend memori. */
export async function __resetForTests() {
  memory.clear();
  await backend.set(KEY, null);
}
