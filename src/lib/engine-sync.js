// Mirror the local register to the engine that hosts this page, so island pages
// (and the macOS app) see meetings saved in the app window. No-op outside /app/.
import { onMeetingsWritten, listMeetings } from './notes-store.js';
import { pushMeetingToHelper, pullSharedNotes, deleteSharedNote } from './notes-sync.js';

const DEBOUNCE_MS = 1200;
const ENGINE_LIMIT = 50; // /notes keeps the newest 50 documents

/** The engine origin when this page is served by it at /app/, else null. */
export function engineOrigin(loc = globalThis.location) {
  if (!loc || !/^https?:$/.test(loc.protocol)) return null;
  if (!['127.0.0.1', 'localhost'].includes(loc.hostname)) return null;
  return loc.pathname.startsWith('/app/') ? loc.origin : null;
}

/**
 * Push saved meetings to the engine, debounced. Deletes only ids this page pushed.
 * `onError()` runs when the engine refuses or is unreachable (the data stays local).
 * shortcut: edits made elsewhere while this page was closed are not re-pushed, only
 * meetings missing from the engine are; upgrade when a second writer exists.
 */
export function startEngineSync({ lang = () => 'en', onError = () => {}, origin = engineOrigin() } = {}) {
  if (!origin) return null;
  const seen = new Map(); // id -> JSON last pushed
  let timer = null;
  let running = Promise.resolve();

  const flush = async () => {
    const meetings = await listMeetings();
    const ids = new Set(meetings.map((m) => m.id));
    let failed = false;
    for (const m of meetings.slice(0, ENGINE_LIMIT)) {
      const json = JSON.stringify(m);
      if (seen.get(m.id) === json) continue;
      if (await pushMeetingToHelper(origin, m, lang())) seen.set(m.id, json);
      else failed = true;
    }
    for (const id of [...seen.keys()]) {
      if (ids.has(id)) continue;
      if (await deleteSharedNote(origin, id)) seen.delete(id);
      else failed = true;
    }
    if (failed) onError();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { running = running.then(flush).catch(onError); }, DEBOUNCE_MS);
  };

  onMeetingsWritten(schedule);
  // Boot: prime from what the engine already has, push what it lacks.
  running = (async () => {
    const remote = new Set((await pullSharedNotes(origin, lang())).map((n) => n.id));
    const meetings = await listMeetings();
    for (const m of meetings) if (remote.has(m.id)) seen.set(m.id, JSON.stringify(m));
    await flush();
  })().catch(onError);
  return { flushNow: () => { clearTimeout(timer); running = running.then(flush).catch(onError); return running; } };
}
