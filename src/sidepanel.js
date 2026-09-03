// Side panel UI logic.
import {
  ASR_MODELS,
  DEFAULT_ASR,
  SOURCE_LANGS,
  TARGET_LANGS,
  MT_PAIRS,
  translationPlan,
  LANG_NAMES,
  pairLabel,
  DEFAULT_NATIVE_URL,
} from './lib/registry.js';
import { nativeHealth, nativeShutdown } from './lib/native.js';
import { nativeHostAction, nativeHostSupported } from './lib/native-host.js';
import { formatSrt, formatVtt, formatTxt } from './lib/transcript-cache.js';
import { loadExportDir, pickExportDir, clearExportDir, saveExportFile, exportDirLabel } from './lib/export.js';
import { stageFileToOpfs, needsNativeFilePath } from './lib/offline-io.js';
import { I18N } from './lib/i18n.js';
import { mountNotesPanel } from './notes-panel.js';
import { mountHelperStatusCard } from './helper-status.js';
import { exportBasename } from './lib/helper-status.js';

const $ = (id) => document.getElementById(id);

const state = {
  mode: 'realtime', // 'realtime' | 'offline'
  task: 'translate', // 'transcribe' | 'translate'
  srcLang: 'ja',
  tgtLang: 'en',
  settings: {
    uiLang: 'en',
    mirror: 'huggingface',
    device: 'auto',
    dualLine: false,
    refineTranslation: false,
    overlayFontSize: 24,
    asrModel: DEFAULT_ASR,
    engine: 'browser',
    nativeUrl: DEFAULT_NATIVE_URL,
  },
  downloaded: {},
  running: false,
  offlineRunning: false,
  offlineFile: null, // { name, size } once staged to OPFS
  offlineStaging: false,
  offlineLines: [],
  currentTab: null,
};

function t(key, ...args) {
  const v = I18N[state.settings.uiLang]?.[key] ?? I18N.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

function toBG(type, data) {
  return chrome.runtime.sendMessage({ target: 'bg', type, data }).catch(() => null);
}
function toOffscreen(type, data) {
  return toBG('to-offscreen', { type, data });
}

// ---------------------------------------------------------------------------
// i18n rendering
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

// ---------------------------------------------------------------------------
// selects
function fillSelects() {
  $('src-lang').innerHTML = SOURCE_LANGS.map(
    ([c, label]) => `<option value="${c}">${label}</option>`,
  ).join('');
  $('tgt-lang').innerHTML = TARGET_LANGS.map(
    ([c, label]) => `<option value="${c}">${label}</option>`,
  ).join('');
  $('src-lang').value = state.srcLang;
  $('tgt-lang').value = state.tgtLang;
}

// ---------------------------------------------------------------------------
// mode / task toggles
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#mode-toggle button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  $('rt-target').classList.toggle('hidden', mode !== 'realtime');
  $('btn-pick').classList.toggle('hidden', mode !== 'realtime');
  $('pick-hint').classList.add('hidden');
  $('off-drop').classList.toggle('hidden', mode !== 'offline');
  $('off-results').classList.toggle('hidden', mode !== 'offline' || state.offlineLines.length === 0);
  $('live-preview').classList.add('hidden');
  updateButtons();
  updateWarning();
  redrawHelperStatus?.();
}

function syncDualLineCheckboxes() {
  const on = !!state.settings.dualLine;
  $('dual-line-main').checked = on;
  $('dual-line').checked = on;
  updateLivePreviewLayout();
}

function syncRefineCheckboxes() {
  const on = !!state.settings.refineTranslation;
  $('refine-main').checked = on;
  $('refine').checked = on;
}

async function setRefineTranslation(on) {
  state.settings.refineTranslation = !!on;
  syncRefineCheckboxes();
  await saveSettings();
  persistLastConfig();
  updateWarning();
  await toBG('update-config', { refineTranslation: state.settings.refineTranslation });
}

function updateLivePreviewLayout() {
  const dual = !!state.settings.dualLine;
  $('live-src-box').classList.toggle('hidden', !dual);
  const srcLabel = $('live-src-box').querySelector('.live-box-label');
  const tgtLabel = $('live-tgt-box').querySelector('.live-box-label');
  if (srcLabel) srcLabel.classList.toggle('hidden', !dual);
  if (tgtLabel) tgtLabel.classList.toggle('hidden', !dual);
}

function clearLivePreview() {
  $('live-src-lines').innerHTML = '';
  $('live-tgt-lines').innerHTML = '';
  delete $('live-src-lines').dataset.interim;
  delete $('live-tgt-lines').dataset.interim;
}

async function setDualLine(on) {
  state.settings.dualLine = !!on;
  syncDualLineCheckboxes();
  await saveSettings();
  persistLastConfig();
  updateWarning();
  await toBG('update-config', { dualLine: state.settings.dualLine });
}

function setTask(task) {
  state.task = task;
  document.querySelectorAll('#task-toggle button').forEach((b) => {
    b.classList.toggle('active', b.dataset.task === task);
  });
  $('tgt-col').style.opacity = task === 'translate' ? '1' : '0.4';
  $('tgt-lang').disabled = task !== 'translate';
  updateWarning();
  redrawHelperStatus?.();
}

