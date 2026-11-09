// Background service worker: session state machine + message router.
// The heavy pipeline (capture, VAD, ASR, MT) lives in the offscreen document.
import {
  cacheKey,
  maxCachedTime,
  isRangeCached,
  mergeLine,
} from './lib/transcript-cache.js';
import { migrateSessions, needsMigration } from './lib/session-migrate.js';
import { normalizeSession, shouldAutosave, AUTOSAVE_INTERVAL_MS } from './lib/session-schema.js';
import { needsTranslation, pickUntranslatedLines, mergeLinesByTime, sourceText, translationText } from './lib/translation-utils.js';
import { normalizeInterpreter, isConsecutive } from './lib/interpreter.js';
import { nativeHostAction, nativeHostConnection, nativeHostSupported, NATIVE_HOST_NAME } from './lib/native-host.js';
import { nativeHealth } from './lib/native.js';
import { NATIVE_MESSAGING_HOST, LOCAL_HELPER_ORIGIN } from './lib/native-protocol.js';
import { trackMinutesWindow } from './lib/minutes-window.js';

let session = {
  active: false,
  tabId: null,
  tabTitle: '',
  tabUrl: '',
  config: null,
  lines: [],
  startedAt: 0,
  videoTime: 0,
  speechStartTime: null,
  cacheKey: null,
  cachedLines: [],
  cacheMaxTime: 0,
};

// Chrome opens the side panel on toolbar click via setPanelBehavior; Edge
// (and older Chromium) may ignore it, so also open explicitly on action click.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
// TIDE-023: remember the Minutes popup's size/position and forget it when closed.
trackMinutesWindow(chrome);
chrome.action.onClicked.addListener((tab) => {
  try {
    chrome.sidePanel?.open?.({ windowId: tab.windowId });
  } catch (e) {
    console.warn('sidePanel.open failed', e);
  }
});

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification:
        'Runs the local audio pipeline: tab-audio capture, on-device speech recognition and translation.',
    });
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return settings;
}

async function loadTranscriptCache(key) {
  const { transcriptCache = {} } = await chrome.storage.local.get('transcriptCache');
  return transcriptCache[key] || null;
}

async function saveTranscriptCache(key, entry) {
  const { transcriptCache = {} } = await chrome.storage.local.get('transcriptCache');
  transcriptCache[key] = entry;
  await chrome.storage.local.set({ transcriptCache });
}

async function appendToTranscriptCache(key, line, meta) {
  const existing = (await loadTranscriptCache(key)) || {
    id: key,
    url: meta.url,
    title: meta.title,
    srcLang: meta.srcLang,
    tgtLang: meta.tgtLang,
    taskMode: meta.taskMode,
    lines: [],
    updatedAt: Date.now(),
  };
  existing.lines = mergeLine(existing.lines, line);
  existing.updatedAt = Date.now();
  existing.title = meta.title || existing.title;
  await saveTranscriptCache(key, existing);
  return existing;
}

function applyDualLine({ source, translation, dualLine, taskMode }) {
  const dual = !!dualLine;
  const src = dual ? source || '' : '';
  let tgt;
  if (dual) {
    tgt = translation || '';
  } else if (taskMode === 'translate') {
    tgt = translation || source || '';
  } else {
    tgt = translation || source || '';
  }
  return { source: src, translation: tgt };
}

function toPanel(type, data) {
  chrome.runtime.sendMessage({ target: 'panel', type, data }).catch(() => {});
}
function toOffscreen(type, data) {
  chrome.runtime.sendMessage({ target: 'offscreen', type, data }).catch(() => {});
}
function toContent(type, data) {
  if (session.tabId == null) return;
  chrome.tabs.sendMessage(session.tabId, { target: 'content', type, data }).catch(() => {});
}

