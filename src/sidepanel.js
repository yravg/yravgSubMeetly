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
  UI_LANGS,
  uniqueLangEntries,
} from './lib/registry.js';
import {
  nativeHealth,
  nativeShutdown,
  nativeGetUiPrefs,
  nativeSetUiPrefs,
  nativeGetModels,
  nativePullModel,
  nativeSetModels,
  nativeSetModelLocation,
  nativeGetDevice,
  nativeSetDevice,
  HELPER_DEVICE_OPTIONS,
} from './lib/native.js';
import { nativeHostAction, nativeHostConnection, nativeHostSupported } from './lib/native-host.js';
import { classifyNativeHostError, hostInstalledFromState } from './lib/native-protocol.js';
import { formatSrt, formatVtt, formatTxt } from './lib/transcript-cache.js';
import { searchSessions, matchingLines } from './lib/session-search.js';
import { formatMarkdown, formatCsv, formatJson } from './lib/export-formats.js';
import { loadExportDir, pickExportDir, clearExportDir, saveExportFile, exportDirLabel } from './lib/export.js';
import {
  normalizeExportOptions,
  applyExportOptions,
  exportFilename,
} from './lib/export-options.js';
import { stageFileToOpfs, needsNativeFilePath } from './lib/offline-io.js';
import { I18N } from './lib/i18n.js';
import { watchEngineWording } from './lib/engine-wording.js';
import { normalizeInterpreter } from './lib/interpreter.js';
import { mountNotesPanel, loadProjectTypePref } from './notes-panel.js';
import { startEngineSync, engineOrigin } from './lib/engine-sync.js';
import { makeT as makeNotesT } from './lib/notes-i18n.js';
import { classifyError, errTitleKey, errHintKey } from './lib/friendly-error.js';
import { makeResizable } from './lib/resizable.js';
import { mountPerfPanel } from './perf-panel.js';
import { mountHelperStatusCard } from './helper-status.js';
import { mountHelperGuide } from './helper-guide.js';
import { detectOs } from './lib/helper-status.js';
import {
  loadSampleCatalog,
  firstSampleForPair,
  fetchSampleFile,
} from './lib/qa-samples.js';
import { tile as colourTile } from './lib/colour-icons.js';
import { renderFeatureMap } from './lib/feature-map.js';
import { mountAddinsPane, glossaryCaption } from './addins-ui.js';
import { markedHtml } from './lib/glossary.js';
import { springProgress, slidingNumber, autoHeight, highlight } from './lib/motion.js';

const $ = (id) => document.getElementById(id);

const state = {
  sessionTab: null, // tab yang sedang disubtitle selagi sesi realtime hidup
  mode: 'realtime', // 'realtime' | 'offline'
  task: 'translate', // 'transcribe' | 'translate'
  view: 'captions', // 'captions' | 'notes' | 'history' | 'helper' | 'settings'
  srcLang: 'zh',
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
    nativeDevice: 'auto', // helper compute: 'auto' | 'cpu' | 'cuda' (Win/Linux faster-whisper)
    tabRows: 'one', // 'one' = hanya bar bawah, 'two' = baris Captions/Notes di atas juga
    translationColour: 'indigo', // indigo | navy | teal | neutral | bronze — warna baris terjemahan langsung
    theme: 'auto', // 'auto' | 'light' | 'dark'
    reskin: 'yraverage', // 'yraverage' | 'coretax' | 'modern' — pola interaksi lokal
    // Two-way (consecutive) interpreting is opt-in; 'simultaneous' is the
    // historical one-way srcLang → tgtLang path.
    interpreter: { mode: 'simultaneous', a: 'ja', b: 'en' },
  },
  downloaded: {},
  running: false,
  offlineRunning: false,
  startedAt: null, // stempel mulai tugas tangkap — jam rekaman di rel Notulen
  offlineFile: null, // { name, size } once staged to OPFS
  offlineStaging: false,
  offlineLines: [],
  realtimeLines: [],
  currentTab: null,
  qaCatalog: null,
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
  // The notes ticker (notes-panel.js) and the Minutes Register read the UI
  // language from <html lang>, so keep it in sync with the setting.
  document.documentElement.lang = state.settings.uiLang || 'en';
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  const notesMount = $('notes-mount');
  if (notesMount && notesMount.dataset.mounted) mountNotesPanel(notesMount, notesMountOptions());
  renderInterpreterUi();
  redrawHelperStatus?.();
}

// ---------------------------------------------------------------------------
// selects — one option per language code; optgroup names the role so Source
// vs Target never read as a single duplicated list.
function optionsHtml(entries) {
  return uniqueLangEntries(entries)
    .map(([c, label]) => `<option value="${c}">${label}</option>`)
    .join('');
}

function fillSelects() {
  const srcGroup = t('sourceLangGroup');
  const tgtGroup = t('targetLangGroup');
  $('src-lang').innerHTML =
    `<optgroup label="${srcGroup}">${optionsHtml(SOURCE_LANGS)}</optgroup>`;
  $('tgt-lang').innerHTML =
    `<optgroup label="${tgtGroup}">${optionsHtml(TARGET_LANGS)}</optgroup>`;
  $('src-lang').value = state.srcLang;
  $('tgt-lang').value = state.tgtLang;
  $('src-lang').setAttribute('aria-label', t('sourceLang'));
  $('tgt-lang').setAttribute('aria-label', t('targetLang'));
}

// ---------------------------------------------------------------------------
// Interpreter mode — one-way (simultaneous) vs two-way (consecutive).
function interpreter() {
  return state.settings.interpreter;
}
function twoWay() {
  return interpreter()?.mode === 'consecutive';
}

/** Badges + summary text; called on every language / i18n / mode change. */
function renderInterpreterUi() {
  const it = interpreter();
  if (!it || !$('interpreter-summary')) return;
  $('interpreter-summary').textContent =
    it.mode === 'consecutive'
      ? t('interpSummaryTwoWay', it.a.toUpperCase(), it.b.toUpperCase())
      : t('interpSummaryOneWay', state.srcLang.toUpperCase(), state.tgtLang.toUpperCase());
  const two = $('interp-badge-consecutive');
  if (two) two.textContent = `${t('interpTwoWay')} \u00b7 ${t('interpPreview')}`;
  const one = $('interp-badge-simultaneous');
  if (one) one.textContent = t('interpOneWay');
  syncInterpreterLock();
}

/**
 * Two-way replaces the From/To selects with the summary row and forces
 * `+ Translate` (a two-way session is translation by definition).
 */
function applyInterpreterUi() {
  const two = twoWay();
  $('lang-row').classList.toggle('hidden', two);
  document.querySelectorAll('#task-toggle button').forEach((b) => {
    b.disabled = two;
  });
  if (two) {
    // Remember what the user had so leaving two-way gives it back.
    if (state.task !== 'translate') {
      state.taskBeforeTwoWay = state.task;
      setTask('translate');
    }
  } else if (state.taskBeforeTwoWay) {
    const prev = state.taskBeforeTwoWay;
    state.taskBeforeTwoWay = null;
    if (prev !== state.task) setTask(prev);
  }
  renderInterpreterUi();
}

/** Set a select to `want`, or to its first option when `want` is not there. */
function setSelectValue(el, want) {
  el.value = want || '';
  if (!el.value) el.value = el.options[0]?.value || '';
  return el.value;
}