// ---------------------------------------------------------------------------
// warning banner: does the current config need a model that isn't downloaded?
function updateWarning() {
  const el = $('model-warning');
  const cfg = currentConfig();
  const issues = [];
  const native = state.settings.engine === 'native';

  if (native) {
    if (!nativeInfo) issues.push({ msg: t('nativeOffline') });
  } else if (!state.downloaded[state.settings.asrModel]) {
    const m = ASR_MODELS[state.settings.asrModel];
    issues.push({
      msg: t('needAsrModel', `${m.label} (${m.webgpuOnly || state.settings.device !== 'wasm' ? m.sizeWebgpu : m.sizeWasm})`),
      key: state.settings.asrModel,
      btn: `${m.label}`,
    });
  }

  let directNote = '';
  if (cfg.taskMode === 'translate') {
    const plan = translationPlan(cfg.srcLang, cfg.tgtLang, {
      dualLine: cfg.dualLine,
      refineTranslation: cfg.refineTranslation,
    });
    if (plan.mode === 'whisper-direct') {
      directNote = `<span style="opacity:.85">${t('directNote')}</span>`;
    } else if (cfg.refineTranslation) {
      directNote = `<span style="opacity:.85">${t('refineNote')}</span>`;
    } else if (plan.mode === 'mt') {
      const label = pairLabel(`${cfg.srcLang}-${cfg.tgtLang}`);
      if (plan.pivot) {
        if (!state.downloaded[plan.pivot.leg1Key]) {
          issues.push({
            msg: t('needMtModel', `${pairLabel(plan.pivot.leg1Key)} (${plan.pivot.leg1.size})`),
            key: plan.pivot.leg1Key,
            btn: pairLabel(plan.pivot.leg1Key),
          });
        }
        if (!state.downloaded[plan.pivot.leg2Key]) {
          issues.push({
            msg: t('needMtModel', `${pairLabel(plan.pivot.leg2Key)} (${plan.pivot.leg2.size})`),
            key: plan.pivot.leg2Key,
            btn: pairLabel(plan.pivot.leg2Key),
          });
        }
      } else if (!plan.pair) {
        issues.push({
          msg: `No local translation model exists for ${label}. The browser's built-in translator or native helper LLM will be tried; otherwise pick another pair.`,
        });
      } else if (!state.downloaded[plan.pairKey]) {
        issues.push({
          msg: t('needMtModel', `${label} (${plan.pair.size})`),
          key: plan.pairKey,
          btn: label,
        });
      }
    }
  }

  if (issues.length === 0 && !directNote) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const buttons = issues
    .filter((i) => i.key)
    .map(
      (i) =>
        `<button class="mini-btn dl-now" data-key="${i.key}">⬇ ${t('download')} — ${i.btn}</button>`,
    )
    .join(' ');
  el.innerHTML = [issues.map((i) => i.msg).join('<br>'), buttons, directNote]
    .filter(Boolean)
    .join('<br>');
  el.classList.remove('hidden');
  el.querySelectorAll('.dl-now').forEach((b) => {
    b.addEventListener('click', () => startDownload(b.dataset.key));
  });
}

// Remembered so the right-click context-menu start can reuse the last choices.
function persistLastConfig() {
  chrome.storage.local
    .set({
      lastConfig: {
        srcLang: state.srcLang,
        tgtLang: state.tgtLang,
        taskMode: state.task,
        dualLine: state.settings.dualLine,
        refineTranslation: state.settings.refineTranslation,
        asrModel: state.settings.asrModel,
      },
    })
    .catch(() => {});
}

function currentConfig() {
  return {
    tabId: state.currentTab?.id,
    srcLang: state.srcLang,
    tgtLang: state.tgtLang,
    taskMode: state.task,
    dualLine: state.settings.dualLine,
    refineTranslation: state.settings.refineTranslation,
    asrModel: state.settings.asrModel,
  };
}

// ---------------------------------------------------------------------------
// downloads — several can run at once; each gets its own labelled bar.
const dlState = new Map(); // key -> {pct, loaded, total, done}

function labelForKey(key) {
  if (ASR_MODELS[key]) return ASR_MODELS[key].label;
  if (MT_PAIRS[key]) return pairLabel(key);
  return key;
}

function startDownload(key) {
  if (dlState.get(key) && !dlState.get(key).done) return; // already running
  dlState.set(key, { pct: 0, loaded: 0, total: 0 });
  renderDlList();
  renderModelLists();
  toOffscreen('model-download', { key });
}

