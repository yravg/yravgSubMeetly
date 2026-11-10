// Keep the local register and the engine that hosts this page in step, both ways, so island
// pages (and the macOS app) see meetings saved here and this register lists what the island
// saved. No-op outside /app/.
import { onMeetingsWritten, listMeetings, saveMeeting } from './notes-store.js';
import { pushMeetingToHelper, pullSharedDocs, deleteSharedNote, meetingToDoc, docToMeeting } from './notes-sync.js';
import { isDemoMeeting } from './notes-fixture.js';

const DEBOUNCE_MS = 1200;
const POLL_MS = 30_000;
const ENGINE_LIMIT = 50; // /notes keeps the newest 50 documents

/** The engine origin when this page is served by it at /app/, else null. */
export function engineOrigin(loc = globalThis.location) {
  if (!loc || !/^https?:$/.test(loc.protocol)) return null;
  if (!['127.0.0.1', 'localhost'].includes(loc.hostname)) return null;
  return loc.pathname.startsWith('/app/') ? loc.origin : null;
}

/** What a reader would see change: the engine normalises, so only content fields are compared. */
const sig = (d) => JSON.stringify([
  d.title, d.date, d.summary, d.meeting?.issuedAt ?? null,
  (d.items || []).map((i) => [i.ref, i.type, i.text, i.owner ?? null, i.due ?? null, i.status, i.review]),
]);

/**
 * Push saved meetings to the engine (debounced) and pull the engine's meetings into the register
 * (on start, every `pollMs`, and when the page regains focus). Engine wins for ids it holds;
 * local-only meetings stay and are pushed; demo meetings are neither pushed nor imported.
 * `onError()` runs when a push fails (the data stays local); `onSync({ok, at, count, changed})`
 * runs after every pull (`ok: false` when the engine did not answer).
 * shortcut: a meeting deleted on the engine side is kept locally, and a local edit made while the
 * engine was down is overwritten at the next start; upgrade when a second writer needs merging.
 */
export function startEngineSync({ lang = () => 'en', onError = () => {}, onSync = () => {}, origin = engineOrigin(), pollMs = POLL_MS } = {}) {
  if (!origin) return null;
  const seen = new Map(); // id -> JSON of the meeting as last pushed or pulled
  const dirty = new Set(); // ids whose last push failed: the pull must not overwrite them
  let timer = null;
  let poll = null;
  let running = Promise.resolve();

  const flush = async () => {
    const meetings = await listMeetings();
    const ids = new Set(meetings.map((m) => m.id));
    let failed = false;
    for (const m of meetings.filter((x) => !isDemoMeeting(x)).slice(0, ENGINE_LIMIT)) {
      const json = JSON.stringify(m);
      if (seen.get(m.id) === json) continue;
      if (await pushMeetingToHelper(origin, m, lang())) { seen.set(m.id, json); dirty.delete(m.id); }
      else { failed = true; dirty.add(m.id); }
    }
    for (const id of [...seen.keys()]) {
      if (ids.has(id)) continue;
      if (await deleteSharedNote(origin, id)) seen.delete(id);
      else failed = true;
    }
    if (failed) onError();
  };

  const pull = async () => {
    const docs = await pullSharedDocs(origin);
    if (!docs) { onSync({ ok: false, at: Date.now(), count: 0, changed: 0 }); return; }
    const mine = new Map((await listMeetings()).map((m) => [m.id, m]));
    let changed = 0;
    for (const doc of docs) {
      // source 'media': a video the island kept as a transcript, not a meeting, until its "Save as meeting" (PMM-015).
      if (!doc?.id || isDemoMeeting(doc) || doc.source === 'media' || dirty.has(doc.id)) continue;
      const own = mine.get(doc.id);
      if (own && sig(meetingToDoc(own, lang())) === sig(doc)) { seen.set(own.id, JSON.stringify(own)); continue; }
      const saved = await saveMeeting(docToMeeting(doc, lang(), own));
      seen.set(saved.id, JSON.stringify(saved)); // already on the engine: do not echo it back
      changed++;
    }
    onSync({ ok: true, at: Date.now(), count: docs.length, changed });
  };

  const guard = (fn) => { running = running.then(fn).catch(onError); return running; };
  // Steady state pushes before it pulls, so a pending local edit is never overwritten.
  const cycle = () => guard(async () => { await flush(); await pull(); });
  const onVisible = () => { if (globalThis.document?.visibilityState !== 'hidden') cycle(); };

  onMeetingsWritten(() => { clearTimeout(timer); timer = setTimeout(() => guard(flush), DEBOUNCE_MS); });
  // Boot: the engine's copy wins first (seen is empty, a push now would overwrite it), then push what it lacks.
  guard(async () => { await pull(); await flush(); });
  if (pollMs > 0) poll = setInterval(cycle, pollMs);
  globalThis.addEventListener?.('focus', onVisible);
  globalThis.document?.addEventListener?.('visibilitychange', onVisible);
  return {
    flushNow: () => { clearTimeout(timer); return cycle(); },
    stop: () => {
      clearTimeout(timer); clearInterval(poll); onMeetingsWritten(null);
      globalThis.removeEventListener?.('focus', onVisible);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
    },
  };
}