async function buildConfig(tabId, partial = {}) {
  const settings = await getSettings();
  const { lastConfig = {} } = await chrome.storage.local.get('lastConfig');
  const cfg = {
    tabId,
    srcLang: partial.srcLang ?? lastConfig.srcLang ?? 'ja',
    tgtLang: partial.tgtLang ?? lastConfig.tgtLang ?? 'en',
    taskMode: partial.taskMode ?? lastConfig.taskMode ?? 'translate',
    dualLine: partial.dualLine ?? settings.dualLine ?? false,
    refineTranslation: partial.refineTranslation ?? settings.refineTranslation ?? false,
    asrModel: partial.asrModel ?? lastConfig.asrModel ?? settings.asrModel ?? 'whisper-base',
    streamId: partial.streamId,
    captureType: partial.captureType || 'tab',
  };
  // Interpreter mode is a setting, so a context-menu start honours it too.
  // Two-way is translation between a and b by definition, and has no fixed
  // source language for the draft-then-refine pass.
  const interpreter = normalizeInterpreter(settings, cfg.srcLang, cfg.tgtLang);
  if (isConsecutive(interpreter)) {
    cfg.srcLang = interpreter.a;
    cfg.tgtLang = interpreter.b;
    cfg.taskMode = 'translate';
    cfg.refineTranslation = false;
  }
  cfg.interpreter = interpreter;
  return cfg;
}

async function startRealtime(partialCfg) {
  if (session.active) await stopSession('restart');
  const cfg = await buildConfig(partialCfg.tabId, partialCfg);
  const tabId = cfg.tabId;
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || '')) {
    throw new Error('This page cannot be captured. Open a normal website tab.');
  }

  await ensureOffscreen();
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });

  let streamId = cfg.streamId;
  if (!streamId) {
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (e) {
      throw new Error(
        String(e.message || e) +
          ' — Right-click the page → "Start yravgSubMeetly on this page", or use Pick tab manually.',
      );
    }
  }

  const key = cacheKey(tab.url, cfg.srcLang, cfg.tgtLang, cfg.taskMode);
  const cached = await loadTranscriptCache(key);
  const cachedLines = cached?.lines || [];
  const cacheMax = maxCachedTime(cachedLines);

  session = {
    active: true,
    tabId,
    tabTitle: tab.title || '',
    tabUrl: tab.url || '',
    config: cfg,
    lines: [...cachedLines],
    startedAt: Date.now(),
    videoTime: 0,
    speechStartTime: null,
    cacheKey: key,
    cachedLines,
    cacheMaxTime: cacheMax,
  };

  toOffscreen('start-capture', {
    streamId,
    captureType: cfg.captureType,
    config: { ...cfg, cacheMaxTime: cacheMax },
    settings: await getSettings(),
  });
  toContent('session', {
    active: true,
    config: cfg,
    cacheCues: cachedLines,
    cacheMaxTime: cacheMax,
  });
  toPanel('state', publicState());
  if (cacheMax > 0) {
    toPanel('cache-resume', { cacheMaxTime: cacheMax, lineCount: cachedLines.length });
  }
}

async function stopSession(reason = 'user') {
  if (!session.active) return;
  toOffscreen('stop-capture', {});
  toContent('session', { active: false });

  if (session.lines.length > 0 && session.cacheKey) {
    await saveTranscriptCache(session.cacheKey, {
      id: session.cacheKey,
      url: session.tabUrl,
      title: session.tabTitle,
      srcLang: session.config?.srcLang,
      tgtLang: session.config?.tgtLang,
      taskMode: session.config?.taskMode,
      lines: session.lines,
      updatedAt: Date.now(),
    });
    // force: throttle tidak boleh membuat baris terakhir hilang.
    await autosaveSession({ force: true });
    await saveHistory({
      id: session.cacheKey,
      ts: session.startedAt,
      mode: 'realtime',
      title: session.tabTitle,
      url: session.tabUrl,
      srcLang: session.config?.srcLang,
      tgtLang: session.config?.tgtLang,
      lines: session.lines,
    });
  }

  session = {
    active: false,
    tabId: null,
    tabTitle: '',
    tabUrl: '',
    config: null,
    lines: [],
    startedAt: 0,
    videoTime: 0,
    speechStartTime: null,
    cacheKey: null,
    cachedLines: [],
    cacheMaxTime: 0,
  };
  toPanel('state', publicState());
}

// ---------------------------------------------------------------------------
// Penyimpanan sesi otomatis.
//
// Riwayat sebelumnya hanya ditulis saat sesi DIHENTIKAN. Kalau service worker
// MV3 dimatikan, tab ditutup mendadak, atau browser crash di tengah sesi,
// seluruh transkrip sejak sesi dimulai hilang. Simpan berkala selagi berjalan,
// di-throttle agar tidak menulis pada setiap baris.
let lastAutosaveAt = 0;
let autosavePending = false;