function renderDlList() {
  const host = $('dl-list');
  const entries = [...dlState.entries()];
  host.classList.toggle('hidden', entries.length === 0);
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  host.innerHTML = '';
  for (const [key, d] of entries) {
    const pct = Math.round(d.pct || 0);
    const row = document.createElement('div');
    row.className = 'dl-row' + (d.done ? ' done' : '');
    const detail = d.done
      ? '✓'
      : d.total
        ? `${mb(d.loaded)} / ${mb(d.total)} MB · ${pct}%`
        : `${pct}%`;
    row.innerHTML = `
      <div class="dl-label"><span></span><span class="pct">${detail}</span></div>
      <div class="bar"><div class="fill" style="width:${d.done ? 100 : pct}%"></div></div>`;
    row.querySelector('.dl-label span').textContent = `⬇ ${t('downloading')}: ${labelForKey(key)}`;
    host.appendChild(row);
  }
}

function onModelProgress(d) {
  if (!d || !d.key) return;
  const cur = dlState.get(d.key) || {};
  dlState.set(d.key, { ...cur, pct: d.pct ?? cur.pct, loaded: d.loaded ?? cur.loaded, total: d.total ?? cur.total });
  renderDlList();
  // update the settings-modal row in place, if visible
  const st = document.querySelector(`.m-state[data-key="${d.key}"]`);
  if (st) st.textContent = `${Math.round(dlState.get(d.key).pct || 0)}%`;
}

async function onModelDone(d) {
  if (d.deleted) {
    dlState.delete(d.key);
  } else {
    dlState.set(d.key, { ...(dlState.get(d.key) || {}), pct: 100, done: true });
    setTimeout(() => {
      dlState.delete(d.key);
      renderDlList();
    }, 2500);
  }
  renderDlList();
  await refreshDownloaded();
  renderModelLists();
  updateWarning();
}

async function refreshDownloaded() {
  const { modelsDownloaded = {} } = await chrome.storage.local.get('modelsDownloaded');
  state.downloaded = modelsDownloaded;
}

// ---------------------------------------------------------------------------
// model manager (settings modal)
function renderModelLists() {
  const asrHost = $('asr-models');
  asrHost.innerHTML = '';
  for (const [key, m] of Object.entries(ASR_MODELS)) {
    const size = m.webgpuOnly ? m.sizeWebgpu : `${m.sizeWasm} / ${m.sizeWebgpu}`;
    asrHost.appendChild(modelRow(key, m.label, `${size} · ${m.note}`));
  }
  const mtHost = $('mt-models');
  mtHost.innerHTML = '';
  for (const [key, p] of Object.entries(MT_PAIRS)) {
    mtHost.appendChild(modelRow(key, pairLabel(key), `${key} · Opus-MT · ${p.size}`));
  }
}

function modelRow(key, name, sub) {
  const div = document.createElement('div');
  div.className = 'm-item';
  const isDl = !!state.downloaded[key];
  const isActive = key === state.settings.asrModel && ASR_MODELS[key];
  const dl = dlState.get(key);
  const downloading = dl && !dl.done;
  div.innerHTML = `
    <div class="m-meta">
      <div class="m-name">${name}${isActive ? ' ✓' : ''}</div>
      <div class="m-sub">${sub}</div>
    </div>
    <span class="m-state ${isDl ? 'done' : ''}" data-key="${key}">${
      downloading ? Math.round(dl.pct || 0) + '%' : isDl ? '✅' : ''
    }</span>
    ${
      ASR_MODELS[key] && !isActive
        ? `<button class="mini-btn use-btn" data-key="${key}">Use</button>`
        : ''
    }
    <button class="mini-btn act-btn" data-key="${key}" ${downloading ? 'disabled' : ''}>${
      downloading ? '…' : isDl ? t('delete') : '⬇ ' + t('download')
    }</button>
  `;
  div.querySelector('.act-btn').addEventListener('click', () => {
    if (state.downloaded[key]) {
      toOffscreen('model-delete', { key });
    } else {
      startDownload(key);
    }
  });
  div.querySelector('.use-btn')?.addEventListener('click', async () => {
    state.settings.asrModel = key;
    await saveSettings();
    renderModelLists();
    updateWarning();
  });
  return div;
}

// ---------------------------------------------------------------------------
// settings
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings) Object.assign(state.settings, settings);
  document.querySelectorAll('#ui-lang-toggle button').forEach((b) =>
    b.classList.toggle('active', b.dataset.lang === state.settings.uiLang),
  );
  document.querySelectorAll('#mirror-toggle button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mirror === state.settings.mirror),
  );
  document.querySelectorAll('#device-toggle button').forEach((b) =>
    b.classList.toggle('active', b.dataset.device === state.settings.device),
  );
  document.querySelectorAll('#engine-toggle button').forEach((b) =>
    b.classList.toggle('active', b.dataset.engine === (state.settings.engine || 'browser')),
  );
  $('native-block').classList.toggle('hidden', state.settings.engine !== 'native');
  $('native-url').value = state.settings.nativeUrl || DEFAULT_NATIVE_URL;
  syncDualLineCheckboxes();
  syncRefineCheckboxes();
  $('font-size').value = state.settings.overlayFontSize;
}

let nativeInfo = null; // last /health result (null = offline/unknown)
/** @type {null | (() => void)} */
let redrawHelperStatus = null;
let nativePollTimer = null;
let nativeBusy = false;
let lastNativeAutoStartMs = 0;
const NATIVE_AUTO_START_COOLDOWN_MS = 30_000;
let labEnsureAttempted = false;

