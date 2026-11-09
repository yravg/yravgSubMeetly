// Engine-hosted web host: the Windows app opens /app/<page> from the engine
// (http://127.0.0.1:17865) in a plain Chrome window, where there is no
// chrome.* API. This classic script runs BEFORE the page module and installs a
// small `chrome` stand-in so the SAME panel/shell/minutes code works:
//   storage.local/onChanged -> localStorage (same keys + JSON as the lab mock)
//   runtime.sendMessage/onMessage/getURL -> an in-page bus
//   the "background" -> the cases below (real helper, no fixtures, no demo data)
// Capture is getDisplayMedia (sidepanel.js acquireLabDisplayStream) feeding the
// real offscreen.js pipeline (VAD -> engine /draft -> segments). Not available
// outside the extension: tabCapture, the page overlay (content.js), native
// messaging (the page reaches the engine over HTTP instead).
// No-op inside the extension or the lab (they already provide chrome.runtime).
import { migrateSessions } from './lib/session-migrate.js';
import { normalizeSession, shouldAutosave, AUTOSAVE_INTERVAL_MS } from './lib/session-schema.js';
import { mergeLine } from './lib/transcript-cache.js';
import { normalizeInterpreter, isConsecutive } from './lib/interpreter.js';
import { nativeHealth } from './lib/native.js';
import { LOCAL_HELPER_ORIGIN, NATIVE_MESSAGING_HOST } from './lib/native-protocol.js';

/** Served by the engine under /app/ on a loopback host, and not an extension/lab page. */
export function isEngineHosted(loc = location, chromeObj = globalThis.chrome) {
  return (
    /^https?:$/.test(loc.protocol) &&
    /^(127\.0\.0\.1|localhost)$/.test(loc.hostname) &&
    loc.pathname.startsWith('/app/') &&
    !chromeObj?.runtime?.onMessage
  );
}

