// Chrome API mock for browser-tab harnesses (app.html / panel-test.html).
// Offline + model download reuse the real extension pipeline:
//   sidepanel → (this mock as background) → /dist/offscreen.js → /dist/ai-worker.js → Whisper.
// Realtime tabCapture stays extension-only.
(() => {
  const listeners = [];
  const store = {
    settings: null,
    history: [
      {
        id: 'demo-1',
        ts: Date.now() - 3600_000,
        mode: 'offline',
        title: 'Demo meeting — Local TransSub',
        url: '',
        srcLang: 'ja',
        tgtLang: 'en',
        lines: [
          { t0: 0, t1: 3.2, text: 'こんにちは', translation: 'Hello' },
          { t0: 3.2, t1: 7.1, text: '今日の議題を始めます', translation: "Let's start today's agenda" },
          { t0: 7.1, t1: 11.0, text: 'リリース状況を確認します', translation: 'We will review the release status' },
        ],
      },
    ],
    // Empty until Settings download or first Offline Whisper load fills Cache API.
    modelsDownloaded: {},
  };

  let offscreenBoot = null;

  window.__mockEmit = (msg) => listeners.forEach((f) => f(msg));
  window.__chromeMockStore = store;

  function emitPanel(type, data) {
    window.__mockEmit({ target: 'panel', type, data });
  }

  function emitOffscreen(type, data) {
    window.__mockEmit({ target: 'offscreen', type, data });
  }

  async function getSettings() {
    return store.settings || {};
  }

  /** Boot the real offscreen module once (registers listeners + AI worker). */
  async function ensureOffscreen() {
    if (!offscreenBoot) {
      offscreenBoot = import('/dist/offscreen.js').catch((err) => {
        offscreenBoot = null;
        throw err;
      });
    }
    await offscreenBoot;
  }

  async function saveHistory(entry) {
    const history = store.history || [];
    const idx = history.findIndex((h) => h.id === entry.id);
    if (idx >= 0) history[idx] = { ...history[idx], ...entry, ts: entry.ts || history[idx].ts };
    else history.unshift(entry);
    store.history = history.slice(0, 50);
    emitPanel('history-updated', {});
  }

  async function handleBgMessage(msg) {
    const type = msg?.type;
    const data = msg?.data;

    switch (type) {
      case 'get-state':
        return { active: false };

      case 'panel-start-realtime':
        return {
          ok: false,
          error:
            'Realtime tab capture only works in the Chrome extension. Switch to Offline for on-device Whisper, or load the unpacked extension.',
        };

      case 'panel-stop':
        return { ok: true };

      case 'ensure-offscreen':
        try {
          await ensureOffscreen();
          return { ok: true };
        } catch (e) {
          return {
            ok: false,
            error: String(e?.message || e) + ' — run npm run build so /dist/offscreen.js exists.',
          };
        }

      case 'to-offscreen': {
        try {
          await ensureOffscreen();
          const settings = await getSettings();
          emitOffscreen(data?.type, { ...(data?.data || {}), settings });
          return { ok: true };
        } catch (e) {
          const message = String(e?.message || e);
          emitPanel('offline-error', { message });
          emitPanel('model-error', { key: data?.data?.key, message });
          return { ok: false, error: message };
        }
      }

      case 'mark-model': {
        const modelsDownloaded = store.modelsDownloaded || {};
        if (data?.deleted) delete modelsDownloaded[data.key];
        else modelsDownloaded[data.key] = { ts: Date.now(), ...(data.extra || {}) };
        store.modelsDownloaded = modelsDownloaded;
        return { ok: true };
      }

      case 'delete-history':
        if (data?.id) {
          store.history = (store.history || []).filter((h) => h.id !== data.id);
        }
        emitPanel('history-updated', {});
        return { ok: true };

      case 'update-config':
        return { ok: true };

      case 'save-history':
        await saveHistory(data);
        return { ok: true };

      case 'model-progress':
      case 'model-done':
      case 'model-error':
      case 'offline-line':
      case 'offline-progress':
      case 'offline-done':
      case 'offline-error':
      case 'pipeline-status':
        emitPanel(type, data);
        return { ok: true };

      case 'pipeline-error':
        emitPanel('error', data);
        return { ok: true };

      case 'native-helper-status':
        return {
          ok: false,
          online: false,
          nativeMessaging: false,
          health: null,
          url: (await getSettings()).nativeUrl || 'http://127.0.0.1:17865',
        };

      default:
        console.log('[chrome-mock] sendMessage', msg);
        return { ok: true };
    }
  }

  async function handleMessage(msg) {
    if (!msg) return { ok: false };
    // Same-page stand-in for cross-context chrome.runtime.sendMessage:
    // offscreen / panel targeted messages go to onMessage listeners.
    if (msg.target === 'offscreen' || msg.target === 'panel') {
      window.__mockEmit(msg);
      return undefined;
    }
    return handleBgMessage(msg);
  }

  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg) => Promise.resolve(handleMessage(msg)),
      onMessage: {
        addListener: (f) => listeners.push(f),
        removeListener: (f) => {
          const i = listeners.indexOf(f);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
      // Absolute /dist/ so harness pages work under the lab server (port 8799).
      getURL: (p) => '/dist/' + String(p || '').replace(/^\//, ''),
      // Intentionally omitted: connectNative — nativeHostSupported() stays false in a tab.
    },
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          const arr = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
          for (const k of arr) if (store[k] != null) out[k] = store[k];
          return out;
        },
        set: async (obj) => Object.assign(store, obj),
        remove: async (keys) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete store[k];
        },
      },
      onChanged: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
    tabs: {
      query: async () => [
        {
          id: 1,
          title: 'サンプル動画 — Example Japanese Video',
          url: 'https://www.youtube.com/watch?v=example',
          favIconUrl: 'https://www.youtube.com/favicon.ico',
        },
      ],
      onActivated: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      sendMessage: async () => {},
    },
    tabCapture: {
      getMediaStreamId: async () => {
        throw new Error('tabCapture is unavailable outside the Chrome extension');
      },
    },
    // desktopCapture omitted — sidepanel shows a clear unavailable message on Pick.
  };
})();