async function tryAutoStartNative() {
  if (nativeBusy || !nativeHostSupported()) return false;
  const now = Date.now();
  if (now - lastNativeAutoStartMs < NATIVE_AUTO_START_COOLDOWN_MS) return false;
  lastNativeAutoStartMs = now;
  try {
    const res = await nativeHostAction('start', { timeoutMs: 90_000 });
    return !!res?.ok;
  } catch (e) {
    console.warn('native auto-start failed', e);
    return false;
  }
}

async function tryEnsureLab() {
  if (labEnsureAttempted || nativeBusy || !nativeHostSupported() || !nativeInfo) return;
  labEnsureAttempted = true;
  try {
    await nativeHostAction('ensure_lab', { timeoutMs: 30_000 });
  } catch (e) {
    console.warn('lab ensure failed', e);
  }
}

function setNativeUi({ running, busy, detail }) {
  const dot = $('native-status-dot');
  const st = $('native-status');
  dot.className = 'status-dot ' + (busy ? 'busy' : running ? 'on' : 'off');
  st.className = 'native-status ' + (busy ? '' : running ? 'on' : 'off');
  st.textContent = detail;
  $('btn-native-start').disabled = busy || running;
  $('btn-native-stop').disabled = busy || !running;
  $('btn-native-restart').disabled = busy;
}