/** Snapshot sesi berjalan ke riwayat. `force` melewati throttle (mis. saat berhenti). */
async function autosaveSession({ force = false } = {}) {
  if (!session.cacheKey) return;
  const now = Date.now();
  if (!shouldAutosave({
    now, lastAt: lastAutosaveAt, lineCount: session.lines.length,
    active: session.active, force, intervalMs: AUTOSAVE_INTERVAL_MS,
  })) {
    autosavePending = true;
    return;
  }
  lastAutosaveAt = now;
  autosavePending = false;
  await saveHistory({
    id: session.cacheKey,
    ts: session.startedAt,
    mode: 'realtime',
    title: session.tabTitle,
    url: session.tabUrl,
    srcLang: session.config?.srcLang,
    tgtLang: session.config?.tgtLang,
    lines: session.lines,
  });
}

async function saveHistory(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  // Data lama tidak berversi dan bentuknya beragam; normalkan dulu supaya
  // pembaca tidak perlu menebak bentuknya.
  const list = migrateSessions(history);
  const next = normalizeSession(entry);
  const idx = list.findIndex((h) => h.id === next.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...next, ts: next.ts || list[idx].ts };
  else list.unshift(next);
  await chrome.storage.local.set({ history: migrateSessions(list) });
  toPanel('history-updated', {});
}

/// Migrasi sekali jalan saat service worker bangun, supaya pembaca lain
/// (panel, ekspor) selalu melihat bentuk kanonis.
async function migrateHistoryIfNeeded() {
  const { history } = await chrome.storage.local.get('history');
  if (!needsMigration(history)) return;
  await chrome.storage.local.set({ history: migrateSessions(history) });
  toPanel('history-updated', {});
}

async function updateSessionConfig(patch) {
  if (!session.active) return;
  session.config = { ...session.config, ...patch };
  toOffscreen('update-config', { config: session.config });
  toContent('config', { config: session.config, cacheCues: session.lines });
}