function showInterpreterError(msg) {
  const el = $('interp-error');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

function openInterpreterModal() {
  const it = interpreter();
  const srcGroup = t('sourceLangGroup');
  const tgtGroup = t('targetLangGroup');
  // 'auto' is not a usable end of a two-way conversation — both sides are named.
  const twoWaySrc = SOURCE_LANGS.filter(([c]) => c !== 'auto');
  $('interp-lang-a').innerHTML = `<optgroup label="${srcGroup}">${optionsHtml(twoWaySrc)}</optgroup>`;
  $('interp-lang-b').innerHTML = `<optgroup label="${tgtGroup}">${optionsHtml(TARGET_LANGS)}</optgroup>`;
  $('interp-lang-one').innerHTML = `<optgroup label="${tgtGroup}">${optionsHtml(TARGET_LANGS)}</optgroup>`;
  // it.a may be a language this list does not offer (e.g. a stale 'auto') —
  // fall back to the first concrete option rather than an empty select.
  setSelectValue($('interp-lang-a'), it.a);
  setSelectValue($('interp-lang-b'), it.b);
  setSelectValue($('interp-lang-one'), state.tgtLang);
  showInterpreterError('');
  selectInterpreterCard(it.mode);
  syncInterpreterLock();
  $('interpreter-modal').classList.remove('hidden');
}

function selectInterpreterCard(mode) {
  document.querySelectorAll('.interp-card').forEach((card) => {
    card.setAttribute('aria-checked', String(card.dataset.mode === mode));
  });
}

function chosenInterpreterMode() {
  const on = document.querySelector('.interp-card[aria-checked="true"]');
  return on?.dataset.mode === 'consecutive' ? 'consecutive' : 'simultaneous';
}

async function applyInterpreterChoice() {
  const mode = chosenInterpreterMode();
  if (mode === 'consecutive') {
    const a = $('interp-lang-a').value;
    const b = $('interp-lang-b').value;
    const next = normalizeInterpreter({ interpreter: { mode, a, b } }, a, b);
    if (next.mode !== 'consecutive') {
      // Two-way needs two different, concrete languages — say so, stay open.
      showInterpreterError(t('interpCannotApply'));
      return;
    }
    state.settings.interpreter = next;
    // The From/To selects still hold the pair internally.
    state.srcLang = next.a;
    state.tgtLang = next.b;
  } else {
    state.tgtLang = $('interp-lang-one').value;
    // Never persist 'auto' as one end of the remembered pair: it is not a
    // usable two-way language and would come back as an empty select.
    const prev = interpreter();
    const a = state.srcLang !== 'auto' ? state.srcLang : prev?.a !== 'auto' ? prev?.a : '';
    state.settings.interpreter = { mode: 'simultaneous', b: state.tgtLang, ...(a ? { a } : {}) };
  }
  showInterpreterError('');
  $('src-lang').value = state.srcLang;
  $('tgt-lang').value = state.tgtLang;
  await saveSettings();
  persistLastConfig();
  applyInterpreterUi();
  updateWarning();
  $('interpreter-modal').classList.add('hidden');
}

/**
 * Satu stempel waktu untuk kedua jalur tangkap (realtime + berkas offline):
 * dipasang saat tugas mulai berjalan, dibersihkan begitu berhenti. Panggil ini
 * SETELAH setiap perubahan `state.running` / `state.offlineRunning`.
 */
function syncCaptureStamp() {
  const on = state.running || state.offlineRunning;
  if (on && !state.startedAt) state.startedAt = Date.now();
  else if (!on) state.startedAt = null;
  syncInterpreterLock();
  syncActiveCapture();
}

// Kondisi aktif Side Panel ↔ navigasi: satu sumber (state.running /
// state.offlineRunning) menggerakkan indikator di topbar + bottom nav agar
// pengguna selalu tahu tugas berjalan walau sedang di tab Notes/Settings.
function syncActiveCapture() {
  const on = captureRunning();
  document.body.classList.toggle('is-running', on);
  $('topbar-rec')?.classList.toggle('hidden', !on);
}

/**
 * The pipeline builds its translators once, at start: switching Interpreter
 * mode mid-capture would change the UI and nothing else. So while a task runs
 * the Change button is locked, and the modal says the truth out loud.
 */
function captureRunning() {
  return !!(state.running || state.offlineRunning);
}

function syncInterpreterLock() {
  const btn = $('btn-interpreter');
  if (!btn) return;
  const busy = captureRunning();
  btn.disabled = busy;
  btn.title = busy ? t('interpAppliesNextTask') : '';
  const note = $('interp-running-note');
  if (note) note.classList.toggle('hidden', !busy);
}

/** Lencana mesin di kartu rekam — apa yang benar-benar mentranskripsi. */
function captureEngineLabel() {
  if (state.settings.engine === 'native' && nativeInfo) {
    const e = String(nativeInfo.engine || '');
    return /mlx/i.test(e) ? 'MLX \u00b7 GPU' : `${e || 'Helper'} \u00b7 native`;
  }
  return 'Whisper \u00b7 browser';
}

/** Keadaan tangkap yang dibaca tiket Notulen (notes-panel.js). */
function getCapture() {
  return {
    running: state.running || state.offlineRunning,
    startedAt: state.startedAt,
    engine: captureEngineLabel(),
  };
}

/** Apa yang dipasok panel Notulen: keadaan tangkap + jalan berhenti yang sudah ada. */
// ---------------------------------------------------------------------------
// Tempel transkrip Teams → notulen
//
// Rapat sering sudah punya transkrip di Teams; menjalankan ulang audionya
// hanya untuk mendapat notulen itu mubazir. Semua penguraian berjalan di
// perangkat ini — teks tempelan tidak pernah dikirim ke mana pun.
async function generateMinutesFromPaste() {
  const raw = $('paste-input')?.value || '';
  const out = $('paste-result');
  if (!out) return;
  out.innerHTML = '';
  if (!raw.trim()) return;

  const { parseTeamsTranscript, looksLikeTeamsTranscript } = await import('./lib/teams-transcript.js');
  if (!looksLikeTeamsTranscript(raw)) {
    out.innerHTML = `<span class="err">${t('pasteNotTeams')}</span>`;
    return;
  }
  const { lines, speakers } = parseTeamsTranscript(raw);
  if (!lines.length) {
    out.innerHTML = `<span class="err">${t('pasteNotTeams')}</span>`;
    return;
  }
  const { generateNotesFromTranscript } = await import('./lib/notes-generate.js');
  const meeting = generateNotesFromTranscript(lines, {
    title: ($('paste-title')?.value || '').trim() || 'Pasted meeting',
    locale: state.settings.uiLang === 'id' ? 'id' : 'en',
    source: 'teams-paste',
    projectType: await loadProjectTypePref(),
  });
  const { saveMeeting } = await import('./lib/notes-store.js');
  await saveMeeting(meeting);
  out.innerHTML = `<span class="ok">${t('pasteDone', lines.length, speakers.length, meeting.items.length)}</span>`;
  showToast(t('pasteDone', lines.length, speakers.length, meeting.items.length), 'ok');
  // Tampilkan notulen yang baru dibuat.
  const mount = $('notes-mount');
  if (mount && mount.dataset.mounted) mountNotesPanel(mount, notesMountOptions());
}

function notesMountOptions() {
  return {
    getCapture,
    getSessionLines: () => state.realtimeLines.slice(),
    onEndCapture: () => onStop(),
    onExportNotes: (kind) => exportActiveNotes(kind),
    onPushShared: (meeting, lang) => pushActiveNotes(meeting, lang),
  };
}

async function pushActiveNotes(meeting, lang) {
  if (!nativeInfo) return null;
  const { pushMeetingToHelper } = await import('./lib/notes-sync.js');
  const note = await pushMeetingToHelper(
    state.settings.nativeUrl || DEFAULT_NATIVE_URL,
    meeting,
    lang,
  );
  if (note) setStatus(t('savedTo', 'Native Helper'), 'ok');
  return note;
}

async function exportActiveNotes(kind) {
  const mount = $('notes-mount');
  const meetingId = mount?.querySelector('.notes-saved-item.active')?.dataset.meetingId || null;
  const { listMeetings } = await import('./lib/notes-store.js');
  const { serializeMeetingTxt, serializeMeetingMarkdown } = await import('./lib/notes-export.js');
  const meetings = await listMeetings();
  const meeting = (meetingId && meetings.find((m) => m.id === meetingId)) || meetings[0];
  if (!meeting) {
    setStatus(t('noHistory'), 'error');
    return;
  }
  const lang = (document.documentElement.lang || 'en').startsWith('id') ? 'id' : 'en';
  const out = kind === 'md' ? serializeMeetingMarkdown(meeting, lang) : serializeMeetingTxt(meeting, lang);
  const safe =
    String(meeting.title || meeting.id || 'meeting-notes')
      .replace(/[^\w\s.-]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60) || 'meeting-notes';
  const name = kind === 'md' ? `${safe}.md` : `${safe}.txt`;
  try {
    const res = await saveExportFile(name, out);
    const msg = res.saved ? t('savedTo', res.path) : t('downloadedTo', name);
    setStatus(msg, 'ok');
    showToast(msg, 'ok');
  } catch (e) {
    const msg = t('exportFailed', String(e?.message || e));
    setStatus(msg, 'error');
    showToast(msg, 'error');
  }
}

/** Child tab dari Captions: 'live' (kartu) atau 'perf' (analitik kecepatan). */
let perfPanel = null;
function setSubview(sub) {
  const perf = sub === 'perf';
  document.querySelectorAll('#captions-subtabs [data-subview]').forEach((b) => {
    const on = b.dataset.subview === (perf ? 'perf' : 'live');
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  syncPill('captions-subtabs');
  document.querySelectorAll('#view-captions > section.card').forEach((sec) => sec.classList.toggle('hidden', perf));
  $('view-perf')?.classList.toggle('hidden', !perf);
  if (perf) perfPanel?.render();
  try { localStorage.setItem('captionsSubview', perf ? 'perf' : 'live'); } catch { /* opsional */ }
}

/** Kepadatan panel: 'simple' (bawaan) atau 'detail'.
 * Simple menyembunyikan setiap elemen bertanda data-density="detail":
 * subtab Performance, Refine/Dual line, Interpreter mode, peringatan model,
 * pilih tab manual, kartu Native Helper, dan tambahan di panel Notulen.
 * Pilihan terakhir tersimpan di chrome.storage.local sebagai `panelDensity`. */
const DENSITY_KEY = 'panelDensity';
let density = 'simple';

function applyDensity(mode, { persist = true } = {}) {
  density = mode === 'detail' ? 'detail' : 'simple';
  document.body.dataset.density = density;
  document.querySelectorAll('#density-toggle [data-density-mode]').forEach((b) => {
    const on = b.dataset.densityMode === density;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  syncPill('density-toggle');
  // Simple mode takes the Captions subtabs out of the flow entirely, so their
  // pill is re-placed once Detail puts them back and they can be measured.
  if (density === 'detail') requestAnimationFrame(() => syncPill('captions-subtabs', false));
  // Performance hanya hidup di Detail — jangan tinggalkan pengguna di tab yang hilang.
  if (density === 'simple') setSubview('live');
  if (persist) {
    try {
      chrome.storage.local.set({ [DENSITY_KEY]: density });
    } catch { /* storage opsional (harness) */ }
  }
}

async function restoreDensity() {
  let saved = null;
  try {
    const got = await chrome.storage.local.get(DENSITY_KEY);
    saved = got?.[DENSITY_KEY] ?? null;
  } catch { /* storage opsional */ }
  applyDensity(saved === 'detail' ? 'detail' : 'simple', { persist: false });
}

/** Kartu yang bisa dilipat (Native Helper) — tertutup default, status diingat. */
function initCollapsibles() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('uiCollapsed') || '{}'); } catch { saved = {}; }
  document.querySelectorAll('.card.collapsible[data-collapse-key]').forEach((card) => {
    const key = card.dataset.collapseKey;
    // Bawaan tertutup, kecuali kartu menyatakan data-collapse-default="open"
    // (kartu Notulen harus terbuka saat panel pertama dibuka).
    const openByDefault = card.dataset.collapseDefault === 'open';
    const open = saved[key] === undefined ? openByDefault : saved[key] === true;
    card.classList.toggle('collapsed', !open);
    const btn = card.querySelector('.card-toggle');
    btn?.setAttribute('aria-expanded', String(open));
    btn?.addEventListener('click', () => {
      const nowOpen = card.classList.contains('collapsed');
      card.classList.toggle('collapsed', !nowOpen);
      btn.setAttribute('aria-expanded', String(nowOpen));
      saved[key] = nowOpen;
      try { localStorage.setItem('uiCollapsed', JSON.stringify(saved)); } catch { /* opsional */ }
    });
  });
}

/* ---- Pencarian cepat di Pengaturan -------------------------------------
 * Menyaring berdasarkan teks yang terlihat (label + kendali + deskripsi).
 * Kueri kosong menampilkan semuanya kembali. */
function filterSettings(query) {
  const q = String(query || '').trim().toLowerCase();
  const modal = $('settings-modal');
  if (!modal) return;
  let visible = 0;
  modal.toggleAttribute('data-searching', !!q);
  if (q) modal.querySelectorAll('details.set-adv').forEach((d) => { d.open = true; }); // a match must not hide behind Advanced
  modal.querySelectorAll('.setting-row, .m-item').forEach((el) => {
    const hit = !q || el.textContent.toLowerCase().includes(q);
    el.classList.toggle('search-hidden', !hit);
    if (hit) visible += 1;
  });
  // Blok Native Helper menempel pada baris Engine: ikut tampil selama baris
  // itu tampil, atau kalau isinya sendiri cocok.
  const nativeBlock = $('native-block');
  if (nativeBlock) {
    const engineRow = $('engine-toggle')?.closest('.setting-row');
    const show =
      !q ||
      nativeBlock.textContent.toLowerCase().includes(q) ||
      (engineRow && !engineRow.classList.contains('search-hidden'));
    nativeBlock.classList.toggle('search-hidden', !show);
  }
  // Judul daftar model hanya muncul kalau ada model yang lolos saringan.
  modal.querySelectorAll('.models-title').forEach((title) => {
    let el = title.nextElementSibling;
    while (el && !el.classList.contains('model-list')) el = el.nextElementSibling;
    const any = !q || (el && [...el.querySelectorAll('.m-item')].some((m) => !m.classList.contains('search-hidden')));
    title.classList.toggle('search-hidden', !any);
  });
  modal.querySelectorAll('.hint').forEach((h) => {
    if (h.id === 'settings-no-match') return;
    h.classList.toggle('search-hidden', !!q);
  });
  modal.querySelectorAll('.set-card').forEach((card) => {
    const any = !q || [...card.querySelectorAll('.setting-row, .m-item')].some((r) => !r.classList.contains('search-hidden'));
    card.classList.toggle('search-hidden', !any);
  });
  const none = $('settings-no-match');
  none.classList.toggle('hidden', !q || visible > 0);
  if (q && visible === 0) none.textContent = t('settingsNoMatch', query.trim());
}

/* ---- Preferensi antar sesi --------------------------------------------
 * lastConfig sudah lama ditulis tapi tidak pernah dibaca lagi, jadi panel
 * selalu terbuka di Realtime + Translate. Sekarang dipulihkan. */
async function restoreUiPrefs() {
  try {
    const { lastConfig, panelPrefs } = await chrome.storage.local.get(['lastConfig', 'panelPrefs']);
    if (lastConfig?.srcLang) state.srcLang = lastConfig.srcLang;
    else if (isWebHost()) state.srcLang = 'auto'; // app window: detect the spoken language until the person picks one
    if (lastConfig?.tgtLang) state.tgtLang = lastConfig.tgtLang;
    return {
      task: lastConfig?.taskMode === 'transcribe' ? 'transcribe' : 'translate',
      mode: panelPrefs?.mode === 'offline' ? 'offline' : 'realtime',
    };
  } catch {
    return { task: 'translate', mode: 'realtime' };
  }
}

const VIEWS = ['captions', 'notes', 'history', 'helper', 'settings'];
let prevView = 'captions';

function setView(view) {
  const next = VIEWS.includes(view) ? view : 'captions';
  if (next !== state.view && state.view !== 'settings') prevView = state.view;
  const wasNative = state.view === 'settings' || state.view === 'helper';
  state.view = next;
  document.querySelectorAll('#view-tabs button').forEach((b) => {
    const active = b.dataset.view === state.view;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  for (const v of VIEWS) $(`view-${v}`)?.classList.toggle('hidden', v !== state.view);
  syncBottomNav();
  // Helper dan Settings membaca status helper; di luar keduanya polling berhenti.
  if (state.view === 'helper') {
    checkNative({ allowAutoStart: true });
    startNativePoll();
    syncPill('native-device-toggle', false);
  } else if (state.view === 'settings') {
    openSettingsPane();
  } else if (wasNative) {
    stopNativePoll();
  }

  // Putar ulang animasi reveal di view yang baru tampil: kelas dilepas,
  // reflow dipaksa, lalu dipasang lagi dengan stagger. Tanpa ini CSS tidak
  // mengulang animasi yang sudah selesai sehingga pindah tab tanpa transisi.
  const visibleView = $(`view-${state.view}`);
  if (visibleView) {
    const items = [...visibleView.querySelectorAll('.reveal')];
    for (const el of items) el.classList.remove('reveal');
    void visibleView.offsetWidth;
    requestAnimationFrame(() => {
      items.forEach((el, i) => {
        el.style.animationDelay = `${Math.min(i * 30, 300)}ms`;
        el.classList.add('reveal');
      });
    });
  }
  syncPill('view-tabs');
  syncPill('captions-subtabs');
}

/** Tab Settings terbuka. */
const settingsOpen = () => state.view === 'settings';

function syncBottomNav() {
  document.querySelectorAll('.bottom-nav-item').forEach((b) => {
    const active = b.dataset.view === state.view;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

// ---------------------------------------------------------------------------
// MP-04 — a spring-driven pill travels behind the active button of a segmented
// group. Each group keeps its own click handlers and its own `.active`
// stamping; the pill only follows, so `syncPill` is called wherever the active
// button is actually decided. `.seg.wrap` groups are deliberately left out —
// they wrap onto several rows and one pill cannot track that.
const PILL_GROUPS = [
  'view-tabs', 'density-toggle', 'captions-subtabs', 'mode-toggle', 'task-toggle',
  'theme-toggle', 'asr-preset-toggle', 'mirror-toggle', 'device-toggle',
  'native-device-toggle',
];
const pills = new Map();

function mountPills() {
  for (const id of PILL_GROUPS) {
    const host = $(id);
    if (!host || pills.has(id)) continue;
    const pill = document.createElement('span');
    pill.className = 'mo-pill';
    host.prepend(pill);
    host.classList.add('mo-has-pill');
    pills.set(id, highlight(host, { pill, bind: false, selectedAttr: null, activeClass: 'active' }));
  }
}

function syncPill(id, animated = true) {
  // hl.sync() re-reads the DOM's own idea of which button is active, so the
  // `.active` convention stays in one place. A host inside the closed settings
  // modal measures 0 and is skipped there; it is re-synced when it opens.
  pills.get(id)?.sync(animated);
}

function resyncPills(animated = false) {
  for (const id of pills.keys()) syncPill(id, animated);
}

// MP-03 — panels that appear in place grow and collapse instead of popping in.
// Only genuine in-place reveals get this: swapping the realtime and offline
// panels is a layout change, and animating its height would read as a glitch.
const panels = new Map();
let warnPanel = null;

function mountPanel(id, wrapId, opts = {}) {
  const wrap = $(wrapId);
  const inner = $(id);
  if (!wrap || !inner || panels.has(id)) return null;
  const panel = autoHeight(wrap, {
    inner,
    open: false,
    onSettled: (open) => {
      wrap.setAttribute('aria-hidden', String(!open));
      if (!open && opts.clearOnClose) inner.innerHTML = '';
    },
  });
  panels.set(id, panel);
  return panel;
}

function showPanel(id, open) {
  const panel = panels.get(id);
  if (!panel) return;
  if (open) {
    panel.open();
    $(`${id}-wrap`)?.setAttribute('aria-hidden', 'false');
  } else {
    panel.close();
  }
}

function mountPanels() {
  warnPanel = mountPanel('model-warning', 'model-warning-wrap', { clearOnClose: true });
  mountPanel('qa-sample-bar', 'qa-sample-wrap');
  // #native-block deliberately keeps its .hidden toggle rather than getting
  // MP-03: test/app-surfaces.test.mjs asserts that class directly, and the
  // behaviour it guards — the helper card appears only on the Native engine —
  // matters more than the reveal animating.
}

// ---------------------------------------------------------------------------
// mode / task toggles
function setMode(mode) {
  const modeChanged = state.mode !== mode;
  state.mode = mode;
  if (modeChanged) chrome.storage.local.set({ panelPrefs: { mode } }).catch(() => {});
  document.querySelectorAll('#mode-toggle button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  syncPill('mode-toggle');
  $('rt-target').classList.toggle('hidden', mode !== 'realtime');
  $('btn-pick').classList.toggle('hidden', mode !== 'realtime');
  $('pick-hint').classList.add('hidden');
  hideError();
  if (!state.running) setStartStep(null);
  $('off-drop').classList.toggle('hidden', mode !== 'offline');
  $('off-results').classList.toggle('hidden', mode !== 'offline' || state.offlineLines.length === 0);
  showPanel('qa-sample-bar', mode === 'offline' && !!state.qaCatalog?.samples?.length);
  $('live-preview').classList.add('hidden');
  updateButtons();
  updateWarning();
  redrawHelperStatus?.();
  redrawHelperGuide?.();
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
  redrawHelperStatus?.();
}

function setTask(task) {
  state.task = task;
  document.querySelectorAll('#task-toggle button').forEach((b) => {
    b.classList.toggle('active', b.dataset.task === task);
  });
  syncPill('task-toggle');
  $('tgt-col').style.opacity = task === 'translate' ? '1' : '0.4';
  $('tgt-lang').disabled = task !== 'translate';
  updateWarning();
  redrawHelperStatus?.();
  redrawHelperGuide?.();
}

// ---------------------------------------------------------------------------
// Which translation models one direction needs, and whether a note applies.
function mtPairIssues(srcLang, tgtLang, cfg) {
  const issues = [];
  let directNote = '';
  const plan = translationPlan(srcLang, tgtLang, {
    dualLine: cfg.dualLine,
    refineTranslation: cfg.refineTranslation,
  });
  if (plan.mode === 'whisper-direct') {
    directNote = `<span style="opacity:.85">${t('directNote')}</span>`;
  } else if (cfg.refineTranslation) {
    directNote = `<span style="opacity:.85">${t('refineNote')}</span>`;
  } else if (plan.mode === 'mt') {
    const label = pairLabel(`${srcLang}-${tgtLang}`);
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
  return { issues, directNote };
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
    if (twoWay()) {
      // Two-way needs BOTH directions — list each missing pair separately.
      const { a, b } = interpreter();
      const fwd = mtPairIssues(a, b, cfg);
      const rev = mtPairIssues(b, a, cfg);
      const both = [...fwd.issues, ...rev.issues];
      if (both.length) issues.push({ msg: t('interpNeedsBoth') });
      issues.push(...both);
      directNote = fwd.directNote || rev.directNote;
    } else {
      const r = mtPairIssues(cfg.srcLang, cfg.tgtLang, cfg);
      issues.push(...r.issues);
      directNote = r.directNote;
    }
  }

  if (issues.length === 0 && !directNote) {
    warnPanel?.close();
    return;
  }
  const seenKeys = new Set();
  const buttons = issues
    .filter((i) => i.key && !seenKeys.has(i.key) && seenKeys.add(i.key))
    .map(
      (i) =>
        `<button class="mini-btn dl-now" data-key="${i.key}">⬇ ${t('download')} — ${i.btn}</button>`,
    )
    .join(' ');
  // Model belum tersedia → arahkan ke pemasangan: unduh langsung ATAU kelola
  // di Settings (daftar lengkap + hapus + uji pasangan).
  const manage = `<button class="mini-btn manage-models">⚙ ${t('manageModels')}</button>`;
  el.innerHTML = [issues.map((i) => i.msg).join('<br>'), buttons, manage, directNote]
    .filter(Boolean)
    .join('<br>');
  // Content first, then open: autoHeight measures what is already there.
  warnPanel?.open();
  if (warnPanel) $('model-warning-wrap').setAttribute('aria-hidden', 'false');
  el.querySelectorAll('.dl-now').forEach((b) => {
    b.addEventListener('click', () => startDownload(b.dataset.key));
  });
  el.querySelector('.manage-models')?.addEventListener('click', () => {
    openSettings();
    requestAnimationFrame(() => {
      const host = document.querySelector('#asr-models');
      const adv = host?.closest('details'); // hosted window keeps browser models under Advanced
      if (adv) adv.open = true;
      host?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// Engine-hosted window: the engine's own models lead the Models tab; browser models, the
// download mirror and the engine's dev controls sit behind one "Advanced" disclosure per tab.
// shortcut: Start/Stop/Restart stay visible when the Engine choice is Browser (they only ever act on the engine); revisit if that choice gets a real use here.
function arrangeHostedSettings() {
  const advanced = (pane, nodes) => {
    const d = document.createElement('details');
    d.className = 'set-adv';
    const sum = document.createElement('summary');
    sum.textContent = t('advanced');
    d.append(sum, ...nodes.filter(Boolean));
    pane.append(d);
  };
  const models = document.querySelector('.set-card[data-pane="models"]');
  const engine = document.querySelector('.set-card[data-pane="engine"]');
  if (models && engine) {
    const head = models.querySelector('.set-card-head');
    const nm = $('native-models');
    if (nm) head.after(nm);
    advanced(models, [...models.children].filter((c) => c !== head && c !== nm));
    advanced(engine, [
      $('engine-toggle')?.closest('.setting-row'),
      engine.querySelector('.native-row'),
      engine.querySelector('.native-actions'),
      $('native-host-hint'),
      $('device-toggle')?.closest('.setting-row'),
    ]);
  }
}

// Satu pintu membuka Settings (topbar, nav bawah, About, peta fitur).
function openSettings({ about = false } = {}) {
  if (!settingsOpen()) setView('settings');
  setSettingsTab(about ? 'about' : $('settings-modal').dataset.stab || 'general');
  if (about) $('about-block').scrollIntoView({ behavior: 'smooth' });
}

// Dipanggil setView('settings'): isi yang hanya bisa diukur setelah terlihat.
function openSettingsPane() {
  const search = $('settings-search');
  if (search) {
    search.value = '';
    filterSettings('');
    setTimeout(() => search.focus({ preventScroll: true }), 30);
  }
  lastNativeAutoStartMs = 0;
  labEnsureAttempted = false;
  checkNative({ allowAutoStart: true });
  startNativePoll();
  renderModelLists();
  setSettingsTab($('settings-modal').dataset.stab);
}

let addinsPane = null; // Settings › Add-ins (addins-ui.js), mounted at boot
const SETTINGS_TABS = ['general', 'engine', 'models', 'output', 'addins', 'about'];
function setSettingsTab(tab) {
  const next = SETTINGS_TABS.includes(tab) ? tab : 'general';
  $('settings-modal').dataset.stab = next;
  document.querySelectorAll('#settings-tabs button').forEach((b) => {
    const on = b.dataset.stab === next;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  for (const id of ['theme-toggle', 'asr-preset-toggle', 'mirror-toggle', 'device-toggle']) syncPill(id, false);
  if (next === 'addins') addinsPane?.refresh();
}

/** Pintu dari peta fitur dan tautan "buka tab": captions | notes | history | helper | settings | perf | interp. */
function jumpTo(tab) {
  if (tab === 'perf') {
    setView('captions');
    applyDensity('detail');
    setSubview('perf');
  } else if (tab === 'interp') {
    setView('captions');
    $('btn-interpreter')?.click();
  } else {
    setView(tab);
    if (tab === 'captions') setSubview('live');
  }
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
  const it = interpreter();
  const two = it?.mode === 'consecutive';
  return {
    tabId: state.currentTab?.id,
    // Two-way: the a → b direction is the nominal pair; offscreen flips it per
    // utterance. Refine (draft-then-correct) has no meaning without a fixed
    // source language, so it is off.
    srcLang: two ? it.a : state.srcLang,
    tgtLang: two ? it.b : state.tgtLang,
    taskMode: two ? 'translate' : state.task,
    dualLine: state.settings.dualLine,
    refineTranslation: two ? false : state.settings.refineTranslation,
    asrModel: state.settings.asrModel,
    interpreter: it,
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

// Rows are built once per key and then updated in place. Re-rendering the list
// on every progress event used to throw away the DOM a dozen times a second,
// which is what made the bars restart their ease and stutter — and it would
// destroy the springs driving them.
const dlRows = new Map(); // key -> row handles

const mb = (n) => (n / 1024 / 1024).toFixed(1);

function makeDlRow(key) {
  const row = document.createElement('div');
  row.className = 'dl-row';
  row.innerHTML = `
    <div class="dl-label">
      <span class="dl-name"></span>
      <span class="pct"><span class="dl-live"><span class="dl-size"><span class="dl-loaded"></span> / <span class="dl-total"></span> MB · </span><span class="dl-pct"></span>%</span><span class="dl-tick">✓</span></span>
    </div>
    <div class="bar"><div class="fill"></div></div>`;

  const handles = {
    row,
    name: row.querySelector('.dl-name'),
    size: row.querySelector('.dl-size'),
    total: row.querySelector('.dl-total'),
    loaded: slidingNumber(row.querySelector('.dl-loaded'), { decimals: 1 }),
    pct: slidingNumber(row.querySelector('.dl-pct'), { decimals: 0 }),
    bar: springProgress(row.querySelector('.fill')),
  };
  dlRows.set(key, handles);
  return handles;
}

function renderDlList() {
  const host = $('dl-list');
  host.classList.toggle('hidden', dlState.size === 0);

  for (const [key, handles] of dlRows) {
    if (dlState.has(key)) continue;
    handles.loaded.destroy();
    handles.pct.destroy();
    handles.bar.destroy();
    handles.row.remove();
    dlRows.delete(key);
  }

  for (const [key, d] of dlState) {
    const h = dlRows.get(key) || makeDlRow(key);
    if (!h.row.isConnected) host.appendChild(h.row);

    h.name.textContent = `⬇ ${t('downloading')}: ${labelForKey(key)}`;
    h.row.classList.toggle('done', !!d.done);
    h.size.hidden = d.done || !d.total;
    if (d.total) h.total.textContent = mb(d.total);
    h.loaded.to(d.done ? (d.total || 0) / 1024 / 1024 : (d.loaded || 0) / 1024 / 1024);
    h.pct.to(d.done ? 100 : Math.round(d.pct || 0));
    h.bar.to(d.done ? 100 : d.pct || 0);
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
function renderUiLangToggle() {
  const host = $('ui-lang-toggle');
  if (!host) return;
  const cur = state.settings.uiLang || 'en';
  if (!host.dataset.ready) {
    host.innerHTML = '';
    for (const [code, label] of UI_LANGS) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = label;
      host.appendChild(opt);
    }
    host.addEventListener('change', async () => {
      state.settings.uiLang = host.value;
      await saveSettings();
      await loadSettings();
      applyI18n();
      resyncPills(false);
      fillSelects();
      updateWarning();
      renderHistory();
      redrawHelperGuide?.();
      addinsPane?.refresh();
      renderQaSampleBar();
      renderModelLists();
    });
    host.dataset.ready = '1';
  }
  host.value = cur;
}

const ENGINE_OPTIONS = [
  ['browser', 'engineBrowser'],
  ['native', 'engineNative'],
];

function renderEngineToggle() {
  const host = $('engine-toggle');
  if (!host) return;
  const cur = state.settings.engine || 'browser';
  if (!host.dataset.ready) {
    host.innerHTML = '';
    for (const [value, i18nKey] of ENGINE_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.dataset.i18nKey = i18nKey;
      host.appendChild(opt);
    }
    host.addEventListener('change', async () => {
      state.settings.engine = host.value;
      await saveSettings();
      await loadSettings();
      updateWarning();
      if (state.settings.engine === 'native') {
        lastNativeAutoStartMs = 0;
        labEnsureAttempted = false;
        checkNative({ allowAutoStart: true });
        if (settingsOpen()) startNativePoll();
      } else {
        stopNativePoll();
      }
    });
    host.dataset.ready = '1';
  }
  for (const opt of host.options) {
    if (opt.dataset.i18nKey) opt.textContent = t(opt.dataset.i18nKey);
  }
  host.value = ENGINE_OPTIONS.some(([v]) => v === cur) ? cur : 'browser';
}

function renderQaSampleBar() {
  const bar = $('qa-sample-bar');
  const sel = $('qa-sample-select');
  if (!bar || !sel) return;
  const samples = state.qaCatalog?.samples || [];
  const show = state.mode === 'offline' && samples.length > 0;
  showPanel('qa-sample-bar', show);
  if (!samples.length) return;
  const prev = sel.value;
  sel.innerHTML = samples
    .map(
      (s) =>
        `<option value="${s.id}">${s.label || s.id} (${Math.round(s.durationHint || 0)}s)</option>`,
    )
    .join('');
  if (prev && samples.some((s) => s.id === prev)) sel.value = prev;
}

async function runQaSample(sample, { autoStart = true } = {}) {
  if (!sample || !state.qaCatalog) {
    setStatus(t('qaNoSample'), 'error');
    return;
  }
  setMode('offline');
  setTask('translate');
  state.srcLang = sample.src;
  state.tgtLang = sample.tgt || 'en';
  $('src-lang').value = state.srcLang;
  $('tgt-lang').value = state.tgtLang;
  updateWarning();
  persistLastConfig();
  setStatus(t('qaLoadingSample'));
  try {
    const file = await fetchSampleFile(state.qaCatalog, sample);
    await pickFile(file);
    if (autoStart && state.offlineFile && !state.offlineStaging) {
      await onStart();
    }
  } catch (e) {
    setStatus(String(e?.message || e), 'error');
  }
}

const ASR_PRESETS = { fast: 'whisper-tiny', balanced: 'whisper-base', accurate: 'whisper-small' };

function currentAsrPreset() {
  for (const [p, key] of Object.entries(ASR_PRESETS)) {
    if (key === state.settings.asrModel) return p;
  }
  return null;
}

/** Label model aktif untuk sesi: "Whisper Base · Auto". */
function activeAsrLabel() {
  const m = ASR_MODELS[state.settings.asrModel];
  if (!m) return '';
  const device = state.settings.device === 'auto' ? 'Auto' : state.settings.device.toUpperCase();
  return `${m.label} · ${device}`;
}

function renderAsrPreset() {
  const host = $('asr-preset-toggle');
  if (!host) return;
  const cur = currentAsrPreset();
  host.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === cur);
  });
  syncPill('asr-preset-toggle');
  const hint = $('asr-preset-hint');
  if (hint) {
    if (cur) {
      const m = ASR_MODELS[ASR_PRESETS[cur]];
      const size = !m.webgpuOnly && state.settings.device === 'wasm' ? m.sizeWasm : m.sizeWebgpu;
      hint.textContent = t('presetHint', m.label, size, m.note);
    } else {
      hint.textContent = t('presetCustom');
    }
  }
}

function renderModelLists() {
  renderAsrPreset();
  const asrHost = $('asr-models');
  asrHost.innerHTML = '';
  for (const [key, m] of Object.entries(ASR_MODELS)) {
    const size = m.webgpuOnly ? m.sizeWebgpu : `${m.sizeWasm} / ${m.sizeWebgpu}`;
    asrHost.appendChild(modelRow(key, m.label, `${size} · ${m.note}`));
  }
  const mtHost = $('mt-models');
  mtHost.innerHTML = '';
  for (const [key, p] of Object.entries(MT_PAIRS)) {
    mtHost.appendChild(modelRow(key, pairLabel(key), `${key} · Opus-MT · ${p.size}`, { mtPair: key }));
  }
  const q = $('settings-search')?.value;
  if (q) filterSettings(q);
}

function modelRow(key, name, sub, { mtPair = null } = {}) {
  const div = document.createElement('div');
  div.className = 'm-item';
  const isDl = !!state.downloaded[key];
  const isActive = key === state.settings.asrModel && ASR_MODELS[key];
  const dl = dlState.get(key);
  const downloading = dl && !dl.done;
  const canTest = mtPair && state.qaCatalog && firstSampleForPair(state.qaCatalog, mtPair);
  div.innerHTML = `
    <div class="m-meta">
      <div class="m-name">${name}${isActive ? ' ✓' : ''}</div>
      <div class="m-sub">${sub}</div>
    </div>
    <span class="m-state ${isDl ? 'done' : ''}" data-key="${key}">${
      downloading ? Math.round(dl.pct || 0) + '%' : isDl ? '✅' : ''
    }</span>
    ${
      canTest
        ? `<button class="mini-btn test-btn" data-pair="${mtPair}" title="${t('qaSamplesHint')}">${t('qaTest')}</button>`
        : ''
    }
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
  div.querySelector('.test-btn')?.addEventListener('click', async () => {
    const pair = div.querySelector('.test-btn').dataset.pair;
    const sample = firstSampleForPair(state.qaCatalog, pair);
    setView('captions');
    await runQaSample(sample, { autoStart: true });
  });
  return div;
}

// ---------------------------------------------------------------------------
// Tab rows (One | Two) dan Translation colour — dua pengaturan baru board D02.
const TCOLOURS = ['indigo', 'navy', 'teal', 'neutral', 'bronze'];

function applyTabRows() {
  const rows = state.settings.tabRows === 'two' ? 'two' : 'one';
  document.body.dataset.tabrows = rows;
  document.querySelectorAll('#tabrows-toggle button').forEach((b) => {
    const on = b.dataset.tabrows === rows;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

// Where live captions show: 'overlay' (page), 'island' (pill on the desktop) or 'both'.
// Key `captionSurface` in chrome.storage.local is read by content.js; the helper keeps a
// copy (ui-prefs) because the island reads captions from the helper, which has none with
// the in-browser engine.
const CAPTION_SURFACES = ['overlay', 'island', 'both'];
let captionSurface = 'overlay';

function applyCaptionSurface() {
  document.querySelectorAll('#surface-toggle button').forEach((b) => {
    const on = b.dataset.surface === captionSurface;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('surface-engine-hint')?.classList.toggle(
    'hidden',
    captionSurface === 'overlay' || state.settings.engine === 'native',
  );
}

async function setCaptionSurface(value) {
  captionSurface = CAPTION_SURFACES.includes(value) ? value : 'overlay';
  await chrome.storage.local.set({ captionSurface });
  applyCaptionSurface();
  pushUiPrefs();
}

async function loadCaptionSurface() {
  const { captionSurface: v } = await chrome.storage.local.get('captionSurface');
  captionSurface = CAPTION_SURFACES.includes(v) ? v : 'overlay';
}

async function setTabRows(rows) {
  state.settings.tabRows = rows === 'two' ? 'two' : 'one';
  await saveSettings();
  applyTabRows();
}

function applyTranslationColour() {
  const c = TCOLOURS.includes(state.settings.translationColour) ? state.settings.translationColour : 'indigo';
  document.documentElement.dataset.tcolor = c;
  document.querySelectorAll('#surface-toggle button').forEach((b) =>
    b.addEventListener('click', () => setCaptionSurface(b.dataset.surface)),
  );
  $('btn-surface-native')?.addEventListener('click', () => {
    const sel = $('engine-toggle');
    sel.value = 'native';
    sel.dispatchEvent(new Event('change'));
  });
  document.querySelectorAll('#tcolor-toggle button').forEach((b) => {
    const on = b.dataset.tcolor === c;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

async function setTranslationColour(c) {
  state.settings.translationColour = TCOLOURS.includes(c) ? c : 'indigo';
  await saveSettings();
  applyTranslationColour();
}

/** Baris "Engine · perangkat" di Captions; teks diisi ulang tiap status helper/engine berubah. */
function renderEngineLine() {
  const el = $('engine-line-text');
  if (!el) return;
  if (state.settings.engine !== 'native') {
    el.textContent = t('engineLineBrowser', state.settings.device || 'auto');
    return;
  }
  const dev = nativeInfo ? (nativeInfo.device || state.settings.nativeDevice || 'auto') : null;
  el.textContent = nativeInfo
    ? t('engineLineNative', `${dev}${nativeInfo.model ? ' · ' + nativeInfo.model : ''}`)
    : t('engineLineOffline');
}

/** Ubin ikon berwarna (data-ctile) — satu sumber ikon untuk nav bawah, kartu, dan peta fitur. */
function paintTiles() {
  document.querySelectorAll('[data-ctile]').forEach((el) => {
    if (el.dataset.painted) return;
    try {
      el.innerHTML = colourTile(el.dataset.ctile, Number(el.dataset.size) || 24);
      el.dataset.painted = '1';
    } catch { /* nama ikon tak dikenal: biarkan kosong */ }
  });
}

// ---------------------------------------------------------------------------
// theme: auto (ikut sistem) | light | dark — disimpan di chrome.storage.local
function applyTheme() {
  const theme = state.settings.theme || 'auto';
  document.documentElement.classList.remove('theme-light', 'theme-dark');
  if (theme === 'light') document.documentElement.classList.add('theme-light');
  else if (theme === 'dark') document.documentElement.classList.add('theme-dark');
  document.querySelectorAll('#theme-toggle button').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
  syncPill('theme-toggle');
}

async function setTheme(theme) {
  const next = ['auto', 'light', 'dark'].includes(theme) ? theme : 'auto';
  state.settings.theme = next;
  await saveSettings();
  applyTheme();
  pushUiPrefs();
}

// Perubahan dari permukaan lain (panel kedua, halaman lab) tiba lewat
// chrome.storage.onChanged — terapkan langsung tanpa reload. Nilai tak
// dikenal diabaikan; nilai sama dilewati agar tak ada putaran umpan-balik.
function applyExternalSettings(next) {
  if (!next || typeof next !== 'object') return;
  if (['one', 'two'].includes(next.tabRows) && next.tabRows !== state.settings.tabRows) {
    state.settings.tabRows = next.tabRows;
    applyTabRows();
  }
  if (TCOLOURS.includes(next.translationColour) && next.translationColour !== state.settings.translationColour) {
    state.settings.translationColour = next.translationColour;
    applyTranslationColour();
  }
  if (['auto', 'light', 'dark'].includes(next.theme) && next.theme !== state.settings.theme) {
    state.settings.theme = next.theme;
    applyTheme();
  }
  if (
    RESKINS.includes(next.reskin) &&
    next.reskin !== state.settings.reskin
  ) {
    state.settings.reskin = next.reskin;
    applyReskin();
  }
}

// TIDE-012: 'tide' memakai theme-tide.css (token merek yravg). Helper belum mencerminkan 'tide'
// (UI_RESKINS di engine-rs mengabaikan nilai yang tidak dikenal), jadi pilihan ini lokal.
const RESKINS = ['yraverage', 'coretax', 'modern', 'tide'];

// Reskin pattern: hanya token visual lokal (aksen + radius), bukan branding.
function applyReskin() {
  const reskin = RESKINS.includes(state.settings.reskin)
    ? state.settings.reskin
    : 'yraverage';
  document.documentElement.dataset.reskin = reskin;
  document.querySelectorAll('#reskin-toggle button').forEach((b) => {
    const active = b.dataset.reskin === reskin;
    b.classList.toggle('active', active);
    b.setAttribute('aria-checked', String(active));
  });
}

async function setReskin(reskin) {
  const next = RESKINS.includes(reskin) ? reskin : 'yraverage';
  state.settings.reskin = next;
  await saveSettings();
  applyReskin();
  pushUiPrefs();
}

// Cermin corak ke Native Helper (best-effort, hanya saat helper online).
// chrome.storage.local tetap sumber utama; helper menyimpan salinan bersama.
function pushUiPrefs() {
  if (!nativeInfo) return;
  nativeSetUiPrefs(state.settings.nativeUrl || DEFAULT_NATIVE_URL, {
    theme: state.settings.theme,
    reskin: state.settings.reskin,
    captionSurface,
    // App window: the engine keeps the language pair so the island and this window share one choice.
    // shortcut: engine /ui-prefs drops keys it does not list; needs srcLang/tgtLang in its whitelist, harmless until then.
    ...(isWebHost() ? { srcLang: state.srcLang, tgtLang: state.tgtLang } : {}),
  }).catch(() => {});
}

// Tarik salinan bersama saat memakai mesin native — hanya bila helper sudah
// menyimpan pilihan (stored), supaya bawaan lokal tak tertimpa default.
async function pullUiPrefs() {
  if (!nativeInfo) return;
  const res = await nativeGetUiPrefs(state.settings.nativeUrl || DEFAULT_NATIVE_URL);
  if (!res?.stored) return;
  let changed = false;
  if (isWebHost()) {
    const src = res.prefs?.srcLang;
    const tgt = res.prefs?.tgtLang;
    let langs = false;
    if (SOURCE_LANGS.some(([c]) => c === src) && src !== state.srcLang) { state.srcLang = src; langs = true; }
    if (TARGET_LANGS.some(([c]) => c === tgt) && tgt !== state.tgtLang) { state.tgtLang = tgt; langs = true; }
    if (langs) {
      $('src-lang').value = state.srcLang;
      $('tgt-lang').value = state.tgtLang;
      renderInterpreterUi();
      updateWarning();
      persistLastConfig();
    }
  }
  if (['auto', 'light', 'dark'].includes(res.prefs?.theme) && res.prefs.theme !== state.settings.theme) {
    state.settings.theme = res.prefs.theme;
    changed = true;
  }
  if (
    RESKINS.includes(res.prefs?.reskin) &&
    res.prefs.reskin !== state.settings.reskin
  ) {
    state.settings.reskin = res.prefs.reskin;
    changed = true;
  }
  if (changed) {
    await saveSettings();
    applyTheme();
    applyReskin();
  }
}

// ---------------------------------------------------------------------------
// settings
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings) Object.assign(state.settings, settings);
  // Engine-hosted window: defaults to the engine it was served from; a saved choice still wins.
  if (isWebHost()) state.settings = { ...state.settings, ...window.__ysmWebHost.withDefaults(settings) };
  await loadCaptionSurface();
  if (!UI_LANGS.some(([c]) => c === state.settings.uiLang)) {
    state.settings.uiLang = 'en';
  }
  // Installs from before the interpreter chooser have no `interpreter` key —
  // they normalise to the one-way behaviour they already had.
  state.settings.interpreter = normalizeInterpreter(state.settings, state.srcLang, state.tgtLang);
  if (state.settings.interpreter.mode === 'consecutive') {
    state.srcLang = state.settings.interpreter.a;
    state.tgtLang = state.settings.interpreter.b;
  }
  renderUiLangToggle();
  renderEngineToggle();
  if (!['auto', 'light', 'dark'].includes(state.settings.theme)) {
    state.settings.theme = 'auto';
  }
  applyTheme();
  if (!RESKINS.includes(state.settings.reskin)) {
    state.settings.reskin = 'yraverage';
  }
  applyReskin();
  if (!['one', 'two'].includes(state.settings.tabRows)) state.settings.tabRows = 'one';
  applyTabRows();
  applyCaptionSurface();
  if (!TCOLOURS.includes(state.settings.translationColour)) state.settings.translationColour = 'indigo';
  applyTranslationColour();
  renderEngineLine();
  document.querySelectorAll('#mirror-toggle button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mirror === state.settings.mirror),
  );
  document.querySelectorAll('#device-toggle button').forEach((b) =>
    b.classList.toggle('active', b.dataset.device === state.settings.device),
  );
  syncPill('mirror-toggle');
  syncPill('device-toggle');
  $('native-block').classList.toggle('hidden', state.settings.engine !== 'native');
  // Only measurable once the block is actually shown.
  syncPill('native-device-toggle', false);
  $('native-url').value = state.settings.nativeUrl || DEFAULT_NATIVE_URL;
  renderNativeDeviceUi();
  syncDualLineCheckboxes();
  syncRefineCheckboxes();
  $('font-size').value = state.settings.overlayFontSize;
  applyInterpreterUi();
  state.settings.exportOptions = exportOptions();
}

// ---------------------------------------------------------------------------
// export options (SRT / VTT / TXT, lintas OS)
//
// Formatnya sama di semua OS; yang berbeda hanya detail berkas (akhir baris,
// BOM, nama berkas). Defaultnya mengikuti OS yang terdeteksi, tapi tetap bisa
// diubah — pengguna Linux yang mengirim berkas ke rekan Windows butuh CRLF.
const EXPORT_OS = detectOs();

function exportOptions() {
  return normalizeExportOptions(state.settings.exportOptions, EXPORT_OS);
}

function currentExportSource() {
  const lines = state.mode === 'offline' ? state.offlineLines : state.realtimeLines;
  if (!lines.length) return null;
  return {
    lines,
    count: lines.length,
    title: state.mode === 'offline' ? state.offlineFile?.name || 'subtitles' : state.currentTab?.title || 'subtitles',
    url: state.mode === 'realtime' ? state.currentTab?.url || '' : '',
    srcLang: state.srcLang,
    tgtLang: state.task === 'translate' ? state.tgtLang : '',
    dualLine: state.settings.dualLine,
  };
}

async function updateExportOptions(patch) {
  state.settings.exportOptions = normalizeExportOptions({ ...exportOptions(), ...patch }, EXPORT_OS);
  await saveSettings();
  redrawHelperStatus?.();
}

let nativeInfo = null; // last /health result (null = offline/unknown)
/**
 * Large-file (>1.5 GiB) helper job shown in the Native Helper card.
 * { name, sizeBytes, progress 0–1, status idle|running|cancelling|cancelled|done|error, stage, jobId, cancellable }
 */
let largeFileJob = null;
/** @type {null | (() => void)} */
let redrawHelperStatus = null;
/** @type {null | (() => void)} */
let redrawHelperGuide = null;
/** Native Messaging host reachable? null = not tried yet (feeds the guide's diagnostics). */
let nativeHostInstalled = null;
let nativePollTimer = null;
let nativeBusy = false;
let lastNativeAutoStartMs = 0;
const NATIVE_AUTO_START_COOLDOWN_MS = 30_000;
let labEnsureAttempted = false;

/** Keadaan sambungan terakhir dari nativeHostConnection() — untuk diagnostik. */
let nativeHostConn = null;
let nativeHostProbePending = null;

function noteNativeHostResult(err) {
  if (!err) {
    nativeHostInstalled = true;
    nativeHostConn = { state: 'connected', connected: true, hostInstalled: true, error: null };
    return;
  }
  // Klasifikasikan lewat kontrak bersama: galat yang tak dikenal tidak boleh
  // meninggalkan status lama yang sudah basi.
  const state = classifyNativeHostError(err);
  nativeHostInstalled = hostInstalledFromState(state);
  nativeHostConn = { state, connected: false, hostInstalled: nativeHostInstalled, error: String(err?.message || err) };
}

/**
 * Tanya bridge Native Messaging apakah ia terhubung. Murah (ping, ~4 dtk) jadi
 * boleh dipanggil saat panel dibuka — tanpa ini diagnostik hanya tahu jawabnya
 * setelah pengguna menekan Start.
 */
async function probeNativeHost() {
  if (nativeHostProbePending) return nativeHostProbePending;
  nativeHostProbePending = (async () => {
    try {
      const r = await nativeHostConnection({ timeoutMs: 4_000 });
      nativeHostConn = r;
      nativeHostInstalled = r.hostInstalled;
      return r;
    } finally {
      nativeHostProbePending = null;
      redrawHelperGuide?.();
    }
  })();
  return nativeHostProbePending;
}

async function tryAutoStartNative() {
  if (nativeBusy || !nativeHostSupported()) return false;
  const now = Date.now();
  if (now - lastNativeAutoStartMs < NATIVE_AUTO_START_COOLDOWN_MS) return false;
  lastNativeAutoStartMs = now;
  try {
    const res = await nativeHostAction('start', { timeoutMs: 90_000 });
    noteNativeHostResult(null);
    return !!res?.ok;
  } catch (e) {
    noteNativeHostResult(e);
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
  redrawHelperStatus?.(); // the Helper page's Restart button follows busy
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
    pushUiPrefs(); // the island reads captionSurface from the helper
    const stale =
      nativeInfo.translate &&
      nativeInfo.features &&
      nativeInfo.features.translate_refine === false;
    setNativeUi({
      running: true,
      busy: false,
      detail: stale
        ? t('nativeStale', 'Helper running — click Restart to load latest features')
        : t(
            'nativeOnline',
            `${nativeInfo.engine} · ${nativeInfo.model}${nativeInfo.translate ? ' · +LLM translate' : ''}${nativeInfo.ffmpeg || nativeInfo.media_decoder ? '' : ' · ⚠ no ffmpeg'}`,
          ),
    });
    tryEnsureLab();
    if (!nativeDeviceInfo) refreshNativeDeviceInfo();
  } else {
    nativeDeviceInfo = null;
    setNativeUi({ running: false, busy: false, detail: t('nativeOffline') });
  }
  updateWarning();
  updateNativeHostHint();
  renderEngineLine();
  redrawHelperStatus?.();
  redrawHelperGuide?.();
  renderNativeModels();
  renderNativeDeviceUi();
  return nativeInfo;
}

// ---------------------------------------------------------------------------
// Helper compute device (CPU / GPU) — Windows/Linux faster-whisper; macOS = MLX.
/** Last /engine/device answer: { supported, device, active, compute, cuda_available } | null */
let nativeDeviceInfo = null;
let nativeDeviceMsg = null; // transient hint after a change ({ kind: 'restart'|'manual', device })

function helperIsApple() {
  return (nativeInfo?.device || '').toLowerCase() === 'apple-silicon' || nativeInfo?.engine === 'mlx-whisper';
}

function renderNativeDeviceUi() {
  const row = $('native-device-row');
  if (!row) return;
  const want = HELPER_DEVICE_OPTIONS.includes(state.settings.nativeDevice) ? state.settings.nativeDevice : 'auto';
  const apple = !!nativeInfo && helperIsApple();
  const active = (nativeInfo?.device || '').toLowerCase();
  const compute = nativeInfo?.compute || '';
  const cudaAvail = nativeDeviceInfo?.cuda_available;

  document.querySelectorAll('#native-device-toggle button').forEach((b) => {
    const d = b.dataset.hdevice;
    b.classList.toggle('active', apple ? d === 'auto' : d === want);
    b.setAttribute('aria-checked', String(apple ? d === 'auto' : d === want));
    b.disabled = apple;
    if (d === 'cuda' && cudaAvail === false && !apple) b.title = t('helperDeviceNoCuda');
    else b.removeAttribute('title');
  });

  const pill = $('native-device-active');
  if (nativeInfo) {
    const label = active === 'apple-silicon' ? 'Apple Silicon · MLX' : active || '—';
    pill.textContent = t('helperDeviceActive', label, active === 'apple-silicon' ? '' : compute);
    pill.className = `notes-pill ${active && active !== 'cpu' ? 'ready' : 'idle'}`;
  } else {
    pill.textContent = t('helperDeviceOffline');
    pill.className = 'notes-pill idle';
  }

  const hint = $('native-device-hint');
  let text = '';
  let warn = false;
  if (apple) {
    text = t('helperDeviceApple');
  } else if (nativeDeviceMsg) {
    text = nativeDeviceMsg.kind === 'manual' ? t('helperDeviceManual', nativeDeviceMsg.device) : t('helperDeviceRestart');
    warn = true;
  } else if (nativeInfo && want !== 'auto' && active && active !== want) {
    text = t('helperDeviceMismatch', want, active);
    warn = true;
  } else if (want === 'cuda' && cudaAvail === false) {
    text = t('helperDeviceNoCuda');
    warn = true;
  } else {
    text = t(`helperDevice${want[0].toUpperCase()}${want.slice(1)}_hint`);
  }
  hint.textContent = text;
  hint.classList.toggle('warn', warn);
}

async function refreshNativeDeviceInfo() {
  if (!nativeInfo) {
    nativeDeviceInfo = null;
    return;
  }
  try {
    nativeDeviceInfo = await nativeGetDevice(state.settings.nativeUrl || DEFAULT_NATIVE_URL);
  } catch {
    nativeDeviceInfo = null;
  }
  renderNativeDeviceUi();
}

async function setNativeDevice(device) {
  if (!HELPER_DEVICE_OPTIONS.includes(device) || helperIsApple()) return;
  state.settings.nativeDevice = device;
  await saveSettings();
  nativeDeviceMsg = null;
  if (nativeInfo) {
    try {
      const res = await nativeSetDevice(state.settings.nativeUrl || DEFAULT_NATIVE_URL, device);
      nativeDeviceMsg = res.supported ? { kind: 'restart', device } : { kind: 'manual', device };
      if (res.supported) nativeDeviceInfo = { ...(nativeDeviceInfo || {}), supported: true, device };
    } catch (e) {
      nativeDeviceMsg = { kind: 'manual', device };
    }
  }
  renderNativeDeviceUi();
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

// Models of the engine (GET /models): the fixed catalog, what is on disk, a picker and
// Download with progress. Refreshes on checkNative and, while a pull runs, every 1.5 s.
let modelsPollTimer = null;
let locOpen = null; // id of the model whose folder editor is open
let modelsSeq = 0; // only the newest render may touch the list: a slower earlier one would wipe a field being typed in
let locFocus = false; // focus the field once, right after the editor opens
let locDraft = ''; // what was typed there; survives the 1.5 s re-render while a transfer runs
// The engine's refusal codes for a folder change or a download, in words (POST /engine/models/location, /models/pull).
function locMessage(r) {
  const why = { 'bad-dir': 'modelsLocBadDir', 'dir-not-writable': 'modelsLocNotWritable', busy: 'modelsLocBusy', 'target-has-copy': 'modelsLocHasCopy', 'model-dir-unavailable': 'modelsDriveAway' }[r.code];
  if (r.code === 'not-enough-space') return t('modelsLocNoSpace', { need: fmtBytes(r.needBytes), free: fmtBytes(r.freeBytes) });
  return why ? t(why, { dir: r.dir || '' }) : r.error || 'failed';
}
async function renderNativeModels() {
  const host = $('native-models');
  if (!host) return;
  clearTimeout(modelsPollTimer);
  if (!nativeInfo) {
    host.replaceChildren();
    return;
  }
  const url = state.settings.nativeUrl || DEFAULT_NATIVE_URL;
  const seq = ++modelsSeq;
  const res = await nativeGetModels(url);
  if (seq !== modelsSeq) return;
  const catalog = res && Array.isArray(res.catalog) ? res.catalog : [];
  host.replaceChildren();
  if (!catalog.length) return; // an engine without the catalog: nothing to pick, nothing invented
  const rerender = () => renderNativeModels();
  const fail = (why) => showToast(t('modelsSetFailed', { why }), 'error');
  const choose = async (patch) => {
    const r = await nativeSetModels(url, patch);
    if (r.error) fail(r.error);
    rerender();
  };
  const row = ({ title, sub, selected, action, more = [], extra = [], bar, error }) => {
    const div = document.createElement('div');
    div.className = 'm-item';
    div.dataset.selected = selected ? 'true' : 'false';
    const meta = document.createElement('div');
    meta.className = 'm-meta';
    const t1 = document.createElement('div');
    t1.className = 'm-name';
    t1.textContent = title;
    const t2 = document.createElement('div');
    t2.className = 'm-sub';
    t2.textContent = sub;
    meta.append(t1, t2);
    if (bar != null) {
      const b = document.createElement('div');
      b.className = 'bar';
      const f = document.createElement('div');
      f.className = 'fill';
      f.style.width = `${Math.max(2, Math.min(100, bar))}%`;
      b.appendChild(f);
      meta.appendChild(b);
    }
    if (error) {
      const e = document.createElement('div');
      e.className = 'm-sub m-error';
      e.textContent = /^download failed/i.test(error) ? error : t('modelsFailed', { why: error }); // the engine's reason already says it
      meta.appendChild(e);
    }
    meta.append(...extra);
    div.appendChild(meta);
    const side = document.createElement('div');
    side.className = 'm-actions';
    if (selected) {
      const tag = document.createElement('span');
      tag.className = 'm-state done';
      tag.textContent = t('modelsInUse');
      side.appendChild(tag);
    }
    for (const a of [action, ...more]) {
      if (!a) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mini-btn';
      btn.textContent = a.label;
      btn.disabled = !!a.disabled;
      btn.addEventListener('click', a.run);
      side.appendChild(btn);
    }
    div.appendChild(side);
    return div;
  };
  let pulling = false;
  let moving = false;
  const note = (text, cls = '') => { const d = document.createElement('div'); d.className = `m-sub ${cls}`.trim(); d.textContent = text; return d; };
  const setLocation = async (id, dir) => {
    const r = await nativeSetModelLocation(url, id, dir);
    if (r.error) showToast(locMessage(r), 'error');
    else { locOpen = null; locDraft = ''; }
    rerender();
  };
  // The folder line, the drive-away and move states, and the typed-path editor, for a row whose engine reports a folder.
  const folderBits = (m, title) => {
    const extra = [];
    const more = [];
    if (typeof m.dir !== 'string') return { extra, more };
    extra.push(note(Number.isFinite(m.freeBytes) ? t('modelsFolderFree', { dir: m.dir, free: fmtBytes(m.freeBytes) }) : t('modelsFolder', { dir: m.dir }), 'm-dir'));
    if (m.dirAvailable === false) extra.push(note(t('modelsDriveAway', { dir: m.dir }), 'm-error'));
    if (m.moveError) extra.push(note(t('modelsMoveFailed', { why: m.moveError }), 'm-error'));
    if (m.moveWarning) extra.push(note(m.moveWarning));
    if (m.moving || m.pulling) return { extra, more };
    more.push({ label: t('modelsLocChange'), run() { locOpen = locOpen === m.id ? null : m.id; locFocus = locOpen != null; locDraft = locDraft || m.dir; rerender(); } });
    if (locOpen === m.id) {
      const ed = document.createElement('div');
      ed.className = 'm-loc';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'm-loc-input';
      inp.value = locDraft;
      inp.spellcheck = false;
      inp.setAttribute('aria-label', t('modelsLocLabel', { title }));
      inp.addEventListener('input', () => { locDraft = inp.value; });
      if (locFocus) { locFocus = false; setTimeout(() => { inp.focus(); inp.select(); }); }
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'mini-btn';
      go.textContent = t('modelsLocApply');
      go.addEventListener('click', () => (locDraft.trim() ? setLocation(m.id, locDraft.trim()) : showToast(t('modelsLocEmpty'), 'error')));
      ed.append(inp, go);
      if (!m.dirIsDefault) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'mini-btn';
        reset.textContent = t('modelsLocReset');
        reset.addEventListener('click', () => setLocation(m.id, null));
        ed.appendChild(reset);
      }
      extra.push(ed);
    }
    return { extra, more };
  };
  for (const [kind, heading] of [['asr', t('modelsAsr')], ['translate', t('modelsTranslate')]]) {
    const rows = catalog.filter((m) => m.kind === kind);
    if (!rows.length) continue;
    const h = document.createElement('div');
    h.className = 'models-title';
    h.textContent = heading;
    host.appendChild(h);
    if (kind === 'translate') {
      const anySelected = rows.some((m) => m.selected);
      host.appendChild(row({
        title: t('modelsOff'),
        sub: t('modelsOffSub'),
        selected: !anySelected,
        action: anySelected ? { label: t('modelsUse'), run: () => choose({ translate: 'off' }) } : null,
      }));
    }
    for (const m of rows) {
      const base = m.downloaded
        ? `${t('modelsOnDisk')} · ${fmtBytes(m.bytes)}`
        : t('modelsNotDownloaded', { size: fmtBytes(m.approxBytes) });
      const sub = !m.downloaded && m.partialBytes > 0 ? `${base}. ${t('modelsPartial', { done: fmtBytes(m.partialBytes) })}` : base;
      let action = null;
      let bar = null;
      if (m.pulling) {
        pulling = true;
        bar = Number.isFinite(m.pct) ? m.pct : m.bytesTotal > 0 ? (100 * m.bytesDone) / m.bytesTotal : 0;
        action = { label: t('modelsDownloading', { pct: `${Math.round(bar)}%` }), disabled: true, run() {} };
      } else if (!m.downloaded) {
        action = {
          label: m.pullError ? t('modelsRetry') : t('modelsDownload'),
          disabled: m.dirAvailable === false || !!m.moving,
          async run() {
            const r = await nativePullModel(url, m.id);
            if (r.error) showToast(locMessage(r), 'error');
            rerender();
          },
        };
      } else if (!m.selected) {
        action = { label: t('modelsUse'), run: () => choose({ [kind]: m.id }) };
      }
      const { extra, more } = folderBits(m, m.label || m.id);
      if (m.moving) {
        moving = true;
        bar = Number.isFinite(m.movePct) ? m.movePct : 0;
        extra.push(note(t('modelsMoving', { phase: m.movePhase || '', pct: Number.isFinite(m.movePct) ? `${Math.round(m.movePct)}%` : '' })));
        action = { label: t('modelsMovingBtn'), disabled: true, run() {} };
      }
      host.appendChild(row({ title: m.label || m.id, sub, selected: !!m.selected, action, more, extra, bar, error: m.pulling ? '' : m.pullError }));
    }
  }
  // A re-render would drop the focus (and the caret) of a path being typed, so progress waits while the field is focused.
  const again = () => (host.querySelector('.m-loc-input:focus') ? (modelsPollTimer = setTimeout(again, 1500)) : rerender());
  if (pulling || moving) modelsPollTimer = setTimeout(again, 1500);
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
    if (isWebHost()) {
      // No Native Messaging here: the island supervises the engine and starts it again when /health stops answering.
      if (action !== 'start') {
        await nativeShutdown(url);
        await new Promise((r) => setTimeout(r, 400));
      }
      if (action === 'restart') {
        const end = Date.now() + 45_000;
        while (Date.now() < end && !(await nativeHealth(url, 1000))) await new Promise((r) => setTimeout(r, 1000));
      }
    } else if (nativeHostSupported()) {
      let res;
      try {
        res = await nativeHostAction(action, { timeoutMs: 130_000 });
      } catch (e) {
        noteNativeHostResult(e);
        throw e;
      }
      noteNativeHostResult(null);
      if (!res?.ok) throw new Error(res?.error || 'Native host failed');
      if (action !== 'stop') {
        nativeDeviceMsg = null;
        nativeDeviceInfo = null;
      }
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
/** True when sidepanel runs under test/app.html (chrome-mock), not the extension. */
function isLabHarness() {
  return typeof window !== 'undefined' && (!!window.__chromeMockStore || isWebHost());
}

/** True when served by the engine at /app/ (Windows app window): src/web-host.js stands in for chrome.*. */
function isWebHost() {
  return typeof window !== 'undefined' && !!window.__ysmWebHost;
}

let labMediaEl = null;

function releaseLabCapture() {
  try {
    const s = window.__ysmCaptureStream;
    if (s?.getTracks) {
      for (const track of s.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  window.__ysmCaptureStream = null;
  window.__ysmLabClock = null;
  if (labMediaEl) {
    try {
      labMediaEl.pause();
      labMediaEl.removeAttribute('src');
      labMediaEl.load();
      labMediaEl.remove();
    } catch {
      /* ignore */
    }
    labMediaEl = null;
  }
}

/** Looping CC0 / speech.wav via captureStream — no extension APIs. */
async function acquireLabDemoStream() {
  releaseLabCapture();
  let url = '/speech.wav';
  let title = 'Lab demo — looping speech.wav';
  try {
    const cat = await loadSampleCatalog();
    const sample =
      firstSampleForPair(cat, `${state.srcLang}-${state.tgtLang}`) ||
      firstSampleForPair(cat, `${state.srcLang}-en`) ||
      cat?.samples?.[0];
    if (cat && sample?.file) {
      url = `${cat.base}${sample.file}`;
      title = sample.label || sample.file;
    }
  } catch {
    /* keep speech.wav fallback */
  }

  const el = document.createElement('audio');
  el.src = url;
  el.loop = true;
  el.controls = true;
  el.crossOrigin = 'anonymous';
  el.setAttribute('playsinline', '');
  el.style.cssText =
    'position:fixed;right:12px;bottom:12px;width:240px;z-index:40;border-radius:8px;background:#111';
  document.body.appendChild(el);
  labMediaEl = el;

  try {
    await el.play();
  } catch (e) {
    releaseLabCapture();
    throw new Error(`Lab demo audio blocked: ${e.message || e}. Click the page, then Start again.`);
  }

  const raw =
    typeof el.captureStream === 'function'
      ? el.captureStream()
      : typeof el.mozCaptureStream === 'function'
        ? el.mozCaptureStream()
        : null;
  const audioTracks = raw?.getAudioTracks?.() || [];
  if (!audioTracks.length) {
    releaseLabCapture();
    throw new Error('Could not capture audio from the lab demo clip (captureStream).');
  }

  const stream = new MediaStream(audioTracks);
  window.__ysmCaptureStream = stream;
  window.__ysmLabClock = () => (labMediaEl && Number.isFinite(labMediaEl.currentTime) ? labMediaEl.currentTime : 0);

  state.currentTab = { id: 1, title, url, favIconUrl: '' };
  $('tab-title').textContent = title;
  $('tab-url').textContent = url;
  $('tab-favicon').src = chrome.runtime.getURL('icons/icon16.png');
  updateButtons();
  return stream;
}

/** Share a Chrome tab/window with audio (best extension-equivalent in a normal tab). */
async function acquireLabDisplayStream() {
  releaseLabCapture();
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('getDisplayMedia is unavailable in this browser.');
  }
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  const audioTracks = display.getAudioTracks();
  if (!audioTracks.length) {
    for (const track of display.getTracks()) track.stop();
    throw new Error(t('noAudioShared'));
  }
  for (const track of display.getVideoTracks()) track.stop();

  const stream = new MediaStream(audioTracks);
  const t0 = performance.now();
  window.__ysmCaptureStream = stream;
  window.__ysmLabClock = () => (performance.now() - t0) / 1000;
  audioTracks[0].addEventListener('ended', () => {
    if (state.running) onStop();
  });

  state.currentTab = {
    id: 1,
    title: 'Shared tab / window (getDisplayMedia)',
    url: location.href,
    favIconUrl: '',
  };
  $('tab-title').textContent = state.currentTab.title;
  $('tab-url').textContent = 'Pick → share a tab and enable audio';
  $('tab-favicon').src = chrome.runtime.getURL('icons/icon16.png');
  updateButtons();
  return stream;
}

function renderTargetCard(tab, { live = false, elsewhere = false } = {}) {
  const fallbackIcon = chrome.runtime.getURL('icons/icon16.png');
  if (tab) {
    $('tab-title').textContent = tab.title || tab.url;
    $('tab-url').textContent = tab.url || '';
    $('tab-favicon').src = tab.favIconUrl || fallbackIcon;
  } else {
    $('tab-title').textContent = t('noTab');
    $('tab-url').textContent = '';
    $('tab-favicon').src = fallbackIcon;
  }
  const card = $('rt-target');
  card.classList.toggle('live', live);
  card.classList.toggle('elsewhere', live && elsewhere);
  const tag = $('target-tag');
  tag.classList.toggle('live', live);
  tag.textContent = live ? (elsewhere ? t('liveOtherTab') : t('liveThisTab')) : t('currentPage');
  $('btn-goto-session-tab').classList.toggle('hidden', !(live && elsewhere));
  $('session-tab-hint').classList.toggle('hidden', !(live && elsewhere));
}

// Sesi realtime TIDAK ikut berpindah saat pengguna ganti tab, jadi kartu
// target tidak boleh berpura-pura ikut pindah: selama sesi hidup ia tetap
// menunjuk state.sessionTab.
async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const usable = tab && /^https?:/.test(tab.url || '') ? tab : null;
  state.currentTab = usable;
  if (state.mode === 'realtime' && state.running && state.sessionTab) {
    const elsewhere = !tab || tab.id !== state.sessionTab.id;
    if (!elsewhere && usable) state.sessionTab = { ...state.sessionTab, ...usable };
    renderTargetCard(state.sessionTab, { live: true, elsewhere });
  } else {
    renderTargetCard(usable);
  }
  updateButtons();
}

async function rememberSessionTab(tabId) {
  if (tabId == null) {
    state.sessionTab = state.currentTab;
    return;
  }
  try {
    state.sessionTab = await chrome.tabs.get(tabId);
  } catch {
    state.sessionTab = state.currentTab;
  }
}

function gotoSessionTab() {
  const tab = state.sessionTab;
  if (!tab) return;
  chrome.tabs.update?.(tab.id, { active: true })?.catch?.(() => {});
  if (tab.windowId != null) chrome.windows?.update?.(tab.windowId, { focused: true })?.catch?.(() => {});
}

function updateButtons() {
  const running = state.mode === 'realtime' ? state.running : state.offlineRunning;
  $('btn-start').disabled =
    running ||
    state.offlineStaging ||
    (state.mode === 'realtime' ? !state.currentTab : !state.offlineFile);
  $('btn-stop').disabled = !running;
  $('btn-start').textContent = state.mode === 'offline' ? t('startFile') : t('startCaptions');
  $('btn-stop').textContent = state.mode === 'offline' ? t('cancelTask') : t('stopCaptions');
}

function setStatus(text, cls = '') {
  const el = $('status-line');
  el.className = 'status-line ' + cls;
  $('status-text').textContent = text;
  const dot = $('status-dot');
  dot.classList.toggle('hidden', !text);
  dot.className =
    'status-dot ' + (!text ? 'hidden' : cls === 'ok' ? 'on' : cls === 'error' ? 'error' : 'busy');
}

/** Denyut singkat saat satu baris subtitel mendarat — tanda sesi masih hidup. */
function flashStatusDot() {
  const dot = $('status-dot');
  if (!dot || dot.classList.contains('hidden')) return;
  dot.classList.remove('flash');
  void dot.offsetWidth;
  dot.classList.add('flash');
}

/* ---- Strip langkah mulai realtime -------------------------------------
 * `key` = langkah yang sedang berjalan; langkah sebelumnya jadi centang.
 * null menyembunyikan strip; { failed: true } menandai `key` merah. */
const START_STEPS = ['capture', 'models', 'warmup', 'listening'];
function setStartStep(key, { failed = false } = {}) {
  const host = $('start-steps');
  if (!host) return;
  if (!key) {
    host.classList.add('hidden');
    host.querySelectorAll('li').forEach((li) => (li.className = ''));
    return;
  }
  host.classList.remove('hidden');
  const idx = START_STEPS.indexOf(key);
  host.querySelectorAll('li').forEach((li, i) => {
    li.className = i < idx ? 'done' : i === idx ? (failed ? 'failed' : 'current') : '';
    if (i === idx && key === 'listening' && !failed) li.className = 'done current';
  });
}

/* ---- Kartu kendala -----------------------------------------------------
 * Pesan mentah dari pipeline diterjemahkan lib/friendly-error.js menjadi
 * kategori, lalu panel menampilkan judul + langkah pemulihan + satu aksi. */
function showError(raw, { statusText } = {}) {
  const { key, action, detail } = classifyError(raw);
  const title = t(errTitleKey(key));
  const hint = t(errHintKey(key));
  setStatus(statusText ?? title, key === 'cancelled' ? '' : 'error');
  const box = $('error-box');
  if (!box) return;
  if (key === 'cancelled') {
    hideError();
    return;
  }
  $('error-title').textContent = title;
  $('error-hint').textContent = hint;
  const showDetail = detail && detail !== title && key !== 'captureBlocked';
  $('error-detail-wrap').classList.toggle('hidden', !showDetail);
  $('error-detail-wrap').open = false;
  $('error-detail').textContent = detail;
  const btn = $('btn-error-action');
  btn.classList.toggle('hidden', !action);
  btn.dataset.action = action || '';
  btn.textContent =
    action === 'pick' ? t('errActionPick') : action === 'settings' ? t('errActionSettings') : action === 'download' ? t('errActionDownload') : t('errActionRetry');
  missingModelId = action === 'download' ? (detail.match(/model-not-downloaded\s+(\S+)/)?.[1] || '') : '';
  box.classList.remove('hidden');
}

function hideError() {
  $('error-box')?.classList.add('hidden');
}

let missingModelId = ''; // the model the last "not downloaded" error named
async function pullMissingModel() {
  const r = missingModelId ? await nativePullModel(state.settings.nativeUrl || DEFAULT_NATIVE_URL, missingModelId) : { error: 'no model named' };
  if (r.error) return showToast(locMessage(r), 'error');
  showToast(t('modelsPullStarted'));
  openSettings();
  setSettingsTab('models');
}

function onErrorAction() {
  const action = $('btn-error-action').dataset.action;
  hideError();
  if (action === 'download') void pullMissingModel();
  else if (action === 'pick') onPickManually();
  else if (action === 'settings') $('btn-settings').click();
  else if (action === 'retry') onStart();
}

// Toast umpan balik: ekspor + notulen. aria-live di #toast-stack agar
// pembaca layar ikut dapat kabar; auto-hilang 5 dtk, bisa ditutup manual.
function showToast(msg, kind = 'ok') {
  const stack = $('toast-stack');
  if (!stack || !msg) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (kind === 'error' ? 'error' : 'ok');
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const body = document.createElement('span');
  body.className = 'toast-msg';
  body.textContent = msg;
  const close = document.createElement('button');
  close.className = 'toast-close';
  close.type = 'button';
  close.setAttribute('aria-label', '✕');
  close.textContent = '✕';
  const dismiss = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  };
  close.addEventListener('click', dismiss);
  el.append(body, close);
  stack.appendChild(el);
  while (stack.children.length > 3) stack.firstChild.remove();
  setTimeout(() => {
    if (el.isConnected) dismiss();
  }, 5000);
}
if (typeof window !== 'undefined') window.__ysmToast = showToast;

async function startWithStream(streamId, captureType) {
  setStatus(t('loadingModels'));
  setStartStep('models');
  state.realtimeLines = [];
  clearLivePreview();
  $('live-preview').classList.remove('hidden');
  const res = await toBG('panel-start-realtime', {
    ...currentConfig(),
    streamId,
    captureType,
    tabTitle: state.currentTab?.title,
    tabUrl: state.currentTab?.url,
  });
  if (res?.ok) {
    state.running = true;
    state.sessionTab = state.currentTab;
    syncCaptureStamp();
    $('pick-hint').classList.add('hidden');
    updateButtons();
    refreshTab();
  } else if (res?.error) {
    if (isLabHarness()) releaseLabCapture();
    showCaptureError(res.error);
  }
}

function showCaptureError(message) {
  const blocked = /invoked|activeTab|not been invoked/i.test(message);
  showError(message, { statusText: blocked ? t('needInvoke') : undefined });
  setStartStep('capture', { failed: true });
  if (blocked) {
    $('pick-hint').textContent = t('pickHint');
    $('pick-hint').classList.remove('hidden');
  }
}

// Teams-style manual picker: the user chooses a tab/window/screen and whether
// to share its audio. The picker itself is the consent, so this path never
// hits the "extension has not been invoked" restriction.
function onPickManually() {
  if (isLabHarness()) {
    void (async () => {
      $('pick-hint').textContent = t('pickHintLab');
      $('pick-hint').classList.remove('hidden');
      try {
        setStatus(t('pickHintLab'));
        await acquireLabDisplayStream();
        await startWithStream(null, 'media');
      } catch (e) {
        if (e?.name === 'NotAllowedError' || /Permission denied|dismissed/i.test(String(e?.message || e))) {
          setStatus(t('cancelled'));
        } else {
          setStatus(String(e?.message || e), 'error');
        }
      }
    })();
    return;
  }
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

// One start at a time: a second click (double-click, the app shell's retry) would open a second
// share picker or restart the lab sample under the first one.
let starting = false;
async function onStart() {
  if (starting) return;
  starting = true;
  $('btn-start').disabled = true;
  try {
    await startOnce();
  } finally {
    starting = false;
    updateButtons();
  }
}

async function startOnce() {
  if (state.mode === 'realtime') {
    persistLastConfig();
    if (isLabHarness()) {
      try {
        setStatus(t('loadingModels'));
        clearLivePreview();
        $('live-preview').classList.remove('hidden');
        // App window: Start asks which tab/window/screen to caption; the lab plays a sample instead.
        await (isWebHost() ? acquireLabDisplayStream() : acquireLabDemoStream());
        await startWithStream(null, 'media');
      } catch (e) {
        releaseLabCapture();
        setStatus(String(e?.message || e), 'error');
      }
      return;
    }
    if (!state.currentTab) return;
    hideError();
    setStatus(t('requestingCapture'));
    setStartStep('capture');
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
      syncCaptureStamp();
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
    state.sessionTab = null;
    syncCaptureStamp();
    if (isLabHarness()) releaseLabCapture();
    setStatus('');
    setStartStep(null);
    hideError();
    updateButtons();
    refreshTab();
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
  largeFileJob = null;
  redrawHelperStatus?.();
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
function appendLiveLine(host, text, tag = '', marks = []) {
  if (!text) return;
  const div = document.createElement('div');
  div.className = 'line';
  if (tag) {
    const badge = document.createElement('span');
    badge.className = 'dir-tag';
    badge.textContent = tag;
    div.appendChild(badge);
  }
  // Glossary add-in: wrap each fixed term in <mark> (markedHtml escapes the text).
  if (marks.length) div.insertAdjacentHTML('beforeend', markedHtml(text, marks));
  else div.appendChild(document.createTextNode(text));
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

function pushLive({ source, translation, rawSource, rawTranslation, t0, t1, interim, partial, dir }) {
  if (interim && partial) {
    if (source) setLiveInterim($('live-src-lines'), source);
    if (translation) setLiveInterim($('live-tgt-lines'), translation);
    return;
  }
  if (interim) return;
  setLiveInterim($('live-src-lines'), '');
  setLiveInterim($('live-tgt-lines'), '');
  // Two-way lines say which way this utterance went; one-way stays untagged.
  const srcTag = dir?.src ? dir.src.toUpperCase() : '';
  const dirTag = dir?.src && dir?.tgt ? `${dir.src.toUpperCase()} \u2192 ${dir.tgt.toUpperCase()}` : '';
  // Glossary add-in (caption.final hook): fix terms in the shown line and in the stored line the exports read.
  const fix = (src, tgt) => glossaryCaption({ src, tgt }) || { src, tgt, marks: { src: [], tgt: [] } };
  const shown = fix(source || '', translation || '');
  if (source) appendLiveLine($('live-src-lines'), shown.src, srcTag, shown.marks.src);
  if (translation) appendLiveLine($('live-tgt-lines'), shown.tgt, dirTag, shown.marks.tgt);
  if ((source || translation) && (t0 != null || t1 != null)) {
    const kept = fix(rawSource ?? source ?? '', rawTranslation ?? translation ?? '');
    state.realtimeLines.push({
      t0: t0 ?? 0,
      t1: t1 ?? (t0 ?? 0) + 3,
      src: kept.src,
      tgt: kept.tgt,
    });
    redrawHelperStatus?.();
  }
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
  redrawHelperStatus?.();
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

async function exportSession({ lines, title, url, kind, dualLine, srcLang, tgtLang }) {
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
  else if (kind === 'md') out = formatMarkdown(norm, { ...meta, dualLine: meta.dualLine });
  else if (kind === 'csv') out = formatCsv(norm, meta);
  else if (kind === 'json') out = formatJson(norm, { ...meta, srcLang: state.srcLang, tgtLang: state.tgtLang });
  else out = formatTxt(norm, meta);
  const opts = exportOptions();
  out = applyExportOptions(out, opts);
  const name = exportFilename(title || 'subtitles', kind, {
    srcLang: srcLang ?? state.srcLang,
    tgtLang: tgtLang ?? (meta.dualLine || state.task === 'translate' ? state.tgtLang : ''),
    langSuffix: opts.langSuffix,
  });
  try {
    const res = await saveExportFile(name, out);
    // Jalur folder → tersimpan; jalur unduhan → berkas terunduh. Keduanya
    // butuh kabar karena status-line saja mudah terlewat saat tab Notes aktif.
    const msg = res.saved ? t('savedTo', res.path) : t('downloadedTo', name);
    setStatus(msg, 'ok');
    showToast(msg, 'ok');
  } catch (e) {
    const msg = t('exportFailed', String(e?.message || e));
    setStatus(msg, 'error');
    showToast(msg, 'error');
  }
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
  // Pencarian mencakup isi transkrip, bukan hanya judul — itu yang diingat
  // pengguna tentang sebuah sesi.
  const query = $('history-search')?.value || '';
  const shown = searchSessions(history, query);
  if (!shown.length) {
    host.innerHTML = `<div class="empty">${t('historyNoMatch', query.trim())}</div>`;
    return;
  }
  if (query.trim()) {
    const count = document.createElement('div');
    count.className = 'h-meta';
    count.textContent = t('historyMatchCount', shown.length, history.length);
    host.appendChild(count);
  }
  for (const h of shown) {
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
        <button class="mini-btn h-open" data-i18n="historyOpen">Open</button>
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
    for (const hit of matchingLines(h, query)) {
      const snip = document.createElement('div');
      snip.className = 'h-snippet';
      snip.textContent = `“${hit.tgt || hit.src || ''}”`;
      div.appendChild(snip);
    }
    div.querySelector('.h-open').addEventListener('click', (e) => {
      e.stopPropagation();
      loadHistorySession(h);
    });
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

/**
 * Muat kembali sesi tersimpan ke panel dan tunjukkan posisi terakhirnya.
 *
 * Sebelumnya entri riwayat hanya bisa diekspor atau dihapus — transkripnya
 * tidak bisa dibuka lagi. Untuk sesi realtime, transkrip di-cache per URL +
 * pasangan bahasa, jadi memulai sesi baru pada URL yang sama otomatis
 * menyambung dari `cacheMaxTime`; pemuat ini menunjukkan di mana itu.
 */
function loadHistorySession(h) {
  const lines = (h?.lines || []).map((l) => ({
    t0: l.t0 ?? (l.t ?? 0) / 1000,
    t1: l.t1 != null && l.t1 > 1000 ? l.t1 / 1000 : (l.t1 ?? ((l.t ?? 0) / 1000 + 3)),
    src: l.src || l.source || '',
    tgt: l.tgt || l.translation || '',
  }));
  if (!lines.length) {
    setStatus(t('exportNoSource'), 'error');
    return;
  }
  setMode('offline');            // panel hasil dipakai bersama mode luring
  state.offlineLines = [];
  $('off-lines').innerHTML = '';
  $('off-results').classList.remove('hidden');
  for (const line of lines) pushOfflineLine({ line });
  state.offlineFile = { name: h.title || 'session' };
  const lastAt = fmtTs(lines[lines.length - 1].t1);
  $('off-progress-text').textContent = `${lines.length} ${t('lines')}`;
  setStatus(t('historyLoaded', lines.length, lastAt), 'ok');
  if (h.url) showToast(t('historyResume', h.url), 'ok');
  redrawHelperStatus?.();
}

function exportHistory(h, kind) {
  exportSession({
    lines: h.lines || [],
    title: h.title,
    url: h.url,
    kind,
    srcLang: h.srcLang,
    tgtLang: h.tgtLang,
  });
}

async function refreshExportFolderUi() {
  await loadExportDir();
  const label = exportDirLabel();
  $('export-folder-label').textContent = label ? `${t('exportFolderSet')}: ${label}` : t('exportFolderNone');
  $('btn-clear-export-folder').classList.toggle('hidden', !label);
  // Tujuan yang sama, dieja di sebelah tombol ekspor supaya pengguna tahu
  // berkasnya mendarat di mana SEBELUM menekan.
  const dest = $('export-dest-text');
  if (dest) dest.textContent = label ? t('exportDestFolder', label) : t('exportDestDownloads');
  redrawHelperStatus?.();
}

// ---------------------------------------------------------------------------
// incoming messages
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'panel') return;
  switch (msg.type) {
    case 'state':
      state.running = !!msg.data.active;
      syncCaptureStamp();
      updateButtons();
      if (!state.running && state.mode === 'realtime') {
        state.sessionTab = null;
        setStatus('');
        setStartStep(null);
        refreshTab();
      } else if (state.running && msg.data.tabId != null && state.sessionTab?.id !== msg.data.tabId) {
        rememberSessionTab(msg.data.tabId).then(refreshTab);
      }
      break;
    case 'subtitle':
      pushLive(msg.data);
      if (!msg.data?.interim) flashStatusDot();
      break;
    case 'perf-sample':
      perfPanel?.push(msg.data);
      break;
    case 'pipeline-status': {
      const s = msg.data?.state;
      if (s === 'loading') {
        const d = msg.data?.detail;
        setStatus(d === 'asr' ? t('loadingAsr') : d === 'translator' ? t('loadingTranslator') : t('loadingModels'));
        setStartStep('models');
      } else if (s === 'warmup') {
        setStatus(t('warmingUp'));
        setStartStep('warmup');
      } else if (s === 'listening') {
        const tr = msg.data.translate;
        setStatus(`${t('listening')} — ${activeAsrLabel()} (${msg.data.device || ''})${tr === 'loading' ? ` · ${t('translateLoading')}` : tr === 'missing' ? ` · ${t('translateMissing')}` : ''}`, 'ok');
        setStartStep('listening');
      }
      break;
    }
    case 'error':
      showError(msg.data?.message || 'Error');
      if (state.mode === 'realtime') {
        const li = $('start-steps')?.querySelector('li.current');
        setStartStep(li?.dataset?.step || 'models', { failed: true });
      }
      state.running = false;
      syncCaptureStamp();
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
      showError(`Model: ${msg.data?.message || 'download failed'}`);
      break;
    case 'offline-line':
      pushOfflineLine(msg.data);
      break;
    case 'offline-progress': {
      const d = msg.data;
      if (d.large) {
        const pct = Math.max(0, Math.min(100, Math.round(d.pct || 0)));
        largeFileJob = {
          name: d.name || state.offlineFile?.name || '',
          sizeBytes: d.sizeBytes || state.offlineFile?.size || 0,
          progress: pct / 100,
          status: d.stage === 'cancelling' ? 'cancelling' : 'running',
          stage: d.stage,
          jobId: d.jobId || largeFileJob?.jobId || null,
          loaded: d.loaded,
          total: d.total,
          idx: d.idx,
          count: d.total && d.idx != null ? d.total : undefined,
          elapsedS: d.elapsedS,
          cancellable: d.stage !== 'cancelling',
        };
        const stageLabel = t(`lfStage_${d.stage}`, d.stage);
        setStatus(`${activeAsrLabel()} · ${stageLabel} ${pct}%`);
        $('off-progress-text').textContent =
          d.stage === 'upload' && d.total
            ? `${stageLabel} ${pct}% · ${fmtBytes(d.loaded || 0)} / ${fmtBytes(d.total)}`
            : d.total && d.idx != null
              ? `${stageLabel} · ${d.idx} / ${d.total}`
              : `${stageLabel} ${pct}%`;
        redrawHelperStatus?.();
        break;
      }
      if (d.stage === 'transcribe' && d.total) {
        setStatus(`${activeAsrLabel()} · ${t('processing')} ${d.idx || 0}/${d.total}`);
        $('off-progress-text').textContent = `${activeAsrLabel()} · ${d.idx || 0} / ${d.total}`;
      } else {
        setStatus(`${activeAsrLabel()} · ${t('processing')} (${d.stage})`);
      }
      break;
    }
    case 'offline-done':
      state.offlineRunning = false;
      syncCaptureStamp();
      if (largeFileJob) {
        largeFileJob = { ...largeFileJob, progress: 1, status: 'done', stage: 'done', cancellable: false };
        redrawHelperStatus?.();
      }
      setStatus(t('done'), 'ok');
      updateButtons();
      renderHistory();
      break;
    case 'offline-error':
      state.offlineRunning = false;
      syncCaptureStamp();
      if (largeFileJob) {
        largeFileJob = {
          ...largeFileJob,
          status: msg.data?.cancelled ? 'cancelled' : 'error',
          stage: msg.data?.cancelled ? 'cancelled' : 'error',
          error: msg.data?.cancelled ? '' : msg.data?.message || 'Error',
          cancellable: false,
        };
        redrawHelperStatus?.();
      }
      if (msg.data?.cancelled) {
        setStatus(t('cancelled'));
        hideError();
      } else {
        showError(msg.data?.message || 'Error');
      }
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
  paintTiles();
  mountPills();
  mountPanels();
  // Label widths change with the UI language and with the panel width.
  window.addEventListener('resize', () => resyncPills(false));
  document.querySelectorAll('#view-tabs button').forEach((b) =>
    b.addEventListener('click', () => setView(b.dataset.view)),
  );
  document.querySelectorAll('#density-toggle [data-density-mode]').forEach((b) =>
    b.addEventListener('click', () => applyDensity(b.dataset.densityMode)),
  );
  document.querySelectorAll('.bottom-nav-item').forEach((b) =>
    b.addEventListener('click', () => setView(b.dataset.view)),
  );
  // ⌘⇧F / Ctrl+Shift+F — tandai momen. Hanya saat tampilan Notulen terlihat
  // dan ada tugas tangkap yang berjalan; tombolnya sendiri yang menyimpan,
  // jadi pintasan ini cukup menekannya (satu jalur, satu aturan).
  document.addEventListener('keydown', (e) => {
    // Tahan tombol ≠ banjir tanda: satu tekan, satu tanda.
    if (e.repeat || e.isComposing) return;
    const mod = /^Mac/i.test(navigator.platform || '') ? e.metaKey : e.ctrlKey;
    if (!mod || !e.shiftKey || e.altKey || (e.key || '').toLowerCase() !== 'f') return;
    if (state.view !== 'notes' || !getCapture().running) return;
    const btn = $('btn-flag-moment');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    btn.click();
  });
  document.querySelectorAll('#mode-toggle button').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode)),
  );
  document.querySelectorAll('#task-toggle button').forEach((b) =>
    b.addEventListener('click', () => setTask(b.dataset.task)),
  );
  document.querySelectorAll('#theme-toggle button').forEach((b) =>
    b.addEventListener('click', () => setTheme(b.dataset.theme)),
  );
  document.querySelectorAll('#reskin-toggle button').forEach((b) =>
    b.addEventListener('click', () => setReskin(b.dataset.reskin)),
  );
  document.querySelectorAll('#asr-preset-toggle button').forEach((b) =>
    b.addEventListener('click', async () => {
      const key = ASR_PRESETS[b.dataset.preset];
      if (!key || !ASR_MODELS[key]) return;
      state.settings.asrModel = key;
      await saveSettings();
      renderModelLists();
      updateWarning();
    }),
  );
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area && area !== 'local') return;
    applyExternalSettings(changes.settings?.newValue);
  });
  $('btn-reskin-reset')?.addEventListener('click', () => setReskin('yraverage'));
  $('src-lang').addEventListener('change', (e) => {
    state.srcLang = e.target.value;
    renderInterpreterUi();
    updateWarning();
    persistLastConfig();
    if (isWebHost()) pushUiPrefs();
    redrawHelperStatus?.();
  });
  $('tgt-lang').addEventListener('change', (e) => {
    state.tgtLang = e.target.value;
    renderInterpreterUi();
    updateWarning();
    persistLastConfig();
    if (isWebHost()) pushUiPrefs();
    redrawHelperStatus?.();
  });

  $('btn-interpreter').addEventListener('click', openInterpreterModal);
  $('btn-close-interpreter').addEventListener('click', () =>
    $('interpreter-modal').classList.add('hidden'),
  );
  $('btn-interp-cancel').addEventListener('click', () =>
    $('interpreter-modal').classList.add('hidden'),
  );
  $('btn-interp-apply').addEventListener('click', applyInterpreterChoice);
  document.querySelectorAll('.interp-card').forEach((card) => {
    card.addEventListener('click', () => selectInterpreterCard(card.dataset.mode));
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      selectInterpreterCard(card.dataset.mode);
    });
  });
  $('btn-start').addEventListener('click', onStart);
  $('btn-stop').addEventListener('click', onStop);
  $('btn-pick').addEventListener('click', onPickManually);
  $('btn-error-action').addEventListener('click', onErrorAction);
  $('btn-export-dest-change').addEventListener('click', () => $('btn-settings').click());
  $('btn-goto-session-tab').addEventListener('click', gotoSessionTab);
  const settingsSearch = $('settings-search');
  settingsSearch.addEventListener('input', () => filterSettings(settingsSearch.value));
  settingsSearch.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && settingsSearch.value) {
      ev.stopPropagation();
      settingsSearch.value = '';
      filterSettings('');
    }
  });
  $('btn-error-dismiss').addEventListener('click', hideError);
  $('btn-paste-generate')?.addEventListener('click', () => void generateMinutesFromPaste());
  $('history-search')?.addEventListener('input', () => {
    void renderHistory();
  });
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

  $('btn-settings').addEventListener('click', () => openSettings());
  document.querySelectorAll('#settings-tabs button').forEach((b) =>
    b.addEventListener('click', () => setSettingsTab(b.dataset.stab)),
  );
  document.querySelectorAll('#tabrows-toggle button').forEach((b) =>
    b.addEventListener('click', () => setTabRows(b.dataset.tabrows)),
  );
  document.querySelectorAll('#tcolor-toggle button').forEach((b) =>
    b.addEventListener('click', () => setTranslationColour(b.dataset.tcolor)),
  );
  document.querySelectorAll('[data-open-view]').forEach((b) =>
    b.addEventListener('click', () => jumpTo(b.dataset.openView)),
  );
  renderFeatureMap($('feature-map'), jumpTo);
  $('btn-close-settings').addEventListener('click', () => setView(prevView));
  $('btn-about').addEventListener('click', () => openSettings({ about: true }));
  // Esc menutup modal yang terbuka agar kedua nav kembali ke menu aktif.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    // Modal Interpreter menutup dulu; Esc berikutnya keluar dari tab Settings.
    if (!$('interpreter-modal').classList.contains('hidden')) {
      $('interpreter-modal').classList.add('hidden');
    } else if (settingsOpen() && !e.target.closest?.('input,select,textarea')) {
      setView(prevView);
    }
  });

  document.querySelectorAll('#mirror-toggle button').forEach((b) =>
    b.addEventListener('click', async () => {
      state.settings.mirror = b.dataset.mirror;
      await saveSettings();
      await loadSettings();
    }),
  );
  document.querySelectorAll('#native-device-toggle button').forEach((b) =>
    b.addEventListener('click', () => setNativeDevice(b.dataset.hdevice)),
  );
  document.querySelectorAll('#device-toggle button').forEach((b) =>
    b.addEventListener('click', async () => {
      state.settings.device = b.dataset.device;
      await saveSettings();
      await loadSettings();
      updateWarning();
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

  $('btn-qa-run')?.addEventListener('click', async () => {
    const id = $('qa-sample-select')?.value;
    const sample = state.qaCatalog?.samples?.find((s) => s.id === id);
    await runQaSample(sample, { autoStart: true });
  });

  chrome.tabs.onActivated.addListener(refreshTab);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.status === 'complete' || info.title) refreshTab();
  });
}

// ---------------------------------------------------------------------------
// Mock data for layout demonstration (tiruan)
function populateMockData() {
  // Mock history data
  const mockHistory = [
    {
      id: 'mock-1',
      ts: Date.now() - 3600000,
      mode: 'realtime',
      title: 'Team Standup Meeting',
      url: 'https://meet.google.com/abc-defg-hij',
      srcLang: 'en',
      tgtLang: 'id',
      lines: [
        { t0: 0, t1: 5.2, src: 'Good morning everyone', tgt: 'Selamat pagi semuanya' },
        { t0: 5.2, t1: 12.8, src: 'Let me share the updates from yesterday', tgt: 'Izinkan saya berbagi update kemarin' },
        { t0: 12.8, t1: 20.1, src: 'We completed the API integration', tgt: 'Kami sudah selesaikan integrasi API' },
      ],
    },
    {
      id: 'mock-2',
      ts: Date.now() - 7200000,
      mode: 'offline',
      title: 'Product Demo Recording',
      url: '',
      srcLang: 'zh',
      tgtLang: 'en',
      lines: [
        { t0: 0, t1: 3.5, src: 'こんにちは、皆さん', tgt: 'Hello everyone' },
        { t0: 3.5, t1: 9.2, src: '今日は新しい機能を紹介します', tgt: "Today I'll introduce new features" },
      ],
    },
    {
      id: 'mock-3',
      ts: Date.now() - 10800000,
      mode: 'realtime',
      title: 'Client Call - Project Review',
      url: 'https://zoom.us/j/123456789',
      srcLang: 'id',
      tgtLang: 'en',
      lines: [
        { t0: 0, t1: 4.1, src: 'Terima kasih sudah bergabung', tgt: 'Thank you for joining' },
        { t0: 4.1, t1: 11.3, src: 'Proyek ini sudah 80 persen selesai', tgt: 'This project is 80 percent complete' },
      ],
    },
  ];

  // Store mock history if empty
  chrome.storage.local.get('history', (result) => {
    if (!result.history || result.history.length === 0) {
      chrome.storage.local.set({ history: mockHistory });
    }
  });

  // Mock live preview data (shown when not running)
  const mockLiveLines = [
    { src: 'This is a sample transcription', tgt: 'Ini adalah contoh transkripsi' },
    { src: 'The system is working correctly', tgt: 'Sistem berfungsi dengan benar' },
    { src: 'Real-time translation is active', tgt: 'Terjemahan real-time sedang aktif' },
  ];

  // Populate live preview with mock data after a short delay
  setTimeout(() => {
    if (!state.running && !state.offlineRunning) {
      const srcHost = $('live-src-lines');
      const tgtHost = $('live-tgt-lines');
      if (srcHost && tgtHost && srcHost.children.length === 0 && tgtHost.children.length === 0) {
        mockLiveLines.forEach((line, i) => {
          setTimeout(() => {
            appendLiveLine(srcHost, line.src);
            appendLiveLine(tgtHost, line.tgt);
          }, i * 400);
        });
      }
    }
  }, 800);
}

// ---------------------------------------------------------------------------
async function init() {
  await loadSettings();
  if (isWebHost()) {
    document.documentElement.dataset.hosted = '';
    watchEngineWording(document.body); // the Windows app says Engine where the extension says Helper / Native Helper
    arrangeHostedSettings();
    const note = document.querySelector('[data-i18n="nativeNote"]');
    if (note) note.dataset.i18n = 'nativeNoteHosted';
    // Status, model and Restart stay on top; the install guide and diagnostics go behind Troubleshooting.
    const guideMount = $('helper-guide-mount');
    if (guideMount) {
      const d = document.createElement('details');
      d.className = 'hs-troubleshoot';
      d.id = 'helper-troubleshoot';
      const sum = document.createElement('summary');
      sum.textContent = t('hsTroubleshooting');
      guideMount.replaceWith(d);
      d.append(sum, guideMount);
    }
    // In the engine-hosted window the picker is the only capture path today: say so.
    $('btn-pick').dataset.i18n = 'pickManuallyHosted';
    // Inside the app shell iframe the shell sidebar is the navigation; alone, keep the panel's own.
    if (window.self !== window.top) document.documentElement.dataset.embedded = '';
  }
  wire();
  applyI18n();
  const uiPrefs = await restoreUiPrefs();
  resyncPills(false);
  fillSelects();
  setView('captions');
  await restoreDensity();
  state.qaCatalog = await loadSampleCatalog();
  renderQaSampleBar();
  setMode(uiPrefs.mode);
  setTask(uiPrefs.task);
  await refreshDownloaded();
  renderModelLists();
  if (!isWebHost()) populateMockData(); // the app window shows only real history and live lines
  // Engine-hosted app window: mirror the register (Teams paste, notes panel) to the engine.
  startEngineSync({
    lang: () => state.settings.uiLang,
    onError: () => setStatus(makeNotesT(state.settings.uiLang)('engineSyncFail'), 'error'),
  });
  await renderHistory();
  updateWarning();
  if (state.settings.engine === 'native' || state.mode === 'offline') {
    await checkNative({ allowAutoStart: true });
    updateNativeHostHint();
    await pullUiPrefs();
  }
  await refreshTab();
  await refreshExportFolderUi();
  const addinsMount = $('addins-mount');
  if (addinsMount) {
    // lab-only hook: an extension page never reads window state a web page could set
    const dev = location.protocol !== 'chrome-extension:' && window.__ysmAddinsBundled;
    addinsPane = mountAddinsPane(addinsMount, { ...(dev ? { bundled: dev } : {}), lang: () => state.settings.uiLang || 'en' });
    await addinsPane.refresh();
  }
  const notesMount = $('notes-mount');
  if (notesMount) {
    await mountNotesPanel(notesMount, notesMountOptions());
    notesMount.dataset.mounted = '1';
    // Tinggi isi kartu Notulen bisa diseret dan diingat antar sesi.
    const notesBody = $('notes-body');
    if (notesBody && !notesBody.dataset.resizable) {
      notesBody.dataset.resizable = '1';
      await makeResizable(notesBody, {
        storageKey: 'notesPanelSize',
        min: 180,
        max: 1400,
        label: t('notesResize'),
      });
    }
  }
  const helperMount = $('helper-status-mount');
  if (helperMount) {
    perfPanel = mountPerfPanel($('view-perf'), {
      lang: () => (state.settings.uiLang === 'id' ? 'id' : 'en'),
      toast: (m) => showToast(m, 'ok'),
    });
    document.querySelectorAll('#captions-subtabs [data-subview]').forEach((b) =>
      b.addEventListener('click', () => setSubview(b.dataset.subview)),
    );
    initCollapsibles();
    try { if (localStorage.getItem('captionsSubview') === 'perf') setSubview('perf'); } catch { /* opsional */ }

    redrawHelperStatus = mountHelperStatusCard(helperMount, () => ({
      online: !!nativeInfo,
      health: nativeInfo,
      engine: state.settings.engine || 'browser',
      task: state.task,
      mode: state.mode,
      lang: state.settings.uiLang || 'en',
      largeFile: largeFileJob,
      exportOptions: exportOptions(),
      exportSource: currentExportSource(),
      exportFolder: exportDirLabel(),
      restarting: nativeBusy,
      onRestart: isWebHost() ? () => nativeControl('restart') : undefined,
      onExportOptionChange: updateExportOptions,
      onExport: (kind) => {
        const source = currentExportSource();
        if (source) void exportSession({ ...source, kind });
      },
      onCancelLargeFile: () => {
        if (largeFileJob && largeFileJob.status === 'running') {
          largeFileJob = { ...largeFileJob, status: 'cancelling', stage: 'cancelling', cancellable: false };
          redrawHelperStatus?.();
        }
        toOffscreen('offline-cancel', {});
      },
    }));
  }
  const guideMount = $('helper-guide-mount');
  if (guideMount) {
    redrawHelperGuide = mountHelperGuide(guideMount, () => ({
      lang: state.settings.uiLang || 'en',
      health: nativeInfo,
      engine: state.settings.engine || 'browser',
      nativeHostSupported: nativeHostSupported(),
      hostInstalled: nativeHostInstalled,
      hostConnection: nativeHostConn,
      onRecheck: () => {
        probeNativeHost();
        return checkNative({ allowAutoStart: false });
      },
    }));
    // Sekali di awal: isi diagnostik tanpa menunggu pengguna menekan Start.
    probeNativeHost();
  }
  // resync with a session that may already be running
  const s = await toBG('get-state', {});
  if (s?.active) {
    state.running = true;
    syncCaptureStamp();
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
    setStatus(`${t('listening')} — ${activeAsrLabel()}`, 'ok');
    updateButtons();
  }
  await toBG('ensure-offscreen', {});
  // App shell (src/app.html) mounts this panel per page: ?view=<tab>[&stab=<settings tab>].
  const q = new URLSearchParams(location.search);
  if (q.get('view') === 'files') {
    jumpTo('captions');
    setMode('offline');
  } else if (q.get('view')) {
    jumpTo(q.get('view'));
    if (q.get('view') === 'settings' && SETTINGS_TABS.includes(q.get('stab'))) setSettingsTab(q.get('stab'));
  }
}

init();