async function checkNative({ allowAutoStart = false } = {}) {
  if (nativeBusy) return nativeInfo;
  setNativeUi({ running: !!nativeInfo, busy: true, detail: t('nativeChecking') });
  nativeInfo = await nativeHealth(state.settings.nativeUrl || DEFAULT_NATIVE_URL);
  if (!nativeInfo && allowAutoStart) {
    const started = await tryAutoStartNative();
    if (started) nativeInfo = await nativeHealth(state.settings.nativeUrl || DEFAULT_NATIVE_URL);
  }
  if (nativeInfo) {
    const stale =
      nativeInfo.translate &&
      nativeInfo.features &&
      nativeInfo.features.translate_refine === false;
    // #region agent log
    fetch('http://127.0.0.1:7615/ingest/6dcc605f-4b08-497b-ae3f-ba4a5887e064',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'89e0f7'},body:JSON.stringify({sessionId:'89e0f7',runId:'pre-fix',hypothesisId:'A',location:'sidepanel.js:checkNative',message:'native check result',data:{online:true,engine:nativeInfo.engine,stale,features:nativeInfo.features},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setNativeUi({
      running: true,
      busy: false,
      detail: stale
        ? t('nativeStale', 'Helper running — click Restart to load latest features')
        : t(
            'nativeOnline',
            `${nativeInfo.engine} · ${nativeInfo.model}${nativeInfo.translate ? ' · +LLM translate' : ''}${nativeInfo.ffmpeg ? '' : ' · ⚠ no ffmpeg'}`,
          ),
    });
    tryEnsureLab();
  } else {
    // #region agent log
    fetch('http://127.0.0.1:7615/ingest/6dcc605f-4b08-497b-ae3f-ba4a5887e064',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'89e0f7'},body:JSON.stringify({sessionId:'89e0f7',runId:'pre-fix',hypothesisId:'C',location:'sidepanel.js:checkNative',message:'native check offline',data:{url:state.settings.nativeUrl||DEFAULT_NATIVE_URL},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setNativeUi({ running: false, busy: false, detail: t('nativeOffline') });
  }
  updateWarning();
  updateNativeHostHint();
  redrawHelperStatus?.();
  return nativeInfo;
}

function updateNativeHostHint() {
  const el = $('native-host-hint');
  if (!nativeHostSupported()) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = t('nativeHostHint');
  el.classList.toggle('hidden', !!nativeInfo);
}

function startNativePoll() {
  stopNativePoll();
  nativePollTimer = setInterval(() => checkNative({ allowAutoStart: true }), 5000);
}

function stopNativePoll() {
  if (nativePollTimer) {
    clearInterval(nativePollTimer);
    nativePollTimer = null;
  }
}

async function nativeControl(action) {
  if (nativeBusy) return;
  nativeBusy = true;
  const url = state.settings.nativeUrl || DEFAULT_NATIVE_URL;
  setNativeUi({
    running: !!nativeInfo,
    busy: true,
    detail: action === 'start' ? t('nativeStarting') : action === 'stop' ? t('nativeStopping') : t('nativeRestarting'),
  });
  try {
    if (nativeHostSupported()) {
      // #region agent log
      fetch('http://127.0.0.1:7615/ingest/6dcc605f-4b08-497b-ae3f-ba4a5887e064',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'89e0f7'},body:JSON.stringify({sessionId:'89e0f7',runId:'post-fix',hypothesisId:'F',location:'sidepanel.js:nativeControl',message:'native host action',data:{action},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const res = await nativeHostAction(action, { timeoutMs: 130_000 });
      if (!res?.ok) throw new Error(res?.error || 'Native host failed');
    } else if (action === 'stop') {
      await nativeShutdown(url);
      await new Promise((r) => setTimeout(r, 400));
    } else {
      throw new Error(t('nativeHostMissing'));
    }
    await checkNative();
  } catch (e) {
    setNativeUi({ running: false, busy: false, detail: String(e.message || e) });
    updateNativeHostHint();
  } finally {
    nativeBusy = false;
  }
}

async function saveSettings() {
  await chrome.storage.local.set({ settings: state.settings });
}

// ---------------------------------------------------------------------------
// realtime session
async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && /^https?:/.test(tab.url || '')) {
    state.currentTab = tab;
    $('tab-title').textContent = tab.title || tab.url;
    $('tab-url').textContent = tab.url;
    $('tab-favicon').src = tab.favIconUrl || 'icons/icon16.png';
  } else {
    state.currentTab = null;
    $('tab-title').textContent = t('noTab');
    $('tab-url').textContent = '';
    $('tab-favicon').src = 'icons/icon16.png';
  }
  updateButtons();
}

function updateButtons() {
  const running = state.mode === 'realtime' ? state.running : state.offlineRunning;
  $('btn-start').disabled =
    running ||
    state.offlineStaging ||
    (state.mode === 'realtime' ? !state.currentTab : !state.offlineFile);
  $('btn-stop').disabled = !running;
  $('btn-stop').textContent = state.mode === 'offline' ? t('cancelTask') : t('endTask');
}

function setStatus(text, cls = '') {
  const el = $('status-line');
  el.textContent = text;
  el.className = 'status-line ' + cls;
}

async function startWithStream(streamId, captureType) {
  setStatus(t('loadingModels'));
  clearLivePreview();
  $('live-preview').classList.remove('hidden');
  const res = await toBG('panel-start-realtime', {
    ...currentConfig(),
    streamId,
    captureType,
  });
  if (res?.ok) {
    state.running = true;
    $('pick-hint').classList.add('hidden');
    updateButtons();
  } else if (res?.error) {
    showCaptureError(res.error);
  }
}

function showCaptureError(message) {
  const blocked = /invoked|activeTab|not been invoked/i.test(message);
  setStatus(blocked ? t('needInvoke') : message, 'error');
  if (blocked) {
    $('pick-hint').textContent = t('pickHint');
    $('pick-hint').classList.remove('hidden');
  }
}

// Teams-style manual picker: the user chooses a tab/window/screen and whether
// to share its audio. The picker itself is the consent, so this path never
// hits the "extension has not been invoked" restriction.
function onPickManually() {
  if (!chrome.desktopCapture?.chooseDesktopMedia) {
    setStatus('desktopCapture API unavailable in this browser.', 'error');
    return;
  }
  $('pick-hint').textContent = t('pickHint');
  $('pick-hint').classList.remove('hidden');
  chrome.desktopCapture.chooseDesktopMedia(['tab', 'window', 'screen', 'audio'], (streamId, opts) => {
    if (!streamId) {
      setStatus(t('cancelled'));
      return;
    }
    if (opts && opts.canRequestAudioTrack === false) {
      setStatus(t('noAudioShared'), 'error');
      return;
    }
    startWithStream(streamId, 'desktop');
  });
}

async function onStart() {
  if (state.mode === 'realtime') {
    if (!state.currentTab) return;
    persistLastConfig();
    let streamId = null;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: state.currentTab.id,
      });
    } catch (e) {
      const m = String(e?.message || e);
      if (/invoked|activeTab/i.test(m)) {
        showCaptureError(m);
        onPickManually();
        return;
      }
    }
    await startWithStream(streamId, 'tab');
  } else {
    if (state.offlineStaging) {
      setStatus(t('stagingFile'));
      return;
    }
    if (!state.offlineFile) {
      setStatus(t('pickFile'), 'error');
      return;
    }
    setStatus(t('processing'));
    state.offlineLines = [];
    $('off-lines').innerHTML = '';
    $('off-results').classList.remove('hidden');
    $('off-progress-text').textContent = '…';
    try {
      await toBG('ensure-offscreen', {});
      toOffscreen('offline-process', {
        name: state.offlineFile.name,
        size: state.offlineFile.size,
        config: currentConfig(),
      });
      state.offlineRunning = true;
      updateButtons();
    } catch (e) {
      setStatus(String(e?.message || e), 'error');
    }
  }
}

async function onStop() {
  if (state.mode === 'realtime') {
    await toBG('panel-stop', {});
    state.running = false;
    setStatus('');
    updateButtons();
  } else {
    toOffscreen('offline-cancel', {});
  }
}

// ---------------------------------------------------------------------------
// offline file picking
function wireDropzone() {
  const dz = $('off-drop');
  const input = $('off-file');
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => pickFile(input.files[0]));
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]);
  });
}

async function stageOfflineFile(file) {
  await stageFileToOpfs(file, (loaded, total) => {
    if (!total) return;
    const pct = Math.min(100, Math.round((loaded / total) * 100));
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    $('off-filename').textContent = `${file.name} (${sizeMb} MB) — ${t('stagingFilePct', pct)}`;
  });
}

