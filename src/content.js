// Floating subtitle overlay — YouTube CC-style scrollable blocks + seekable timeline.
import {
  needsTranslation,
  sourceText,
  translationText,
  cueToLine,
} from './lib/translation-utils.js';
import { clampOverlayPos, fitSizeToViewport } from './lib/overlay-geometry.js';
import tokensCss from './tokens.css';
import overlayCss from './overlay.css';

(() => {
  if (window.__localTransSubInjected) return;
  window.__localTransSubInjected = true;

  const TIME_POLL_MS = 100;

  let host = null;
  let panel = null;
  let rowsEl = null;
  let statusBar = null;
  let sessionActive = false;
  let pos = null;
  let fontSize = 24;
  let dualLine = false;
  let refineTranslation = false;
  let video = null;
  let timePoll = null;
  let cacheMaxTime = 0;

  /** @type {Map<number, {t0:number,t1:number,rawSrc:string,rawTgt:string}>} */
  const cues = new Map();
  let pendingInterim = false;
  /** @type {{rawSrc:string,rawTgt:string}|null} */
  let interimCue = null;
  let userPinnedScroll = false;
  let autoScrollEnabled = true;
  let scrollPinSuppressed = false;
  let scrollPinSuppressTimer = null;
  let userScrollIntent = false;
  let boundVideo = null;
  let playbackRaf = null;
  let activeKey = null;
  let sessionConfig = null;
  let forceTranslateBtn = null;
  let forceLabel = null;
  let forceTranslateWrap = null;
  let forceTranslateMenu = null;
  let forceAllBtn = null;
  let forceSomeBtn = null;
  let forceRangeFrom = null;
  let forceRangeTo = null;
  /** @type {Set<number>} */
  const selectedCueKeys = new Set();
  let autoScrollToggle = null;
  let dualLineToggle = null;
  let refineToggle = null;
  let closeBtn = null;
  let minimizeBtn = null;
  let compactBtn = null;
  let lockBtn = null;
  let compactCap = null;
  let reopenFab = null;
  let panelVisible = true;
  let overlayDismissed = false;
  let compactMode = false;
  let locked = false;
  let reskin = 'yraverage';
  let translationColour = null;
  const TCOLOURS = ['indigo', 'navy', 'teal', 'neutral', 'bronze'];
  // chrome.storage.local `captionSurface`: 'overlay' | 'island' | 'both'. The overlay is hidden for 'island'.
  let captionSurface = 'overlay';
  const overlayAllowed = () => captionSurface !== 'island';

  // 16px grid, 1.5px strokes (see .ic in overlay.css). Static strings, no user data.
  const ICONS = {
    compact: '<rect x="2" y="3" width="12" height="10" rx="2.5"/><path d="M5 10h6"/>',
    expand: '<rect x="2" y="3" width="12" height="10" rx="2.5"/><path d="M5 6.5h6M5 9.5h6"/>',
    unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.8"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.8-1"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.8"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    minimize: '<path d="M4 8h8"/>',
    close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
    chevrons: '<path d="M5.5 6.5L8 4l2.5 2.5M5.5 9.5L8 12l2.5-2.5"/>',
    grip: '<path d="M13 6L6 13M13 10l-3 3"/>',
  };
  const svgIcon = (n) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${ICONS[n]}</svg>`;

  function setIconButton(btn, icon, title, pressed) {
    btn.innerHTML = svgIcon(icon);
    btn.title = title;
    btn.setAttribute('aria-label', title);
    if (pressed !== undefined) btn.setAttribute('aria-pressed', String(pressed));
  }

  function iconButton(onClick, icon, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool-close';
    if (icon) setIconButton(b, icon, title);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function makeSwitch(text, title, onChange) {
    const label = document.createElement('label');
    label.className = 'tool-toggle';
    label.title = title;
    const wrap = document.createElement('span');
    wrap.className = 'sw-wrap';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.addEventListener('change', onChange);
    const track = document.createElement('span');
    track.className = 'sw';
    wrap.append(input, track);
    label.append(wrap, document.createTextNode(text));
    return { label, input };
  }
  // Aksen corak untuk overlay gelap — varian identitas tiap pola.
  const RESKIN_ACCENTS = { yraverage: '#14b789', coretax: '#5b9bfa', modern: '#a78bfa' };
  let panelSize = { w: 720, h: 280 };
  const PANEL_MIN = { w: 280, h: 190 };
  const PANEL_MAX = { w: 1200, h: 560 };

  function findVideo() {
    const vids = [...document.querySelectorAll('video')].filter((v) => v.duration > 0 || !v.paused);
    if (!vids.length) return document.querySelector('video');
    return vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  }

  function seekVideo(t) {
    video = video || findVideo();
    bindVideo(video);
    if (!video) return;
    try {
      video.currentTime = Math.max(0, t);
      if (video.paused) video.play().catch(() => {});
    } catch {}
  }

  function startVideoTracking() {
    stopVideoTracking();
    video = findVideo();
    bindVideo(video);
    timePoll = setInterval(() => {
      if (!sessionActive) return;
      if (!video) {
        video = findVideo();
        bindVideo(video);
      }
      if (!video) return;
      const t = video.currentTime;
      chrome.runtime.sendMessage({ target: 'bg', type: 'video-time', data: { time: t } }).catch(() => {});
      followPlayback(t);
    }, TIME_POLL_MS);
    schedulePlaybackFollow();
  }

  function schedulePlaybackFollow() {
    if (playbackRaf || !sessionActive || !autoScrollEnabled) return;
    if (!video || video.paused || video.ended) return;
    playbackRaf = requestAnimationFrame(runPlaybackFollow);
  }

  function runPlaybackFollow() {
    playbackRaf = null;
    if (!sessionActive || !video || video.paused || video.ended) return;
    followPlayback(video.currentTime);
    if (sessionActive && video && !video.paused && !video.ended) {
      playbackRaf = requestAnimationFrame(runPlaybackFollow);
    }
  }

  function stopPlaybackFollow() {
    if (playbackRaf) {
      cancelAnimationFrame(playbackRaf);
      playbackRaf = null;
    }
  }

  function stopVideoTracking() {
    clearInterval(timePoll);
    timePoll = null;
    stopPlaybackFollow();
    clearTimeout(scrollPinSuppressTimer);
    scrollPinSuppressTimer = null;
    scrollPinSuppressed = false;
    bindVideo(null);
    video = null;
  }

  function cueKey(t0) {
    return Math.round(Math.max(0, t0) * 10);
  }

  function findKeyAtTime(t) {
    let inRange = null;
    let latestStarted = null;
    let latestStartedT0 = -Infinity;

    for (const [key, cue] of cues) {
      const t0 = cue.t0 ?? 0;
      const t1 = cue.t1 ?? t0 + 2;
      if (t >= t0 - 0.08 && t <= t1 + 0.08) inRange = key;
      if (t0 <= t + 0.08 && t0 >= latestStartedT0) {
        latestStartedT0 = t0;
        latestStarted = key;
      }
    }
    return inRange ?? latestStarted;
  }

  function applyActiveHighlight(key) {
    activeKey = key;
    if (!rowsEl) return;
    for (const row of rowsEl.querySelectorAll('.row:not(.interim)')) {
      row.classList.toggle('active', Number(row.dataset.key) === key);
    }
  }

  function isRowCentered(row) {
    if (!row || !rowsEl) return true;
    const rowTop = row.offsetTop;
    const rowH = row.offsetHeight;
    const viewH = rowsEl.clientHeight;
    if (viewH <= 0) return true;
    const ideal = rowTop - Math.max(0, (viewH - rowH) / 2);
    return Math.abs(rowsEl.scrollTop - ideal) < 10;
  }

  function shouldAutoScroll() {
    return autoScrollEnabled && !userPinnedScroll;
  }

  function suppressScrollPinning(ms = 400) {
    scrollPinSuppressed = true;
    clearTimeout(scrollPinSuppressTimer);
    scrollPinSuppressTimer = setTimeout(() => {
      scrollPinSuppressed = false;
      scrollPinSuppressTimer = null;
    }, ms);
  }

  function markUserScrollIntent() {
    userScrollIntent = true;
  }

  function activeRowEl() {
    if (!rowsEl || activeKey == null) return null;
    return rowsEl.querySelector(`.row:not(.interim)[data-key="${activeKey}"]`);
  }

  function scrollRowIntoView(row, { instant = true } = {}) {
    if (!row || !rowsEl || !shouldAutoScroll()) return;
    const rowTop = row.offsetTop;
    const rowH = row.offsetHeight;
    const viewH = rowsEl.clientHeight;
    if (viewH <= 0) return;
    const max = Math.max(0, rowsEl.scrollHeight - viewH);
    const target = rowTop - Math.max(0, (viewH - rowH) / 2);
    suppressScrollPinning(instant ? 120 : 500);
    rowsEl.scrollTo({
      top: Math.max(0, Math.min(max, target)),
      behavior: instant ? 'instant' : 'smooth',
    });
  }

  function scrollActiveRowIntoView({ instant = true } = {}) {
    if (!rowsEl || !shouldAutoScroll()) return;
    const row = activeRowEl();
    if (row) scrollRowIntoView(row, { instant });
  }

  function bindVideo(v) {
    if (v === boundVideo) return;
    if (boundVideo) {
      boundVideo.removeEventListener('play', onVideoPlay);
      boundVideo.removeEventListener('seeked', onVideoSeeked);
      boundVideo.removeEventListener('pause', onVideoPause);
    }
    boundVideo = v;
    if (!v) return;
    v.addEventListener('play', onVideoPlay);
    v.addEventListener('seeked', onVideoSeeked);
    v.addEventListener('pause', onVideoPause);
  }

  function onVideoPlay() {
    if (!sessionActive) return;
    if (autoScrollEnabled) userPinnedScroll = false;
    followPlayback(boundVideo?.currentTime ?? 0, { forceScroll: autoScrollEnabled });
    if (autoScrollEnabled) schedulePlaybackFollow();
  }

  function onVideoSeeked() {
    if (!sessionActive) return;
    followPlayback(boundVideo?.currentTime ?? 0, { forceScroll: shouldAutoScroll() });
  }

  function onVideoPause() {
    stopPlaybackFollow();
  }

  function followPlayback(t, { forceScroll = false } = {}) {
    const key = findKeyAtTime(t);
    const keyChanged = key !== activeKey;
    applyActiveHighlight(key);
    if (!shouldAutoScroll() || key == null) return;
    const row = activeRowEl();
    if (!row) return;
    const playing = !!(video && !video.paused && !video.ended);
    if (forceScroll || keyChanged || (playing && !isRowCentered(row))) {
      scrollRowIntoView(row, { instant: true });
    }
  }

  function isUntranslated(cue) {
    return needsTranslation(cue, sessionConfig?.srcLang, sessionConfig?.tgtLang);
  }

  function upsertCue(raw) {
    const t0 = raw.t0 ?? 0;
    const key = cueKey(t0);
    const prev = cues.get(key);
    const rawSrc = (raw.rawSrc ?? raw.src ?? raw.source ?? prev?.rawSrc ?? '').trim();
    const rawTgt = (raw.rawTgt ?? raw.tgt ?? raw.translation ?? prev?.rawTgt ?? '').trim();
    const finalSrc = rawSrc || rawTgt;
    if (!finalSrc && !rawTgt) return;
    // Two-way lines carry their own direction — isUntranslated() must judge
    // them by it, not by the session config (which is pinned to one way).
    const dir = raw.dir?.src && raw.dir?.tgt ? { src: raw.dir.src, tgt: raw.dir.tgt } : prev?.dir;
    cues.set(key, {
      t0,
      t1: raw.t1 ?? prev?.t1 ?? t0 + 2,
      rawSrc: finalSrc,
      rawTgt: rawTgt || finalSrc,
      ...(dir ? { dir } : {}),
    });
    pendingInterim = false;
    interimCue = null;
    updateForceTranslateBtn();
    renderRows();
  }

  function ingestSubtitle(data) {
    if (data.interim === true && data.partial) {
      interimCue = {
        rawSrc: (data.rawSource ?? data.source ?? '').trim(),
        rawTgt: (data.rawTranslation ?? data.translation ?? '').trim(),
      };
      pendingInterim = true;
      renderRows();
      return;
    }
    if (data.interim === true) {
      pendingInterim = true;
      interimCue = null;
      renderRows();
      return;
    }
    if (data.interim === false) {
      pendingInterim = false;
      interimCue = null;
      renderRows();
      return;
    }
    if (!data.final) return;

    const rawSrc = (data.rawSource ?? data.source ?? '').trim();
    let rawTgt = (data.rawTranslation ?? '').trim();
    if (!rawTgt) {
      const shown = (data.translation ?? '').trim();
      rawTgt = shown || rawSrc;
    }
    if (!rawSrc && !rawTgt) return;

    upsertCue({
      t0: data.t0 ?? 0,
      t1: data.t1,
      rawSrc: rawSrc || rawTgt,
      rawTgt,
      // two-way lines run opposite to the session config half the time
      dir: data.dir,
    });
    if (panelVisible) showPanel();
  }

  function untranslatedLines() {
    return [...cues.values()]
      .filter(isUntranslated)
      .sort((a, b) => a.t0 - b.t0)
      .map(cueToLine);
  }

  function allTranscriptLines() {
    return [...cues.values()]
      .sort((a, b) => a.t0 - b.t0)
      .map(cueToLine)
      .filter((c) => c.rawSrc);
  }

  async function forceTranslate(mode = 'all') {
    if (!sessionActive || sessionConfig?.taskMode !== 'translate') return;
    const lines = linesForForceTranslate(mode);
    if (!lines.length) {
      if (mode !== 'range' || !Number.isNaN(parseClock(forceRangeFrom?.value || ''))) {
        setStatus(
          mode === 'some'
            ? 'Select lines using the checkboxes'
            : mode === 'range'
              ? 'No lines in that time range'
              : 'No subtitle lines to translate',
        );
      }
      return;
    }
    closeForceMenu();
    if (forceTranslateBtn) {
      forceTranslateBtn.disabled = true;
      forceTranslateBtn.dataset.busy = '1';
      forceLabel.textContent = 'Translating…';
    }
    setStatus(`Force translating ${lines.length} line(s)…`, 'busy');
    try {
      const res = await chrome.runtime.sendMessage({
        target: 'bg',
        type: 'force-translate',
        data: { lines, retranslate: true },
      });
      if (!res?.ok) {
        setStatus(res?.error || 'Force translate failed', 'error');
        resetForceTranslateBtn();
      } else if (res.count) {
        setStatus(`Translating ${res.count} line(s)…`, 'busy');
      }
    } catch (e) {
      setStatus(String(e.message || e), 'error');
      resetForceTranslateBtn();
    }
  }

  function updateForceTranslateBtn() {
    if (!forceTranslateBtn) return;
    const all = allTranscriptLines();
    const total = all.length;
    const untranslated = untranslatedLines().length;
    const selected = all.filter((l) => selectedCueKeys.has(cueKey(l.t0))).length;
    const can = sessionActive && sessionConfig?.taskMode === 'translate';
    forceTranslateBtn.disabled = !can || forceTranslateBtn.dataset.busy === '1';
    forceTranslateBtn.title = can
      ? 'Force translate — all, selected, or time range'
      : 'Switch to + Translate mode in the panel';
    if (forceTranslateBtn.dataset.busy !== '1') {
      forceLabel.textContent = untranslated > 0 ? `Force Translate (${untranslated})` : 'Force Translate';
    }
    if (forceAllBtn) {
      forceAllBtn.textContent = `Re-translate all (${total})`;
      forceAllBtn.disabled = total === 0 || forceTranslateBtn.dataset.busy === '1';
    }
    if (forceSomeBtn) {
      forceSomeBtn.textContent = `Selected lines (${selected})`;
      forceSomeBtn.disabled = selected === 0 || forceTranslateBtn.dataset.busy === '1';
    }
  }

  async function applyOverlaySetting(patch) {
    if (patch.dualLine !== undefined) dualLine = !!patch.dualLine;
    if (patch.refineTranslation !== undefined) refineTranslation = !!patch.refineTranslation;
    syncOverlayToggles();
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings || {}), ...patch } });
    if (sessionActive) {
      sessionConfig = { ...sessionConfig, ...patch };
      await chrome.runtime.sendMessage({ target: 'bg', type: 'update-config', data: patch }).catch(() => {});
    }
    if (patch.dualLine !== undefined) renderRows();
  }

  function syncOverlayToggles() {
    if (dualLineToggle) dualLineToggle.checked = dualLine;
    if (refineToggle) refineToggle.checked = refineTranslation;
    if (autoScrollToggle) autoScrollToggle.checked = autoScrollEnabled;
  }

  function setPanelVisible(visible) {
    panelVisible = visible;
    if (visible) overlayDismissed = false;
    if (panel) panel.classList.toggle('visible', visible && sessionActive && !overlayDismissed);
    if (reopenFab) {
      reopenFab.classList.toggle('hidden', visible || !sessionActive || overlayDismissed);
    }
    chrome.storage.local.set({ overlayPanelVisible: visible }).catch(() => {});
  }

  function minimizeOverlay() {
    closeForceMenu();
    setPanelVisible(false);
  }

  function dismissOverlay() {
    overlayDismissed = true;
    panelVisible = false;
    closeForceMenu();
    if (panel) panel.classList.remove('visible');
    if (reopenFab) reopenFab.classList.add('hidden');
    chrome.storage.local.set({ overlayPanelVisible: false }).catch(() => {});
  }

  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    return `${m}:${String(ss).padStart(2, '0')}`;
  }

  function parseClock(str) {
    const s = String(str || '').trim();
    if (!s) return NaN;
    const parts = s.split(':').map((p) => Number(p.trim()));
    if (parts.some((n) => Number.isNaN(n))) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return NaN;
  }

  function linesForForceTranslate(mode) {
    const all = allTranscriptLines();
    if (mode === 'all') return all;
    if (mode === 'some') {
      return all.filter((l) => selectedCueKeys.has(cueKey(l.t0)));
    }
    if (mode === 'range') {
      const t0 = parseClock(forceRangeFrom?.value || '');
      const t1 = parseClock(forceRangeTo?.value || '');
      if (Number.isNaN(t0) || Number.isNaN(t1)) {
        setStatus('Enter valid times (m:ss or h:mm:ss)');
        return [];
      }
      const start = Math.min(t0, t1);
      const end = Math.max(t0, t1);
      return all.filter((l) => l.t0 >= start && l.t0 <= end);
    }
    return all;
  }

  function closeForceMenu() {
    forceTranslateMenu?.classList.add('hidden');
    forceTranslateBtn?.setAttribute('aria-expanded', 'false');
  }

  function toggleForceMenu() {
    if (!forceTranslateMenu) return;
    const opening = forceTranslateMenu.classList.contains('hidden');
    if (opening) {
      const t = video?.currentTime ?? 0;
      if (forceRangeFrom) forceRangeFrom.value = fmtClock(t);
      if (forceRangeTo) forceRangeTo.value = fmtClock(Math.min(t + 60, video?.duration || t + 60));
      forceTranslateMenu.classList.remove('hidden');
      forceTranslateBtn.setAttribute('aria-expanded', 'true');
      // Open upward when the panel sits low in the viewport.
      const below = window.innerHeight - forceTranslateBtn.getBoundingClientRect().bottom;
      forceTranslateMenu.classList.toggle('up', below < forceTranslateMenu.offsetHeight + 16);
    } else {
      closeForceMenu();
    }
  }

  function onForceMenuOutside(e) {
    if (!forceTranslateMenu || forceTranslateMenu.classList.contains('hidden')) return;
    const path = e.composedPath?.() || [];
    if (!path.includes(forceTranslateWrap)) closeForceMenu();
  }

  function buildOverlay() {
    if (host || !overlayAllowed()) return;
    host = document.createElement('div');
    host.id = '__local_transsub_overlay';
    host.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // tokens.css targets :root, which a shadow tree never matches.
    style.textContent = tokensCss.replace(/^:root\s*\{/m, ':host {') + overlayCss;

    panel = document.createElement('div');
    panel.className = 'panel';

    const resizeTop = document.createElement('div');
    resizeTop.className = 'resize-edge top';
    resizeTop.title = 'Drag to resize height';
    makeVerticalResize(resizeTop, 'top');

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.title = 'Drag to resize';
    resizeHandle.innerHTML = svgIcon('grip');
    makeResizable(resizeHandle);

    const resizeBottom = document.createElement('div');
    resizeBottom.className = 'resize-edge bottom';
    resizeBottom.title = 'Drag to resize height';
    makeVerticalResize(resizeBottom, 'bottom');

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const title = document.createElement('div');
    title.className = 'toolbar-title';
    title.innerHTML =
      '<span class="brand" role="img" aria-label="yravgSubMeetly"><span class="brand-word">yravg</span><span class="brand-pill">SubMeetly</span></span>';

    const actions = document.createElement('div');
    actions.className = 'toolbar-actions';

    const options = document.createElement('div');
    options.className = 'options';

    const refine = makeSwitch('RefineShort', 'Live refine translation (draft while speaking, correct at end)', () => {
      applyOverlaySetting({ refineTranslation: refineToggle.checked });
    });
    refineToggle = refine.input;
    const dual = makeSwitch('Dual Line', 'Show original + translation', () => {
      applyOverlaySetting({ dualLine: dualLineToggle.checked });
    });
    dualLineToggle = dual.input;
    const auto = makeSwitch('Auto scroll', 'Follow playback automatically', () => {
      autoScrollEnabled = autoScrollToggle.checked;
      chrome.storage.local.set({ overlayAutoScroll: autoScrollEnabled }).catch(() => {});
      if (autoScrollEnabled) userPinnedScroll = false;
      followPlayback(video?.currentTime ?? 0, { forceScroll: autoScrollEnabled });
      if (autoScrollEnabled) schedulePlaybackFollow();
    });
    autoScrollToggle = auto.input;

    forceTranslateWrap = document.createElement('div');
    forceTranslateWrap.className = 'force-wrap';

    forceTranslateBtn = document.createElement('button');
    forceTranslateBtn.type = 'button';
    forceTranslateBtn.className = 'tool-btn force-btn';
    forceTranslateBtn.setAttribute('aria-haspopup', 'menu');
    forceTranslateBtn.setAttribute('aria-expanded', 'false');
    forceLabel = document.createElement('span');
    forceLabel.textContent = 'Force Translate';
    forceTranslateBtn.append(forceLabel);
    forceTranslateBtn.insertAdjacentHTML('beforeend', svgIcon('chevrons'));
    forceTranslateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (forceTranslateBtn.dataset.busy === '1') return;
      toggleForceMenu();
    });

    forceTranslateMenu = document.createElement('div');
    forceTranslateMenu.className = 'force-menu hidden';
    forceTranslateMenu.setAttribute('role', 'menu');
    forceTranslateMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeForceMenu();
        forceTranslateBtn.focus();
      }
    });

    forceAllBtn = document.createElement('button');
    forceAllBtn.type = 'button';
    forceAllBtn.className = 'force-menu-item';
    forceAllBtn.setAttribute('role', 'menuitem');
    forceAllBtn.textContent = 'Re-translate all (0)';
    forceAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      forceTranslate('all');
    });

    forceSomeBtn = document.createElement('button');
    forceSomeBtn.type = 'button';
    forceSomeBtn.className = 'force-menu-item';
    forceSomeBtn.setAttribute('role', 'menuitem');
    forceSomeBtn.textContent = 'Selected lines (0)';
    forceSomeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      forceTranslate('some');
    });

    const rangeSec = document.createElement('div');
    rangeSec.className = 'force-range';

    const fromLabel = document.createElement('label');
    fromLabel.textContent = 'From';
    forceRangeFrom = document.createElement('input');
    forceRangeFrom.type = 'text';
    forceRangeFrom.placeholder = '0:00';
    forceRangeFrom.addEventListener('click', (e) => e.stopPropagation());
    fromLabel.append(forceRangeFrom);

    const toLabel = document.createElement('label');
    toLabel.textContent = 'To';
    forceRangeTo = document.createElement('input');
    forceRangeTo.type = 'text';
    forceRangeTo.placeholder = '1:00';
    forceRangeTo.addEventListener('click', (e) => e.stopPropagation());
    toLabel.append(forceRangeTo);

    const rangeBtn = document.createElement('button');
    rangeBtn.type = 'button';
    rangeBtn.className = 'force-menu-item force-range-btn';
    rangeBtn.setAttribute('role', 'menuitem');
    rangeBtn.textContent = 'Translate time range';
    rangeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      forceTranslate('range');
    });

    rangeSec.append(fromLabel, toLabel, rangeBtn);
    forceTranslateMenu.append(forceAllBtn, forceSomeBtn, rangeSec);
    forceTranslateWrap.append(forceTranslateBtn, forceTranslateMenu);
    document.addEventListener('click', onForceMenuOutside);

    compactBtn = iconButton(() => {
      compactMode = !compactMode;
      applyCompactLock();
    });
    lockBtn = iconButton(() => {
      locked = !locked;
      applyCompactLock();
    });
    minimizeBtn = iconButton(minimizeOverlay, 'minimize', 'Minimize to CC Subtitles');
    closeBtn = iconButton(dismissOverlay, 'close', 'Close subtitles overlay');
    applyCompactLock();

    options.append(refine.label, dual.label, auto.label, forceTranslateWrap);
    actions.append(compactBtn, lockBtn, minimizeBtn, closeBtn);
    toolbar.append(title, actions);

    reopenFab = document.createElement('button');
    reopenFab.type = 'button';
    reopenFab.className = 'reopen-fab hidden';
    reopenFab.innerHTML = svgIcon('expand');
    reopenFab.append(document.createTextNode('CC Subtitles'));
    reopenFab.title = 'Show subtitles panel';
    reopenFab.addEventListener('click', () => setPanelVisible(true));

    rowsEl = document.createElement('div');
    rowsEl.className = 'scroll';

    compactCap = document.createElement('div');
    compactCap.className = 'compact-cap';
    compactCap.textContent = 'Listening…';

    statusBar = document.createElement('div');
    statusBar.className = 'status-bar hidden';

    panel.append(resizeTop, toolbar, options, rowsEl, compactCap, statusBar, resizeHandle, resizeBottom);
    shadow.append(style, panel, reopenFab);
    (document.fullscreenElement || document.documentElement).appendChild(host);

    panel.style.setProperty('--tgt-size', fontSize + 'px');
    panel.style.setProperty('--src-size', Math.round(fontSize * 0.82) + 'px');
    syncOverlayToggles();

    rowsEl.addEventListener('wheel', markUserScrollIntent, { passive: true });
    rowsEl.addEventListener('touchstart', markUserScrollIntent, { passive: true });
    rowsEl.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        markUserScrollIntent();
      }
    });
    rowsEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, label, a')) return;
      markUserScrollIntent();
    });
    rowsEl.addEventListener(
      'scroll',
      () => {
        if (!autoScrollEnabled || scrollPinSuppressed || !userScrollIntent) return;
        userScrollIntent = false;
        const nearBottom = rowsEl.scrollHeight - rowsEl.scrollTop - rowsEl.clientHeight < 48;
        userPinnedScroll = !nearBottom;
      },
      { passive: true },
    );

    makeDraggable(title);
    applyReskinOverlay();
    applyPanelSize();
    applyPos();

    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
      document.addEventListener(ev, reparent);
    }
  }

  function reparent() {
    if (!host) return;
    const parent =
      document.fullscreenElement || document.webkitFullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  function applyReskinOverlay() {
    if (!panel) return;
    panel.style.setProperty(
      '--lts-accent',
      RESKIN_ACCENTS[reskin] || RESKIN_ACCENTS.yraverage,
    );
    if (TCOLOURS.includes(translationColour)) panel.dataset.tcolor = translationColour;
    else delete panel.dataset.tcolor;
  }

  function applyCompactLock() {
    if (!panel) return;
    panel.classList.toggle('compact', compactMode);
    panel.classList.toggle('locked', locked);
    if (compactBtn) {
      setIconButton(compactBtn, compactMode ? 'expand' : 'compact', compactMode ? 'Expand to full transcript' : 'Compact caption bar', compactMode);
    }
    if (lockBtn) {
      setIconButton(lockBtn, locked ? 'lock' : 'unlock', locked ? 'Unlock panel (allow drag & resize)' : 'Lock panel (block drag & resize)', locked);
    }
    chrome.storage.local.set({ overlayCompact: compactMode, overlayLocked: locked }).catch(() => {});
  }

  function makeDraggable(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || locked) return;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      const r = panel.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const origLeft = r.left + r.width / 2;
      const origBottom = window.innerHeight - r.bottom;
      const onMove = (ev) => {
        const nx = origLeft + (ev.clientX - startX);
        const nb = origBottom - (ev.clientY - startY);
        pos = clampPos({ xPct: (nx / window.innerWidth) * 100, yPct: (nb / window.innerHeight) * 100 });
        applyPos();
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        if (pos) chrome.storage.local.set({ overlayPos: pos }).catch(() => {});
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
  }

  const EDGE_MARGIN = 8; // px yang disisakan antara overlay dan tepi viewport

  // Muat panel ke dalam viewport (jendela kecil / halaman di-zoom) tanpa
  // mengubah preferensi ukuran pengguna kecuali memang sudah tidak muat.
  function fitPanelSizeToViewport() {
    return fitSizeToViewport(panelSize, {
      vw: window.innerWidth,
      vh: window.innerHeight,
      min: PANEL_MIN,
      margin: EDGE_MARGIN,
    });
  }

  // Klem posisi memakai ukuran panel yang benar-benar terender, sehingga yang
  // dijaga di layar adalah SELURUH panel, bukan sekadar titik tengahnya.
  function clampPos(p) {
    if (!p) return p;
    const fit = fitPanelSizeToViewport();
    return clampOverlayPos(p, {
      vw: window.innerWidth || 1,
      vh: window.innerHeight || 1,
      w: panel?.offsetWidth || fit.w,
      h: panel?.offsetHeight || fit.h,
      margin: EDGE_MARGIN,
    });
  }

  let viewportResizeTimer = null;
  window.addEventListener('resize', () => {
    if (!panel) return;
    clearTimeout(viewportResizeTimer);
    viewportResizeTimer = setTimeout(() => {
      applyPanelSize();
      applyPos();
    }, 80);
  });

  function applyPanelSize() {
    if (!panel) return;
    const fit = fitPanelSizeToViewport();
    panel.style.setProperty('--panel-w', `${fit.w}px`);
    panel.style.setProperty('--panel-h', `${fit.h}px`);
    panel.style.width = `${fit.w}px`;
    panel.style.height = `${fit.h}px`;
    if (shouldAutoScroll() && activeRowEl()) {
      scrollActiveRowIntoView({ instant: true });
    }
    if (pos) applyPos();
  }

  function makeVerticalResize(handle, edge) {
    handle.addEventListener('pointerdown', (e) => {
      if (locked) return;
      e.stopPropagation();
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = panelSize.h;
      const onMove = (ev) => {
        const dy = ev.clientY - startY;
        const nh =
          edge === 'bottom'
            ? Math.min(PANEL_MAX.h, Math.max(PANEL_MIN.h, startH + dy))
            : Math.min(PANEL_MAX.h, Math.max(PANEL_MIN.h, startH - dy));
        panelSize = { ...panelSize, h: Math.round(nh) };
        applyPanelSize();
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        chrome.storage.local.set({ overlayPanelSize: panelSize }).catch(() => {});
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }

  function makeResizable(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (locked) return;
      e.stopPropagation();
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = panelSize.w;
      const startH = panelSize.h;
      const onMove = (ev) => {
        const nw = Math.min(PANEL_MAX.w, Math.max(PANEL_MIN.w, startW + (ev.clientX - startX)));
        const nh = Math.min(
          PANEL_MAX.h,
          Math.max(PANEL_MIN.h, startH - (ev.clientY - startY)),
        );
        panelSize = { w: Math.round(nw), h: Math.round(nh) };
        applyPanelSize();
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        chrome.storage.local.set({ overlayPanelSize: panelSize }).catch(() => {});
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }

  function applyPos() {
    if (!panel || !pos) return;
    pos = clampPos(pos);
    panel.style.left = pos.xPct + '%';
    panel.style.bottom = pos.yPct + '%';
    panel.style.transform = 'translateX(-50%)';
    if (reopenFab) {
      reopenFab.style.left = pos.xPct + '%';
      reopenFab.style.bottom = pos.yPct + '%';
      reopenFab.style.transform = 'translateX(-50%)';
    }
  }

  function showPanel() {
    if (!panel || !panelVisible || overlayDismissed) return;
    panel.classList.add('visible');
    if (reopenFab) reopenFab.classList.add('hidden');
  }

  // kind: 'busy' | 'ok' | 'error' | undefined (neutral dot)
  function setStatus(text, kind) {
    if (!host) buildOverlay();
    if (!statusBar) return;
    statusBar.className = 'status-bar' + (kind ? ' ' + kind : '');
    statusBar.setAttribute('role', 'status');
    if (!text) {
      statusBar.classList.add('hidden');
      statusBar.textContent = '';
      return;
    }
    statusBar.textContent = text;
    showPanel();
  }

  function renderRows() {
    if (!rowsEl) return;
    const sorted = [...cues.entries()].sort((a, b) => a[1].t0 - b[1].t0);
    // Baris dipakai ulang per kunci supaya pergantian subtitel mulus di tempat
    // (tanpa rebuild total yang bikin kedip/menumpuk); hanya baris baru yang
    // masuk dengan animasi row-new sekali.
    const existing = new Map();
    for (const row of rowsEl.querySelectorAll('.row[data-key]:not(.interim)')) {
      existing.set(row.dataset.key, row);
    }
    const seen = new Set();

    for (const [key, cue] of sorted) {
      const k = String(key);
      seen.add(k);
      let row = existing.get(k);
      if (!row) {
        row = document.createElement('div');
        row.className = 'row row-new';
        row.dataset.key = k;
        row._cueKey = key;

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'row-check';
        check.title = 'Select for Force Translate';
        check.addEventListener('click', (e) => e.stopPropagation());
        check.addEventListener('change', () => {
          if (check.checked) selectedCueKeys.add(row._cueKey);
          else selectedCueKeys.delete(row._cueKey);
          updateForceTranslateBtn();
        });

        const timeBtn = document.createElement('button');
        timeBtn.type = 'button';
        timeBtn.className = 'time-btn';
        timeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          seekVideo(cue.t0);
        });

        const blocks = document.createElement('div');
        blocks.className = 'blocks';

        row.append(check, timeBtn, blocks);
        rowsEl.appendChild(row);
        const fresh = row;
        requestAnimationFrame(() => fresh.classList.remove('row-new'));
      }
      row.classList.toggle('active', key === activeKey);
      const check = row.querySelector('.row-check');
      check.checked = selectedCueKeys.has(key);
      const timeBtn = row.querySelector('.time-btn');
      timeBtn.textContent = fmtClock(cue.t0);
      timeBtn.title = 'Jump to ' + fmtClock(cue.t0);
      const blocks = row.querySelector('.blocks');
      blocks.innerHTML = '';

      const hasTranslation = !isUntranslated(cue);
      const displaySrc = dualLine ? (cue.rawSrc || sourceText(cue)) : '';
      const displayTgt = translationText(cue) || cue.rawSrc;
      if (displaySrc) {
        const srcBlock = document.createElement('div');
        srcBlock.className = 'block src';
        srcBlock.textContent = displaySrc;
        blocks.appendChild(srcBlock);
      }
      if (displayTgt) {
        const tgtBlock = document.createElement('div');
        tgtBlock.className = 'block tgt' + (!hasTranslation && cue.rawSrc ? ' untranslated' : '');
        tgtBlock.textContent = displayTgt;
        blocks.appendChild(tgtBlock);
      }

      rowsEl.appendChild(row);
    }
    for (const [k, row] of existing) {
      if (!seen.has(k)) row.remove();
    }

    updateForceTranslateBtn();

    rowsEl.querySelectorAll('.row.interim, .empty').forEach((r) => r.remove());
    if (pendingInterim) {
      const row = document.createElement('div');
      row.className = 'row interim';
      const spacer = document.createElement('span');
      spacer.className = 'row-check';
      const time = document.createElement('span');
      time.className = 'time-btn';
      time.textContent = '…';
      const blocks = document.createElement('div');
      blocks.className = 'blocks';

      if (interimCue && (interimCue.rawSrc || interimCue.rawTgt)) {
        const displaySrc = dualLine ? interimCue.rawSrc : '';
        const displayTgt = interimCue.rawTgt || interimCue.rawSrc;
        if (displaySrc) {
          const srcBlock = document.createElement('div');
          srcBlock.className = 'block src draft';
          srcBlock.textContent = displaySrc;
          blocks.appendChild(srcBlock);
        }
        if (displayTgt) {
          const tgtBlock = document.createElement('div');
          tgtBlock.className = 'block tgt draft';
          tgtBlock.textContent = displayTgt;
          blocks.appendChild(tgtBlock);
        }
      } else {
        const loading = document.createElement('div');
        loading.className = 'block loading';
        loading.innerHTML = '<i></i><i></i><i></i>';
        loading.setAttribute('aria-label', 'Recognising speech');
        blocks.appendChild(loading);
      }

      row.append(spacer, time, blocks);
      rowsEl.appendChild(row);
    }

    if (!sorted.length && !pendingInterim) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Captions appear here as speech is recognised.';
      rowsEl.appendChild(empty);
    }

    if (compactCap) {
      const last = sorted.length ? sorted[sorted.length - 1][1] : null;
      const interimText = pendingInterim && interimCue ? (interimCue.rawTgt || interimCue.rawSrc) : '';
      compactCap.textContent =
        interimText || (last ? translationText(last) || last.rawSrc : '') || 'Listening…';
    }
    showPanel();

    if (sessionActive && video) {
      applyActiveHighlight(findKeyAtTime(video.currentTime));
    }
  }

  function loadInitialCues(list) {
    cues.clear();
    selectedCueKeys.clear();
    for (const cue of list || []) {
      const t0 = cue.t0 ?? 0;
      const key = cueKey(t0);
      const rawSrc = (cue.src || cue.source || cue.rawSrc || '').trim();
      const rawTgt = (cue.tgt || cue.translation || cue.rawTgt || '').trim();
      if (!rawSrc && !rawTgt) continue;
      const dir = cue.dir?.src && cue.dir?.tgt ? { src: cue.dir.src, tgt: cue.dir.tgt } : null;
      cues.set(key, {
        t0,
        t1: cue.t1 ?? t0 + 2,
        rawSrc,
        rawTgt: rawTgt || rawSrc,
        ...(dir ? { dir } : {}),
      });
    }
    pendingInterim = false;
    interimCue = null;
    updateForceTranslateBtn();
    renderRows();
  }

  function resetForceTranslateBtn() {
    if (!forceTranslateBtn) return;
    forceTranslateBtn.dataset.busy = '0';
    updateForceTranslateBtn();
  }

  function teardown() {
    stopVideoTracking();
    stopPlaybackFollow();
    cues.clear();
    selectedCueKeys.clear();
    pendingInterim = false;
    userPinnedScroll = false;
    userScrollIntent = false;
    activeKey = null;
    cacheMaxTime = 0;
    sessionConfig = null;
    removeHost();
  }

  function removeHost() {
    document.removeEventListener('click', onForceMenuOutside);
    if (host) {
      host.remove();
      host = null;
      panel = null;
      rowsEl = null;
      statusBar = null;
      forceTranslateBtn = null;
      forceLabel = null;
      forceTranslateWrap = null;
      forceTranslateMenu = null;
      forceAllBtn = null;
      forceSomeBtn = null;
      forceRangeFrom = null;
      forceRangeTo = null;
      autoScrollToggle = null;
      dualLineToggle = null;
      refineToggle = null;
      closeBtn = null;
      minimizeBtn = null;
      compactBtn = null;
      lockBtn = null;
      compactCap = null;
      reopenFab = null;
      panelVisible = true;
      overlayDismissed = false;
    }
  }

  chrome.storage.local.get(['overlayPos', 'overlayAutoScroll', 'overlayPanelVisible', 'overlayPanelSize', 'overlayCompact', 'overlayLocked', 'settings', 'captionSurface']).then(
    ({ overlayPos, overlayAutoScroll, overlayPanelVisible, overlayPanelSize, overlayCompact, overlayLocked, settings, captionSurface: surface }) => {
    captionSurface = normalizeSurface(surface);
    translationColour = settings?.translationColour ?? null;
    if (overlayPos) pos = overlayPos;
    if (overlayAutoScroll !== undefined) autoScrollEnabled = !!overlayAutoScroll;
    if (overlayPanelVisible !== undefined) panelVisible = !!overlayPanelVisible;
    if (overlayPanelSize?.w && overlayPanelSize?.h) panelSize = overlayPanelSize;
    compactMode = !!overlayCompact;
    locked = !!overlayLocked;
    applyCompactLock();
    if (typeof settings?.reskin === 'string') reskin = settings.reskin;
    applyReskinOverlay();
    if (settings?.overlayFontSize) fontSize = settings.overlayFontSize;
    dualLine = !!settings?.dualLine;
    refineTranslation = !!settings?.refineTranslation;
    syncOverlayToggles();
    if (panel) {
      panel.style.setProperty('--tgt-size', fontSize + 'px');
      panel.style.setProperty('--src-size', Math.round(fontSize * 0.82) + 'px');
      applyPanelSize();
      applyPos();
    }
    applySurface();
  });

  const normalizeSurface = (v) => (v === 'island' || v === 'both' ? v : 'overlay');

  // Show or fully remove the overlay to match `captionSurface`; cues and session state survive.
  function applySurface() {
    if (!overlayAllowed()) {
      if (host) removeHost();
      return;
    }
    if (sessionActive && !host) {
      buildOverlay();
      syncOverlayToggles();
      setPanelVisible(panelVisible);
      renderRows();
    }
  }

  chrome.storage.onChanged?.addListener((changes) => {
    if (changes.captionSurface) {
      captionSurface = normalizeSurface(changes.captionSurface.newValue);
      applySurface();
    }
    const s = changes.settings?.newValue;
    if (!s) return;
    if (s.translationColour !== translationColour) {
      translationColour = s.translationColour ?? null;
      applyReskinOverlay();
    }
    if (s.overlayFontSize && panel) {
      fontSize = s.overlayFontSize;
      panel.style.setProperty('--tgt-size', fontSize + 'px');
      panel.style.setProperty('--src-size', Math.round(fontSize * 0.82) + 'px');
    }
    if (s.dualLine !== undefined) {
      dualLine = !!s.dualLine;
      syncOverlayToggles();
      renderRows();
    }
    if (s.refineTranslation !== undefined) {
      refineTranslation = !!s.refineTranslation;
      syncOverlayToggles();
    }
    if (typeof s.reskin === 'string' && s.reskin !== reskin) {
      reskin = s.reskin;
      applyReskinOverlay();
    }
  });

  function applyPipelineStatus(pstate) {
    if (!sessionActive) return;
    if (pstate === 'loading') setStatus('Loading local AI models…', 'busy');
    else if (pstate === 'warmup') setStatus('Warming up…', 'busy');
    else if (pstate === 'listening') setStatus('Listening — live translation active', 'ok');
  }

  function activateSession(data) {
    sessionActive = true;
    sessionConfig = data.config || null;
    dualLine = !!data.config?.dualLine;
    refineTranslation = !!data.config?.refineTranslation;
    overlayDismissed = false;
    cacheMaxTime = data.cacheMaxTime || 0;
    buildOverlay();
    syncOverlayToggles();
    setPanelVisible(panelVisible);
    loadInitialCues(data.cacheCues || []);
    startVideoTracking();
    const resume = cacheMaxTime > 0 ? ` — cached to ${fmtClock(cacheMaxTime)}` : '';
    setStatus(`Loading models…${resume}`, 'busy');
  }

  // Gabungkan cue yang mungkin terlewat (tab sempat dibuang, dipulihkan dari
  // bfcache, atau skrip disuntik di tengah sesi) tanpa membuang yang sudah ada.
  function mergeCues(list) {
    let added = 0;
    for (const cue of list || []) {
      const key = cueKey(cue.t0 ?? 0);
      if (cues.has(key)) continue;
      upsertCue({
        t0: cue.t0 ?? 0,
        t1: cue.t1,
        rawSrc: cue.src || cue.source || '',
        rawTgt: cue.tgt || cue.translation || '',
      });
      added += 1;
      cacheMaxTime = Math.max(cacheMaxTime, cue.t1 ?? 0);
    }
    if (added) renderRows();
    return added;
  }

  let syncInFlight = null;
  async function syncFromBackground(reason) {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
      let res = null;
      try {
        res = await chrome.runtime.sendMessage({ target: 'bg', type: 'content-sync', data: { reason } });
      } catch {
        return; // ekstensi dimuat ulang / background belum ada
      }
      // Hanya jawaban asli background yang membawa `active` boolean; apa pun
      // selain itu diabaikan supaya overlay tidak dibongkar tanpa alasan.
      if (!res || typeof res.active !== 'boolean') return;
      if (res.active && !sessionActive) {
        activateSession(res);
        applyPipelineStatus(res.pipelineState);
      } else if (res.active && sessionActive) {
        if (res.config) {
          sessionConfig = res.config;
          dualLine = !!res.config.dualLine;
          refineTranslation = !!res.config.refineTranslation;
          syncOverlayToggles();
        }
        if (!host) {
          buildOverlay();
          setPanelVisible(panelVisible);
        }
        mergeCues(res.cacheCues);
        applyPipelineStatus(res.pipelineState);
      } else if (!res.active && sessionActive) {
        sessionActive = false;
        teardown();
      }
    })().finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncFromBackground('visible');
  });
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) syncFromBackground('pageshow');
  });
  syncFromBackground('boot');

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.target !== 'content') return;
    switch (msg.type) {
      case 'session':
        if (msg.data.active) {
          activateSession(msg.data);
        } else {
          sessionActive = false;
          teardown();
        }
        break;
      case 'config':
        if (msg.data?.config) {
          sessionConfig = msg.data.config;
          dualLine = !!msg.data.config.dualLine;
          refineTranslation = !!msg.data.config.refineTranslation;
          syncOverlayToggles();
          updateForceTranslateBtn();
          renderRows();
        }
        if (msg.data?.cacheCues) loadInitialCues(msg.data.cacheCues);
        break;
      case 'cache-cue':
        if (msg.data?.cue) {
          const c = msg.data.cue;
          upsertCue({
            t0: c.t0,
            t1: c.t1,
            rawSrc: c.src || c.source || '',
            rawTgt: c.tgt || c.translation || '',
            dir: c.dir,
          });
          cacheMaxTime = Math.max(cacheMaxTime, c.t1 ?? 0);
        }
        break;
      case 'force-translate-done':
        resetForceTranslateBtn();
        if (msg.data?.error) setStatus(msg.data.error, 'error');
        else if (msg.data?.translated > 0) {
          const skipped = msg.data.skipped || 0;
          const dirs = (msg.data.skippedDirections || []).join(', ');
          // Say what was left behind: a two-way batch can be missing the model
          // for one direction and still report a healthy-looking count.
          setStatus(
            skipped
              ? `Force translated ${msg.data.translated} line(s) — skipped ${skipped}${dirs ? ` (no model for ${dirs})` : ''}`
              : `Force translated ${msg.data.translated} line(s)`,
          );
          setTimeout(() => setStatus(''), skipped ? 6000 : 3000);
        } else {
          setStatus('Translation model returned no results — download the language pair model in Settings', 'error');
        }
        break;
      case 'subtitle':
        if (sessionActive) ingestSubtitle(msg.data);
        break;
      case 'pipeline-status':
        applyPipelineStatus(msg.data?.state);
        break;
    }
  });
})();