function publicState() {
  return {
    active: session.active,
    tabId: session.tabId,
    tabTitle: session.tabTitle,
    config: session.config,
    lineCount: session.lines.length,
    cacheMaxTime: session.cacheMaxTime,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  // Pemasangan/pembaruan adalah saat data lama paling mungkin ditemui.
  void migrateHistoryIfNeeded();
  chrome.contextMenus.create({
    id: 'lts-start',
    title: 'Start yravgSubMeetly on this page / 在此页面启动',
    contexts: ['page', 'video', 'audio', 'frame'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'lts-start' || !tab?.id) return;
  try {
    await startRealtime({ tabId: tab.id });
    toPanel('state', publicState());
  } catch (e) {
    toPanel('error', { message: String(e.message || e) });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (session.active && tabId === session.tabId) stopSession('tab-closed');
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (session.active && tabId === session.tabId && info.status === 'loading' && info.url) {
    stopSession('tab-navigated');
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'bg') return;

  (async () => {
    switch (msg.type) {
      case 'panel-start-realtime':
        try {
          await startRealtime(msg.data);
          sendResponse({ ok: true });
        } catch (e) {
          toPanel('error', { message: String(e.message || e) });
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;

      case 'panel-stop':
        await stopSession('user');
        sendResponse({ ok: true });
        break;

      case 'get-state':
        sendResponse(publicState());
        break;

      case 'native-host-action': {
        const action = msg.data?.action || 'status';
        if (!nativeHostSupported()) {
          sendResponse({
            ok: false,
            error: 'nativeMessaging unavailable',
            host: NATIVE_HOST_NAME || NATIVE_MESSAGING_HOST,
          });
          break;
        }
        try {
          const res = await nativeHostAction(action, { timeoutMs: msg.data?.timeoutMs || 45_000 });
          sendResponse({ ok: true, host: NATIVE_HOST_NAME, result: res });
        } catch (e) {
          sendResponse({ ok: false, host: NATIVE_HOST_NAME, error: String(e.message || e) });
        }
        break;
      }

      case 'native-host-connection': {
        // Murah dan selalu menjawab — dipakai diagnostik & kartu status untuk
        // membedakan "host belum dipasang" dari "helper sedang mati".
        sendResponse(await nativeHostConnection({ timeoutMs: msg.data?.timeoutMs || 4_000 }));
        break;
      }

      case 'native-helper-status': {
        const settings = await getSettings();
        const url = settings.nativeUrl || LOCAL_HELPER_ORIGIN;
        const health = await nativeHealth(url);
        sendResponse({
          ok: !!health?.ok,
          online: !!health?.ok,
          host: NATIVE_MESSAGING_HOST,
          nativeMessaging: nativeHostSupported(),
          health,
          engine_label: health?.engine_label || health?.engine || null,
          url,
        });
        break;
      }

      case 'update-config':
        await updateSessionConfig(msg.data || {});
        sendResponse({ ok: true });
        break;

      case 'delete-history':
        {
          const { history = [] } = await chrome.storage.local.get('history');
          const next = history.filter((h) => h.id !== msg.data?.id);
          await chrome.storage.local.set({ history: next });
          if (msg.data?.cacheKey) {
            const { transcriptCache = {} } = await chrome.storage.local.get('transcriptCache');
            delete transcriptCache[msg.data.cacheKey];
            await chrome.storage.local.set({ transcriptCache });
          }
          toPanel('history-updated', {});
          sendResponse({ ok: true });
        }
        break;

      case 'ensure-offscreen':
        await ensureOffscreen();
        sendResponse({ ok: true });
        break;

      case 'to-offscreen':
        await ensureOffscreen();
        toOffscreen(msg.data.type, { ...(msg.data.data || {}), settings: await getSettings() });
        sendResponse({ ok: true });
        break;

      case 'mark-model': {
        const { modelsDownloaded = {} } = await chrome.storage.local.get('modelsDownloaded');
        if (msg.data.deleted) delete modelsDownloaded[msg.data.key];
        else modelsDownloaded[msg.data.key] = { ts: Date.now(), ...(msg.data.extra || {}) };
        await chrome.storage.local.set({ modelsDownloaded });
        sendResponse({ ok: true });
        break;
      }

      case 'video-time':
        if (session.active && sender.tab?.id === session.tabId) {
          session.videoTime = msg.data?.time ?? session.videoTime;
        }
        sendResponse({ ok: true });
        break;

      case 'speech-start':
        if (session.active) session.speechStartTime = session.videoTime;
        sendResponse({ ok: true, time: session.videoTime });
        break;

      case 'get-video-time':
        sendResponse({ ok: true, time: session.videoTime });
        break;

      case 'check-cache-range': {
        const { t0, t1 } = msg.data || {};
        let cached = isRangeCached(session.lines, t0, t1);
        if (cached && session.config?.taskMode === 'translate') {
          const covering = session.lines.find((l) => {
            const a = l.t0 ?? 0;
            const b = l.t1 ?? a;
            return a - 0.4 <= t0 && b + 0.4 >= t1;
          });
          if (
            covering &&
            needsTranslation(covering, session.config.srcLang, session.config.tgtLang)
          ) {
            cached = false;
          }
        }
        sendResponse({ ok: true, cached, cacheMaxTime: session.cacheMaxTime });
        break;
      }

      case 'force-translate': {
        if (!session.active) {
          sendResponse({ ok: false, error: 'No active session' });
          break;
        }
        if (session.config?.taskMode !== 'translate') {
          sendResponse({ ok: false, error: 'Switch to + Translate mode in the panel' });
          break;
        }
        const retranslate = msg.data?.retranslate !== false;
        const lines = (msg.data?.lines?.length
          ? msg.data.lines
          : retranslate
            ? mergeLinesByTime(session.lines)
            : pickUntranslatedLines([session.lines], session.config.srcLang, session.config.tgtLang)
        )
          .map((l) => ({
            t0: l.t0 ?? 0,
            t1: l.t1 ?? (l.t0 ?? 0) + 2,
            src: sourceText(l),
            rawSrc: sourceText(l),
            rawTgt: translationText(l),
            tgt: translationText(l),
            ...(l.dir ? { dir: l.dir } : {}),
          }))
          .filter((l) => l.src);
        if (!lines.length) {
          sendResponse({ ok: false, error: 'No lines to translate' });
          break;
        }
        await ensureOffscreen();
        toOffscreen('force-translate', {
          lines,
          retranslate,
          config: session.config,
          settings: await getSettings(),
        });
        sendResponse({ ok: true, count: lines.length });
        break;
      }

      case 'force-translate-done':
        toContent('force-translate-done', msg.data);
        sendResponse({ ok: true });
        break;

      case 'perf-sample': {
        // Sampel waktu ASR/MT dari offscreen: teruskan ke panel dan simpan lokal
        // (dibatasi) supaya tab Performance bisa membandingkan mesin/bahasa antar sesi.
        const d = msg.data || {};
        toPanel('perf-sample', d);
        void (async () => {
          try {
            const { perfSamples = [] } = await chrome.storage.local.get('perfSamples');
            perfSamples.push(d);
            if (perfSamples.length > 3000) perfSamples.splice(0, perfSamples.length - 3000);
            await chrome.storage.local.set({ perfSamples });
          } catch (e) {
            console.warn('perf-sample store', e);
          }
        })();
        break;
      }

      case 'subtitle': {
        const d = msg.data;
        const dualLine = session.config?.dualLine ?? false;
        const formatted = applyDualLine({
          source: d.rawSource ?? d.source,
          translation: d.rawTranslation ?? d.translation,
          dualLine,
          taskMode: session.config?.taskMode,
        });
        toContent('subtitle', { ...d, ...formatted });
        toPanel('subtitle', { ...d, ...formatted });

        if (d.final && d.t0 != null) {
          const line = {
            t0: d.t0,
            t1: d.t1 ?? d.t0 + 2,
            src: (d.rawSource ?? d.source ?? '').trim(),
            tgt: (d.rawTranslation ?? '').trim(),
            // two-way lines remember which way they went; everything that
            // judges "is this translated?" reads it instead of session.config
            ...(d.dir?.src && d.dir?.tgt ? { dir: { src: d.dir.src, tgt: d.dir.tgt } } : {}),
          };
          if (!line.src && (d.rawTranslation ?? d.translation ?? '').trim()) {
            line.src = (d.rawTranslation ?? d.translation ?? '').trim();
          }
          session.lines = mergeLine(session.lines, line);
          session.cacheMaxTime = Math.max(session.cacheMaxTime, line.t1);
          // Jangan tunggu sesi berhenti: kalau worker mati, yang belum tersimpan hilang.
          void autosaveSession();
          if (session.cacheKey) {
            await appendToTranscriptCache(session.cacheKey, line, {
              url: session.tabUrl,
              title: session.tabTitle,
              srcLang: session.config?.srcLang,
              tgtLang: session.config?.tgtLang,
              taskMode: session.config?.taskMode,
            });
          }
          toContent('cache-cue', { cue: line, config: session.config });
        }
        sendResponse({ ok: true });
        break;
      }

      case 'pipeline-status':
        session.pipelineState = msg.data?.state || null;
        session.pipelineDevice = msg.data?.device || null;
        toPanel('pipeline-status', msg.data);
        toContent('pipeline-status', msg.data);
        sendResponse({ ok: true });
        break;

      // Content script menanyakan keadaan overlay saat ini — ketika baru
      // disuntikkan, dipulihkan dari bfcache, atau tabnya terlihat lagi —
      // supaya overlay tidak tertinggal kosong atau basi setelah ganti tab.
      // Hanya tab yang sedang disubtitle yang dijawab aktif.
      case 'content-sync': {
        const mine = session.active && sender?.tab?.id != null && sender.tab.id === session.tabId;
        sendResponse({
          active: mine,
          config: mine ? session.config : null,
          cacheCues: mine ? session.lines : [],
          cacheMaxTime: mine ? session.cacheMaxTime : 0,
          pipelineState: mine ? session.pipelineState || null : null,
          pipelineDevice: mine ? session.pipelineDevice || null : null,
        });
        break;
      }

      case 'pipeline-error':
        toPanel('error', msg.data);
        await stopSession('error');
        sendResponse({ ok: true });
        break;

      case 'capture-ended':
        await stopSession('capture-ended');
        sendResponse({ ok: true });
        break;

      case 'model-progress':
      case 'model-done':
      case 'model-error':
      case 'offline-line':
      case 'offline-progress':
      case 'offline-done':
      case 'offline-error':
        toPanel(msg.type, msg.data);
        sendResponse({ ok: true });
        break;

      case 'save-history':
        await saveHistory(msg.data);
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: `unknown message: ${msg.type}` });
    }
  })();

  return true;
});

// Live settings sync (dual-line toggle while session is running).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings || !session.active) return;
  const next = changes.settings.newValue || {};
  const prev = changes.settings.oldValue || {};
  if (next.dualLine !== prev.dualLine) {
    updateSessionConfig({ dualLine: next.dualLine });
  }
  if (next.refineTranslation !== prev.refineTranslation) {
    updateSessionConfig({ refineTranslation: next.refineTranslation });
  }
});