async function pickFile(file) {
  if (!file) return;
  state.offlineFile = null;
  state.offlineStaging = true;
  const sizeMb = (file.size / 1024 / 1024).toFixed(1);
  $('off-filename').textContent = `${file.name} (${sizeMb} MB) — ${t('stagingFile')}`;
  updateButtons();
  try {
    await stageOfflineFile(file);
    state.offlineFile = { name: file.name, size: file.size };
    $('off-filename').textContent = `${file.name} (${sizeMb} MB)`;
    if (needsNativeFilePath(file.size)) {
      setStatus(t('fileTooLarge'), 'error');
    } else {
      setStatus('');
    }
  } catch (e) {
    state.offlineFile = null;
    const msg = String(e?.message || e);
    setStatus(/could not be read|NotReadableError/i.test(msg) ? t('fileReadError') : msg, 'error');
    $('off-filename').textContent = t('dropHint');
  } finally {
    state.offlineStaging = false;
    updateButtons();
  }
}

// ---------------------------------------------------------------------------
// subtitle stream + offline results
function appendLiveLine(host, text) {
  if (!text) return;
  const div = document.createElement('div');
  div.className = 'line';
  div.textContent = text;
  host.appendChild(div);
  while (host.children.length > 30) host.firstChild.remove();
  host.scrollTop = host.scrollHeight;
}

function setLiveInterim(host, text) {
  if (!text) {
    delete host.dataset.interim;
    const existing = host.querySelector('.line.interim');
    if (existing) existing.remove();
    return;
  }
  let div = host.querySelector('.line.interim');
  if (!div) {
    div = document.createElement('div');
    div.className = 'line interim';
    host.appendChild(div);
  }
  div.textContent = text;
  host.dataset.interim = '1';
  host.scrollTop = host.scrollHeight;
}

function pushLive({ source, translation, interim, partial }) {
  if (interim && partial) {
    if (source) setLiveInterim($('live-src-lines'), source);
    if (translation) setLiveInterim($('live-tgt-lines'), translation);
    return;
  }
  if (interim) return;
  setLiveInterim($('live-src-lines'), '');
  setLiveInterim($('live-tgt-lines'), '');
  if (source) appendLiveLine($('live-src-lines'), source);
  if (translation) appendLiveLine($('live-tgt-lines'), translation);
}

function fmtTs(sec, srtStyle = false) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return srtStyle ? `${h}:${m}:${s},${f}` : `${h}:${m}:${s}.${f}`;
}

function pushOfflineLine({ line, idx, total }) {
  state.offlineLines.push(line);
  const host = $('off-lines');
  const div = document.createElement('div');
  div.innerHTML = `<div class="ts">${fmtTs(line.t0)} → ${fmtTs(line.t1)}</div>`;
  if (line.src) {
    const s = document.createElement('div');
    s.className = 'l-src';
    s.textContent = line.src;
    div.appendChild(s);
  }
  const tt = document.createElement('div');
  tt.className = 'l-tgt';
  tt.textContent = line.tgt || line.src;
  div.appendChild(tt);
  host.appendChild(div);
  host.scrollTop = host.scrollHeight;
  $('off-progress-text').textContent = `${idx} / ${total}`;
}

function exportLines(kind) {
  const lines = state.offlineLines;
  if (!lines.length) return;
  exportSession({ lines, title: state.offlineFile?.name, url: '', kind });
}

async function exportSession({ lines, title, url, kind, dualLine }) {
  const meta = { url: url || '', title: title || 'subtitles', dualLine: dualLine ?? state.settings.dualLine };
  const norm = (lines || []).map((l) => ({
    t0: l.t0 ?? 0,
    t1: l.t1 ?? l.t0 + 3,
    src: l.src || l.source || '',
    tgt: l.tgt || l.translation || '',
  }));
  let out = '';
  if (kind === 'srt') out = formatSrt(norm, meta);
  else if (kind === 'vtt') out = formatVtt(norm, meta);
  else out = formatTxt(norm, meta);
  const safe = exportBasename(title || 'subtitles', kind).replace(/\.(srt|vtt|txt)$/i, '');
  const name = `${safe}.${kind}`;
  const res = await saveExportFile(name, out);
  if (res.saved) setStatus(t('savedTo', res.path), 'ok');
}

