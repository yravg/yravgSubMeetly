// Chrome API mock for browser-tab harnesses (app.html / panel-test.html).
// Offline + realtime reuse the real extension pipeline:
//   sidepanel → (this mock as background) → /dist/offscreen.js → /dist/ai-worker.js → Whisper.
// Lab realtime uses captureType "media" + globalThis.__ysmCaptureStream
// (getDisplayMedia or <audio>.captureStream) — not chrome.tabCapture.
(() => {
  const listeners = [];

  // localStorage tier for the storage mock below. Reads return undefined (not
  // null) when a key was never persisted, so a seeded default can win instead.
  function readPersisted(key) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return undefined; // private mode / blocked site data
    }
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined; // corrupt entry — fall back to the seed
    }
  }
  function writePersisted(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota or private mode — the in-memory tier still has it this session */
    }
  }

  const store = {
    settings: null,
    history: [
      {
        id: 'demo-1',
        ts: Date.now() - 3600_000,
        mode: 'offline',
        title: 'Demo meeting — yraverageSubMin',
        url: '',
        srcLang: 'zh',
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
  let labSession = {
    active: false,
    tabTitle: '',
    tabUrl: '',
    config: null,
    lines: [],
    startedAt: 0,
    videoTime: 0,
  };

  window.__mockEmit = (msg) => listeners.forEach((f) => f(msg));
  window.__chromeMockStore = store;

  // chrome.storage.onChanged ala lab: set/remove memberi tahu listener
  // sehalaman; antar-tab mengalir lewat DOM 'storage' (tidak menyala di tab
  // penulis, tepat seperti Chrome) sehingga dua permukaan sinkron tanpa reload.
  const storageListeners = [];
  function emitStorage(changes) {
    for (const f of [...storageListeners]) {
      try {
        f(changes, 'local');
      } catch (e) {
        console.warn('[chrome-mock] storage listener failed', e);
      }
    }
  }
  function parseStored(raw) {
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    emitStorage({ [e.key]: { oldValue: parseStored(e.oldValue), newValue: parseStored(e.newValue) } });
  });

  function emitPanel(type, data) {
    window.__mockEmit({ target: 'panel', type, data });
  }

  function emitOffscreen(type, data) {
    window.__mockEmit({ target: 'offscreen', type, data });
  }

  // Overlay content-script (dist/content.js) hidup di halaman yang sama saat
  // app.html memuatnya. Di ekstensi sungguhan background mencapainya lewat
  // chrome.tabs.sendMessage; di lab itu dipetakan ke listener sehalaman.
  function emitContent(type, data) {
    const msg = { target: 'content', type, data };
    labMock.content.log.push(msg);
    window.__mockEmit(msg);
  }

  // ---------------------------------------------------------------------------
  // Kendali skenario untuk tes dan demo: window.__labMock
  //
  // Mock ini dulu hanya punya jalur bahagia, sehingga status "helper mati",
  // fallback ke browser, dan mode manual tidak pernah bisa dipicu di app.html.
  // `helper.mode` mengatur fetch ke 127.0.0.1:17865:
  //   'passthrough' — apa adanya (helper sungguhan bila hidup)
  //   'offline'     — semua permintaan gagal seperti helper tidak jalan
  //   'fixture'     — jawab dari `helper.health` / `helper.device` tanpa jaringan
  // `helper.latencyMs` menunda jawaban; `helper.failNext` menggagalkan N permintaan
  // berikutnya lalu kembali normal — untuk menguji pemulihan.
  const HELPER_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost):17865(\/|$)/;
  const labMock = {
    helper: {
      mode: 'passthrough',
      latencyMs: 0,
      failNext: 0,
      health: {
        ok: true,
        engine: 'faster-whisper',
        engine_label: 'faster-whisper',
        model: 'large-v3-turbo',
        device: 'cuda',
        platform: 'Linux',
        ffmpeg: true,
        translate: false,
        features: { transcribe_file_jobs: true, streaming_file_jobs: true },
      },
      device: { device: 'auto', active: 'cuda', compute: 'float16', cuda_available: true, supported: true, applied: true },
      log: [],
    },
    content: { log: [] },
    reset() {
      labMock.helper.mode = 'passthrough';
      labMock.helper.latencyMs = 0;
      labMock.helper.failNext = 0;
      labMock.helper.log.length = 0;
      labMock.content.log.length = 0;
    },
  };
  window.__labMock = labMock;

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!HELPER_ORIGIN_RE.test(url) || labMock.helper.mode === 'passthrough') return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url).pathname;
    labMock.helper.log.push({ method, path });
    if (labMock.helper.latencyMs) await new Promise((r) => setTimeout(r, labMock.helper.latencyMs));
    if (labMock.helper.failNext > 0) {
      labMock.helper.failNext -= 1;
      throw new TypeError('Failed to fetch');
    }
    if (labMock.helper.mode === 'offline') throw new TypeError('Failed to fetch');
    const json = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (path === '/health') return json(200, labMock.helper.health);
    if (path === '/engine/device' && method === 'GET') return json(200, labMock.helper.device);
    if (path === '/engine/device' && method === 'POST') {
      let want = 'auto';
      try {
        want = JSON.parse(init.body || '{}').device || 'auto';
      } catch {
        /* biarkan 'auto' */
      }
      labMock.helper.device = { ...labMock.helper.device, device: want, applied: want === 'auto' || want === labMock.helper.device.active };
      return json(200, {
        ok: true,
        supported: labMock.helper.device.supported,
        device: want,
        restart_required: want !== labMock.helper.device.active,
      });
    }
    return json(404, { error: 'not found' });
  };

  async function getSettings() {
    return store.settings || {};
  }

  function labVideoTime() {
    try {
      if (typeof window.__ysmLabClock === 'function') {
        const t = Number(window.__ysmLabClock());
        if (Number.isFinite(t) && t >= 0) return t;
      }
    } catch {
      /* ignore */
    }
    return labSession.videoTime || 0;
  }

  function publicState() {
    return {
      active: labSession.active,
      tabId: 1,
      tabTitle: labSession.tabTitle,
      config: labSession.config,
      lineCount: labSession.lines.length,
      cacheMaxTime: 0,
    };
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

  async function stopLabSession() {
    if (!labSession.active) {
      emitOffscreen('stop-capture', {});
      emitPanel('state', publicState());
      return;
    }
    emitOffscreen('stop-capture', {});
    if (labSession.lines.length > 0) {
      await saveHistory({
        id: `lab-rt-${labSession.startedAt}`,
        ts: labSession.startedAt,
        mode: 'realtime',
        title: labSession.tabTitle || 'Lab realtime',
        url: labSession.tabUrl || '',
        srcLang: labSession.config?.srcLang,
        tgtLang: labSession.config?.tgtLang,
        lines: labSession.lines,
      });
    }
    labSession = {
      active: false,
      tabTitle: '',
      tabUrl: '',
      config: null,
      lines: [],
      startedAt: 0,
      videoTime: 0,
    };
    emitPanel('state', publicState());
    emitContent('session', { active: false });
  }

  async function startLabRealtime(data) {
    await ensureOffscreen();
    const stream = window.__ysmCaptureStream;
    if (!stream || typeof stream.getAudioTracks !== 'function' || !stream.getAudioTracks().length) {
      return {
        ok: false,
        error:
          'No capture stream. Start uses a looping CC0/demo clip; Pick shares a tab/window with audio (getDisplayMedia).',
      };
    }
    if (labSession.active) await stopLabSession();

    const settings = await getSettings();
    const config = {
      tabId: 1,
      srcLang: data?.srcLang || 'ja',
      tgtLang: data?.tgtLang || 'en',
      taskMode: data?.taskMode || 'translate',
      dualLine: data?.dualLine ?? false,
      refineTranslation: data?.refineTranslation ?? false,
      asrModel: data?.asrModel || 'whisper-base',
      streamId: null,
      captureType: 'media',
      cacheMaxTime: 0,
    };

    labSession = {
      active: true,
      tabTitle: data?.tabTitle || 'Lab realtime audio',
      tabUrl: data?.tabUrl || location.href,
      config,
      lines: [],
      startedAt: Date.now(),
      videoTime: 0,
    };

    emitOffscreen('start-capture', {
      streamId: null,
      captureType: 'media',
      config,
      settings,
    });
    emitPanel('state', publicState());
    // Sama seperti background sungguhan: overlay di halaman diberi tahu sesi mulai.
    emitContent('session', { active: true, config, cacheCues: [], cacheMaxTime: 0 });
    return { ok: true };
  }

  async function handleBgMessage(msg) {
    const type = msg?.type;
    const data = msg?.data;

    switch (type) {
      case 'get-state':
        return publicState();

      case 'panel-start-realtime':
        try {
          return await startLabRealtime(data);
        } catch (e) {
          const message = String(e?.message || e);
          emitPanel('error', { message });
          return { ok: false, error: message };
        }

      case 'panel-stop':
        await stopLabSession();
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
        if (labSession.active && data) {
          labSession.config = { ...labSession.config, ...data };
          emitOffscreen('update-config', { config: labSession.config });
          emitContent('config', { config: labSession.config });
        }
        return { ok: true };

      case 'save-history':
        await saveHistory(data);
        return { ok: true };

      case 'get-video-time':
        labSession.videoTime = labVideoTime();
        return { ok: true, time: labSession.videoTime };

      case 'speech-start':
        labSession.videoTime = labVideoTime();
        return { ok: true, time: labSession.videoTime };

      case 'check-cache-range':
        return { ok: true, cached: false, cacheMaxTime: 0 };

      case 'subtitle': {
        const d = data || {};
        emitPanel('subtitle', d);
        emitContent('subtitle', d);
        if (labSession.active && d.final && d.t0 != null) {
          const line = {
            t0: d.t0,
            t1: d.t1 ?? d.t0 + 2,
            src: (d.rawSource ?? d.source ?? '').trim(),
            tgt: (d.rawTranslation ?? d.translation ?? '').trim(),
          };
          if (line.src || line.tgt) labSession.lines.push(line);
        }
        return { ok: true };
      }

      case 'pipeline-status':
        emitPanel('pipeline-status', data);
        emitContent('pipeline-status', data);
        return { ok: true };

      case 'pipeline-error':
        emitPanel('error', data);
        await stopLabSession();
        return { ok: true };

      case 'capture-ended':
        await stopLabSession();
        return { ok: true };

      case 'model-progress':
      case 'model-done':
      case 'model-error':
      case 'offline-line':
      case 'offline-progress':
      case 'offline-done':
      case 'offline-error':
        emitPanel(type, data);
        return { ok: true };

      case 'native-helper-status': {
        // Konsisten dengan pembungkus fetch: mode 'fixture' berarti helper "hidup".
        const online = labMock.helper.mode === 'fixture';
        return {
          ok: online,
          online,
          nativeMessaging: false,
          health: online ? labMock.helper.health : null,
          engine_label: online ? labMock.helper.health.engine_label || labMock.helper.health.engine : null,
          url: (await getSettings()).nativeUrl || 'http://127.0.0.1:17865',
        };
      }

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
    // Backed by localStorage, one entry per key, JSON-encoded — NOT a plain
    // object. The lab has two surfaces that must share one store: app.html
    // (which sees this mock, so notes-store picks its chrome.storage.local
    // backend) and /dist/minutes.html (no mock, so notes-store falls back to
    // localStorage). Keeping the mock in memory gave them separate stores:
    // "Open minutes register" always landed on an empty register, and a
    // captured meeting vanished on reload. Same key names as the localStorage
    // backend, so both read and write the same bytes.
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          const arr = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
          for (const k of arr) {
            const persisted = readPersisted(k);
            const v = persisted === undefined ? store[k] : persisted;
            if (v != null) out[k] = v;
          }
          return out;
        },
        set: async (obj) => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            const persisted = readPersisted(k);
            const oldValue = persisted === undefined ? store[k] : persisted;
            changes[k] = { oldValue, newValue: v };
          }
          Object.assign(store, obj);
          for (const [k, v] of Object.entries(obj)) writePersisted(k, v);
          emitStorage(changes);
        },
        remove: async (keys) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const changes = {};
          for (const k of arr) {
            const persisted = readPersisted(k);
            const oldValue = persisted === undefined ? store[k] : persisted;
            changes[k] = { oldValue, newValue: undefined };
            delete store[k];
            try {
              localStorage.removeItem(k);
            } catch {
              /* private mode — the in-memory tier still dropped it */
            }
          }
          emitStorage(changes);
        },
      },
      onChanged: {
        addListener: (f) => storageListeners.push(f),
        removeListener: (f) => {
          const i = storageListeners.indexOf(f);
          if (i >= 0) storageListeners.splice(i, 1);
        },
      },
    },
    tabs: {
      query: async () => [
        {
          id: 1,
          title: 'Lab demo — looping speech.wav',
          url: 'http://127.0.0.1:8799/speech.wav',
          favIconUrl: 'http://127.0.0.1:8799/dist/icons/icon16.png',
        },
      ],
      onActivated: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      // Jalur background → overlay di ekstensi sungguhan. Di lab, overlay ada
      // di halaman yang sama, jadi pesannya diteruskan ke listener sehalaman.
      sendMessage: async (_tabId, msg) => {
        if (msg && msg.target === 'content') emitContent(msg.type, msg.data);
      },
    },
    tabCapture: {
      getMediaStreamId: async () => {
        throw new Error('tabCapture is unavailable outside the Chrome extension');
      },
    },
    // desktopCapture omitted — sidepanel lab path uses getDisplayMedia instead.
  };
})();