export function installWebHost(win = window) {
  const listeners = [];
  const storageListeners = [];
  const base = new URL('./', win.location.href);

  // ---- storage.local ------------------------------------------------------
  const read = (k) => {
    try {
      const raw = win.localStorage.getItem(k);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined; // private mode or a corrupt entry: behave as unset
    }
  };
  const emitStorage = (changes) => {
    for (const f of [...storageListeners]) {
      try { f(changes, 'local'); } catch (e) { console.warn('[web-host] storage listener', e); }
    }
  };
  // Other frames/tabs of this origin (app shell <-> panel iframes) sync through the DOM event.
  win.addEventListener('storage', (e) => {
    if (!e.key) return;
    const parse = (v) => { try { return v == null ? undefined : JSON.parse(v); } catch { return v; } };
    emitStorage({ [e.key]: { oldValue: parse(e.oldValue), newValue: parse(e.newValue) } });
  });
  // chrome.storage accepts a callback too (sidepanel.js uses both styles).
  const cb = (promise, fn) => (typeof fn === 'function' ? void promise.then(fn) : promise);
  const keysOf = (keys) => (Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
  const storage = {
    local: {
      get: (keys, fn) => cb((async () => {
        const out = {};
        for (const k of keysOf(keys)) {
          const v = read(k);
          if (v != null) out[k] = v;
          else if (keys && typeof keys === 'object' && !Array.isArray(keys) && keys[k] != null) out[k] = keys[k];
        }
        return out;
      })(), fn),
      set: (obj, fn) => cb((async () => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: read(k), newValue: v };
          try { win.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('[web-host] storage full?', k, e); }
        }
        emitStorage(changes);
      })(), fn),
      remove: (keys, fn) => cb((async () => {
        const changes = {};
        for (const k of keysOf(keys)) {
          changes[k] = { oldValue: read(k), newValue: undefined };
          try { win.localStorage.removeItem(k); } catch { /* blocked storage */ }
        }
        emitStorage(changes);
      })(), fn),
    },
    onChanged: {
      addListener: (f) => storageListeners.push(f),
      removeListener: (f) => { const i = storageListeners.indexOf(f); if (i >= 0) storageListeners.splice(i, 1); },
    },
  };

  // ---- message bus --------------------------------------------------------
  const deliver = (msg) => { for (const f of [...listeners]) { try { f(msg, {}, () => {}); } catch (e) { console.warn('[web-host] listener', e); } } };
  const toPanel = (type, data) => deliver({ target: 'panel', type, data });
  const toOffscreen = (type, data) => deliver({ target: 'offscreen', type, data });

  const getSettings = async () => (await storage.local.get('settings')).settings || {};

  // ---- background: one in-page session ------------------------------------
  const idle = () => ({
    active: false, id: null, tabTitle: '', tabUrl: '', config: null, lines: [],
    startedAt: 0, videoTime: 0, cacheMaxTime: 0,
  });
  let session = idle();
  let offscreenBoot = null;
  let lastAutosaveAt = 0;

  const publicState = () => ({
    active: session.active, tabId: session.active ? 1 : null, tabTitle: session.tabTitle,
    config: session.config, lineCount: session.lines.length, cacheMaxTime: 0,
  });

  // shortcut: offscreen.js is imported into this page (no offscreen document); reuse of the real
  // pipeline is the point, but it shares the page's main thread: upgrade to a dedicated iframe/worker if it janks.
  const ensureOffscreen = () => {
    offscreenBoot ||= import(/* @vite-ignore */ new URL('offscreen.js', base).href).catch((e) => { offscreenBoot = null; throw e; });
    return offscreenBoot;
  };

  async function saveHistory(entry) {
    const { history = [] } = await storage.local.get('history');
    const list = migrateSessions(history);
    const next = normalizeSession(entry);
    const i = list.findIndex((h) => h.id === next.id);
    if (i >= 0) list[i] = { ...list[i], ...next, ts: next.ts || list[i].ts };
    else list.unshift(next);
    await storage.local.set({ history: migrateSessions(list) });
    toPanel('history-updated', {});
  }

  const snapshot = () => ({
    id: session.id, ts: session.startedAt, mode: 'realtime', title: session.tabTitle, url: session.tabUrl,
    srcLang: session.config?.srcLang, tgtLang: session.config?.tgtLang, lines: session.lines,
  });

  async function autosave(force = false) {
    const now = Date.now();
    if (!shouldAutosave({ now, lastAt: lastAutosaveAt, lineCount: session.lines.length, active: session.active, force, intervalMs: AUTOSAVE_INTERVAL_MS })) return;
    lastAutosaveAt = now;
    await saveHistory(snapshot());
  }

  async function buildConfig(partial = {}) {
    const settings = await getSettings();
    const { lastConfig = {} } = await storage.local.get('lastConfig');
    const cfg = {
      tabId: 1,
      srcLang: partial.srcLang ?? lastConfig.srcLang ?? 'ja',
      tgtLang: partial.tgtLang ?? lastConfig.tgtLang ?? 'en',
      taskMode: partial.taskMode ?? lastConfig.taskMode ?? 'translate',
      dualLine: partial.dualLine ?? settings.dualLine ?? false,
      refineTranslation: partial.refineTranslation ?? settings.refineTranslation ?? false,
      asrModel: partial.asrModel ?? lastConfig.asrModel ?? settings.asrModel ?? 'whisper-base',
      streamId: null,
      captureType: 'media',
    };
    const interpreter = normalizeInterpreter(settings, cfg.srcLang, cfg.tgtLang);
    if (isConsecutive(interpreter)) {
      cfg.srcLang = interpreter.a; cfg.tgtLang = interpreter.b; cfg.taskMode = 'translate'; cfg.refineTranslation = false;
    }
    cfg.interpreter = interpreter;
    return cfg;
  }

  async function startRealtime(data) {
    const stream = win.__ysmCaptureStream;
    if (!stream?.getAudioTracks?.().length) {
      throw new Error('No audio to caption. Press Start and share a tab, window or screen with “Also share audio” ticked.');
    }
    if (session.active) await stopSession();
    await ensureOffscreen();
    const config = await buildConfig(data);
    session = { ...idle(), active: true, id: `web-${Date.now()}`, tabTitle: data?.tabTitle || 'Shared audio', tabUrl: data?.tabUrl || '', config, startedAt: Date.now() };
    lastAutosaveAt = 0;
    toOffscreen('start-capture', { streamId: null, captureType: 'media', config, settings: await getSettings() });
    toPanel('state', publicState());
  }

  async function stopSession() {
    if (!session.active) return;
    toOffscreen('stop-capture', {});
    if (session.lines.length) { await autosave(true); await saveHistory(snapshot()); }
    session = idle();
    toPanel('state', publicState());
  }

  const applyDualLine = ({ source, translation, dualLine }) => (
    dualLine ? { source: source || '', translation: translation || '' } : { source: '', translation: translation || source || '' }
  );

  async function handleBg(msg) {
    const d = msg.data;
    switch (msg.type) {
      case 'get-state': return publicState();
      case 'panel-start-realtime':
        try { await startRealtime(d); return { ok: true }; } catch (e) {
          const message = String(e?.message || e);
          toPanel('error', { message });
          return { ok: false, error: message };
        }
      case 'panel-stop': await stopSession(); return { ok: true };
      case 'ensure-offscreen':
        try { await ensureOffscreen(); return { ok: true }; } catch (e) { return { ok: false, error: `${e?.message || e} (offscreen.js did not load)` }; }
      case 'to-offscreen':
        try {
          await ensureOffscreen();
          toOffscreen(d.type, { ...(d.data || {}), settings: await getSettings() });
          return { ok: true };
        } catch (e) {
          const message = String(e?.message || e);
          toPanel('offline-error', { message });
          toPanel('model-error', { key: d?.data?.key, message });
          return { ok: false, error: message };
        }
      case 'mark-model': {
        const { modelsDownloaded = {} } = await storage.local.get('modelsDownloaded');
        if (d.deleted) delete modelsDownloaded[d.key]; else modelsDownloaded[d.key] = { ts: Date.now(), ...(d.extra || {}) };
        await storage.local.set({ modelsDownloaded });
        return { ok: true };
      }
      case 'delete-history': {
        const { history = [] } = await storage.local.get('history');
        await storage.local.set({ history: history.filter((h) => h.id !== d?.id) });
        toPanel('history-updated', {});
        return { ok: true };
      }
      case 'save-history': await saveHistory(d); return { ok: true };
      case 'update-config':
        if (session.active) { session.config = { ...session.config, ...(d || {}) }; toOffscreen('update-config', { config: session.config }); }
        return { ok: true };
      case 'video-time': case 'get-video-time': case 'speech-start': {
        const t = Number(win.__ysmLabClock?.());
        if (Number.isFinite(t) && t >= 0) session.videoTime = t;
        return { ok: true, time: session.videoTime };
      }
      case 'check-cache-range': return { ok: true, cached: false, cacheMaxTime: 0 };
      case 'perf-sample': {
        toPanel('perf-sample', d || {});
        const { perfSamples = [] } = await storage.local.get('perfSamples');
        perfSamples.push(d || {});
        if (perfSamples.length > 3000) perfSamples.splice(0, perfSamples.length - 3000);
        await storage.local.set({ perfSamples });
        return { ok: true };
      }
      case 'subtitle': {
        const formatted = applyDualLine({ source: d.rawSource ?? d.source, translation: d.rawTranslation ?? d.translation, dualLine: session.config?.dualLine });
        toPanel('subtitle', { ...d, ...formatted });
        if (d.final && d.t0 != null) {
          const line = {
            t0: d.t0, t1: d.t1 ?? d.t0 + 2,
            src: (d.rawSource ?? d.source ?? '').trim(), tgt: (d.rawTranslation ?? '').trim(),
            ...(d.dir?.src && d.dir?.tgt ? { dir: { src: d.dir.src, tgt: d.dir.tgt } } : {}),
          };
          if (!line.src) line.src = (d.rawTranslation ?? d.translation ?? '').trim();
          if (line.src || line.tgt) {
            session.lines = mergeLine(session.lines, line);
            void autosave();
          }
        }
        return { ok: true };
      }
      case 'pipeline-status': toPanel('pipeline-status', d); return { ok: true };
      case 'pipeline-error': toPanel('error', d); await stopSession(); return { ok: true };
      case 'capture-ended': await stopSession(); return { ok: true };
      case 'model-progress': case 'model-done': case 'model-error':
      case 'offline-line': case 'offline-progress': case 'offline-done': case 'offline-error':
        toPanel(msg.type, d); return { ok: true };
      case 'native-helper-status': {
        const url = (await getSettings()).nativeUrl || LOCAL_HELPER_ORIGIN;
        const health = await nativeHealth(url);
        return { ok: !!health?.ok, online: !!health?.ok, host: NATIVE_MESSAGING_HOST, nativeMessaging: false, health, engine_label: health?.engine_label || health?.engine || null, url };
      }
      case 'native-host-connection': return { ok: false, state: 'unsupported' };
      case 'native-host-action': return { ok: false, error: 'nativeMessaging unavailable', host: NATIVE_MESSAGING_HOST };
      default: return { ok: false, error: `unknown message: ${msg.type}` };
    }
  }

  const send = (msg, fn) => {
    const p = !msg ? Promise.resolve({ ok: false })
      : msg.target === 'bg' ? handleBg(msg)
        : (deliver(msg), Promise.resolve(undefined));
    return typeof fn === 'function' ? void p.then(fn) : p;
  };

  const tab = { id: 1, title: 'Shared audio — pick a tab, window or screen when you press Start', url: win.location.origin, favIconUrl: '' };
  win.chrome = {
    runtime: {
      lastError: null,
      sendMessage: send,
      onMessage: {
        addListener: (f) => listeners.push(f),
        removeListener: (f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
      },
      getURL: (p) => new URL(String(p || '').replace(/^\//, ''), base).href,
      // connectNative omitted on purpose: nativeHostSupported() stays false, the page uses HTTP.
    },
    storage,
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      update: async () => tab,
      create: async ({ url } = {}) => { if (url) win.open(url, '_blank'); return tab; },
      sendMessage: async () => {}, // no page overlay outside the extension
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
    },
  };
  win.__ysmWebHost = { session: () => session };
}

if (typeof window !== 'undefined' && isEngineHosted()) installWebHost();