// ---------------------------------------------------------------------------
// history
async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  const host = $('history-list');
  host.innerHTML = '';
  if (!history.length) {
    host.innerHTML = `<div class="empty">${t('noHistory')}</div>`;
    return;
  }
  for (const h of history) {
    const div = document.createElement('div');
    div.className = 'h-item';
    const when = new Date(h.ts).toLocaleString();
    const maxT = h.lines?.length
      ? Math.max(...h.lines.map((l) => l.t1 ?? (l.t ?? 0) / 1000))
      : 0;
    div.innerHTML = `
      <div class="h-title"></div>
      <div class="h-url"></div>
      <div class="h-meta">
        <span>${h.mode === 'realtime' ? '🔴' : '📁'} ${when}</span>
        <span>${h.srcLang || ''}${h.tgtLang ? ' → ' + h.tgtLang : ''}</span>
        <span>${h.lines?.length || 0} ${t('lines')}${maxT ? ` · ${fmtTs(maxT)}` : ''}</span>
      </div>
      <div class="h-actions">
        <button class="mini-btn h-txt">TXT</button>
        <button class="mini-btn h-srt">SRT</button>
        <button class="mini-btn h-vtt">VTT</button>
        <button class="mini-btn h-del">🗑</button>
      </div>`;
    div.querySelector('.h-title').textContent = h.title || '(untitled)';
    const urlEl = div.querySelector('.h-url');
    if (h.url) {
      urlEl.textContent = h.url;
    } else {
      urlEl.remove();
    }
    div.querySelector('.h-txt').addEventListener('click', (e) => {
      e.stopPropagation();
      exportHistory(h, 'txt');
    });
    div.querySelector('.h-srt').addEventListener('click', (e) => {
      e.stopPropagation();
      exportHistory(h, 'srt');
    });
    div.querySelector('.h-vtt').addEventListener('click', (e) => {
      e.stopPropagation();
      exportHistory(h, 'vtt');
    });
    div.querySelector('.h-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      await toBG('delete-history', { id: h.id, cacheKey: h.id });
      renderHistory();
    });
    host.appendChild(div);
  }
}

function exportHistory(h, kind) {
  exportSession({
    lines: h.lines || [],
    title: h.title,
    url: h.url,
    kind,
  });
}

async function refreshExportFolderUi() {
  await loadExportDir();
  const label = exportDirLabel();
  $('export-folder-label').textContent = label ? `${t('exportFolderSet')}: ${label}` : t('exportFolderNone');
  $('btn-clear-export-folder').classList.toggle('hidden', !label);
}

// ---------------------------------------------------------------------------
// incoming messages
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'panel') return;
  switch (msg.type) {
    case 'state':
      state.running = !!msg.data.active;
      updateButtons();
      if (!state.running && state.mode === 'realtime') setStatus('');
      break;
    case 'subtitle':
      pushLive(msg.data);
      break;
    case 'pipeline-status': {
      const s = msg.data?.state;
      if (s === 'loading') setStatus(t('loadingModels'));
      else if (s === 'listening')
        setStatus(`${t('listening')} (${msg.data.device || ''})`, 'ok');
      break;
    }
    case 'error':
      setStatus(msg.data?.message || 'Error', 'error');
      state.running = false;
      updateButtons();
      break;
    case 'model-progress':
      onModelProgress(msg.data);
      break;
    case 'model-done':
      onModelDone(msg.data);
      break;
    case 'model-error':
      dlState.delete(msg.data?.key);
      renderDlList();
      renderModelLists();
      setStatus(`Model: ${msg.data?.message || 'download failed'}`, 'error');
      break;
    case 'offline-line':
      pushOfflineLine(msg.data);
      break;
    case 'offline-progress': {
      const d = msg.data;
      if (d.stage === 'transcribe' && d.total) {
        setStatus(`${t('processing')} ${d.idx || 0}/${d.total}`);
      } else {
        setStatus(`${t('processing')} (${d.stage})`);
      }
      break;
    }
    case 'offline-done':
      state.offlineRunning = false;
      setStatus(t('done'), 'ok');
      updateButtons();
      renderHistory();
      break;
    case 'offline-error':
      state.offlineRunning = false;
      setStatus(msg.data?.cancelled ? t('cancelled') : msg.data?.message || 'Error', msg.data?.cancelled ? '' : 'error');
      updateButtons();
      break;
    case 'history-updated':
      renderHistory();
      break;
    case 'cache-resume':
      setStatus(t('cacheResume', fmtTs(msg.data?.cacheMaxTime || 0), msg.data?.lineCount || 0), 'ok');
      break;
  }
});

