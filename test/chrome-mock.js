// Minimal chrome.* mock so extension pages can be rendered in a plain browser
// for visual testing. Not used in the packaged extension.
(() => {
  const listeners = [];
  const store = { settings: null, history: [], modelsDownloaded: { 'whisper-base': { ts: 1 } } };
  window.__mockEmit = (msg) => listeners.forEach((f) => f(msg));
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        console.log('sendMessage', msg);
        if (msg?.type === 'get-state') return { active: false };
        return { ok: true };
      },
      onMessage: { addListener: (f) => listeners.push(f) },
      getURL: (p) => '../dist/' + p,
    },
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          const arr = typeof keys === 'string' ? [keys] : keys;
          for (const k of arr) if (store[k] != null) out[k] = store[k];
          return out;
        },
        set: async (obj) => Object.assign(store, obj),
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
  };
})();