// ---------------------------------------------------------------------------
// wiring
function wire() {
  document.querySelectorAll('#mode-toggle button').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)),
  );
  document.querySelectorAll('#task-toggle button').forEach((b) =>
    b.addEventListener('click', () => setTask(b.dataset.task)),
  );
  $('src-lang').addEventListener('change', (e) => {
    state.srcLang = e.target.value;
    updateWarning();
    persistLastConfig();
  });
  $('tgt-lang').addEventListener('change', (e) => {
    state.tgtLang = e.target.value;
    updateWarning();
    persistLastConfig();
  });
  $('btn-start').addEventListener('click', onStart);
  $('btn-stop').addEventListener('click', onStop);
  $('btn-pick').addEventListener('click', onPickManually);
  $('btn-srt').addEventListener('click', () => exportLines('srt'));
  $('btn-vtt').addEventListener('click', () => exportLines('vtt'));
  $('btn-txt').addEventListener('click', () => exportLines('txt'));
  $('btn-pick-export-folder').addEventListener('click', async () => {
    try {
      await pickExportDir();
      await refreshExportFolderUi();
    } catch (e) {
      setStatus(String(e.message || e), 'error');
    }
  });
  $('btn-clear-export-folder').addEventListener('click', async () => {
    await clearExportDir();
    await refreshExportFolderUi();
  });

  $('btn-settings').addEventListener('click', () => {
    $('settings-modal').classList.remove('hidden');
    lastNativeAutoStartMs = 0;
    labEnsureAttempted = false;
    checkNative({ allowAutoStart: true });
    startNativePoll();
    $('about-block').classList.add('hidden');
    renderModelLists();
  });
  $('btn-close-settings').addEventListener('click', () => {
    $('settings-modal').classList.add('hidden');
    stopNativePoll();
  });
  $('btn-about').addEventListener('click', () => {
    $('settings-modal').classList.remove('hidden');
    $('about-block').classList.remove('hidden');
    $('about-block').scrollIntoView({ behavior: 'smooth' });
  });

  document.querySelectorAll('#ui-lang-toggle button').forEach((b) =>
    b.addEventListener('click', async () => {
      state.settings.uiLang = b.dataset.lang;
      await saveSettings();
      await loadSettings();
      applyI18n();
      updateWarning();
      renderHistory();
    }),
  );
  document.querySelectorAll('#mirror-toggle button').forEach((b) =>
    b.addEventListener('click', async () => {
      state.settings.mirror = b.dataset.mirror;
      await saveSettings();
      await loadSettings();
    }),
  );
  document.querySelectorAll('#device-toggle button').forEach((b) =>
    b.addEventListener('click', async () => {
      state.settings.device = b.dataset.device;
      await saveSettings();
      await loadSettings();
      updateWarning();
    }),
  );
  document.querySelectorAll('#engine-toggle button').forEach((b) =>
    b.addEventListener('click', async () => {
      state.settings.engine = b.dataset.engine;
      await saveSettings();
      await loadSettings();
      updateWarning();
      if (state.settings.engine === 'native') {
        lastNativeAutoStartMs = 0;
        labEnsureAttempted = false;
        checkNative({ allowAutoStart: true });
        if (!$('settings-modal').classList.contains('hidden')) startNativePoll();
      } else {
        stopNativePoll();
      }
    }),
  );
  $('native-url').addEventListener('change', async (e) => {
    state.settings.nativeUrl = e.target.value.trim() || DEFAULT_NATIVE_URL;
    await saveSettings();
    checkNative();
  });
  $('btn-native-check').addEventListener('click', checkNative);
  $('btn-native-start').addEventListener('click', () => nativeControl('start'));
  $('btn-native-stop').addEventListener('click', () => nativeControl('stop'));
  $('btn-native-restart').addEventListener('click', () => nativeControl('restart'));
  $('dual-line-main').addEventListener('change', (e) => setDualLine(e.target.checked));
  $('dual-line').addEventListener('change', (e) => setDualLine(e.target.checked));
  $('refine-main').addEventListener('change', (e) => setRefineTranslation(e.target.checked));
  $('refine').addEventListener('change', (e) => setRefineTranslation(e.target.checked));
  $('font-size').addEventListener('change', async (e) => {
    state.settings.overlayFontSize = Number(e.target.value);
    await saveSettings();
  });

  wireDropzone();

  chrome.tabs.onActivated.addListener(refreshTab);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.status === 'complete' || info.title) refreshTab();
  });
}

// ---------------------------------------------------------------------------
async function init() {
  await loadSettings();
  wire();
  fillSelects();
  applyI18n();
  setMode('realtime');
  setTask('translate');
  await refreshDownloaded();
  renderModelLists();
  updateWarning();
  if (state.settings.engine === 'native' || state.mode === 'offline') {
    checkNative({ allowAutoStart: true });
    updateNativeHostHint();
  }
  await refreshTab();
  await refreshExportFolderUi();
  await renderHistory();
  const notesMount = $('notes-mount');
  if (notesMount) await mountNotesPanel(notesMount);
  const helperMount = $('helper-status-mount');
  if (helperMount) {
    redrawHelperStatus = mountHelperStatusCard(helperMount, () => ({
      online: !!nativeInfo,
      health: nativeInfo,
      engine: state.settings.engine || 'browser',
      task: state.task,
      mode: state.mode,
    }));
  }
  // resync with a session that may already be running
  const s = await toBG('get-state', {});
  if (s?.active) {
    state.running = true;
    if (s.config) {
      state.srcLang = s.config.srcLang;
      state.tgtLang = s.config.tgtLang;
      state.settings.dualLine = s.config.dualLine ?? state.settings.dualLine;
      state.settings.refineTranslation = s.config.refineTranslation ?? state.settings.refineTranslation;
      $('src-lang').value = state.srcLang;
      $('tgt-lang').value = state.tgtLang;
      syncDualLineCheckboxes();
      syncRefineCheckboxes();
    }
    $('live-preview').classList.remove('hidden');
    setStatus(t('listening'), 'ok');
    updateButtons();
  }
  await toBG('ensure-offscreen', {});
}

init();
