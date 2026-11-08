// Floating subtitle overlay — YouTube CC-style scrollable blocks + seekable timeline.
import {
  needsTranslation,
  sourceText,
  translationText,
  cueToLine,
} from './lib/translation-utils.js';
import { clampOverlayPos, fitSizeToViewport } from './lib/overlay-geometry.js';

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
  // Aksen corak untuk overlay gelap — varian identitas tiap pola.
  const RESKIN_ACCENTS = { yraverage: '#14b789', coretax: '#5b9bfa', modern: '#a78bfa' };
  let panelSize = { w: 720, h: 280 };
  const PANEL_MIN = { w: 280, h: 140 };
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
      forceTranslateBtn.textContent = 'Translating…';
    }
    setStatus(`Force translating ${lines.length} line(s)…`);
    try {
      const res = await chrome.runtime.sendMessage({
        target: 'bg',
        type: 'force-translate',
        data: { lines, retranslate: true },
      });
      if (!res?.ok) {
        setStatus(res?.error || 'Force translate failed');
        resetForceTranslateBtn();
      } else if (res.count) {
        setStatus(`Translating ${res.count} line(s)…`);
      }
    } catch (e) {
      setStatus(String(e.message || e));
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
      forceTranslateBtn.textContent =
        untranslated > 0 ? `Force Translate (${untranslated}) ▾` : 'Force Translate ▾';
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
  }

  function toggleForceMenu() {
    if (!forceTranslateMenu) return;
    const opening = forceTranslateMenu.classList.contains('hidden');
    if (opening) {
      const t = video?.currentTime ?? 0;
      if (forceRangeFrom) forceRangeFrom.value = fmtClock(t);
      if (forceRangeTo) forceRangeTo.value = fmtClock(Math.min(t + 60, video?.duration || t + 60));
      forceTranslateMenu.classList.remove('hidden');
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
    if (host) return;
    host = document.createElement('div');
    host.id = '__local_transsub_overlay';
    host.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host, * { box-sizing: border-box; }
      .panel {
        /* Cermin paket motion sidepanel.css (--ease-standard/--transition-base).
           Shadow DOM terisolasi sehingga token halaman tak terbaca di sini. */
        --lts-ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);
        --lts-dur: 180ms;
        position: fixed;
        left: 50%;
        bottom: 8%;
        transform: translateX(-50%);
        width: var(--panel-w, min(92vw, 720px));
        height: var(--panel-h, min(42vh, 320px));
        min-width: 280px;
        min-height: 140px;
        max-width: 95vw;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.82);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
        color: #fff;
        font-family: "YouTube Noto", Roboto, Arial, "Hiragino Sans", "Microsoft YaHei", sans-serif;
        pointer-events: auto;
        opacity: 0;
        transition: opacity var(--lts-dur) var(--lts-ease);
        overflow: hidden;
      }
      .panel.visible { opacity: 1; }
      .toolbar {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 5px 8px 5px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        min-height: 34px;
      }
      .toolbar-title {
        font-size: 11px;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
        cursor: grab;
        user-select: none;
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .toolbar-title.dragging { cursor: grabbing; }
      .toolbar-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
      }
      .tool-btn {
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.88);
        border-radius: 8px;
        padding: 3px 8px;
        font-size: 10px;
        font-family: inherit;
        cursor: pointer;
        white-space: nowrap;
      }
      .tool-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.16);
        border-color: rgba(255, 255, 255, 0.28);
      }
      .tool-btn:disabled {
        opacity: 0.38;
        cursor: default;
      }
      .force-wrap {
        position: relative;
        flex: none;
      }
      .force-menu {
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        min-width: 220px;
        padding: 6px;
        border-radius: 10px;
        background: rgba(18, 18, 18, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        z-index: 5;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .force-menu-item {
        border: none;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.9);
        border-radius: 8px;
        padding: 7px 10px;
        font-size: 11px;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
      }
      .force-menu-item:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.14);
      }
      .force-menu-item:disabled {
        opacity: 0.38;
        cursor: default;
      }
      .force-range {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px 6px;
        padding: 6px 4px 2px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        margin-top: 2px;
      }
      .force-range label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 9px;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .force-range input {
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        border-radius: 6px;
        padding: 4px 6px;
        font-size: 11px;
        font-family: inherit;
        font-variant-numeric: tabular-nums;
      }
      .force-range-btn {
        grid-column: 1 / -1;
        margin-top: 2px;
      }
      .tool-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.65);
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }
      .tool-toggle input {
        margin: 0;
        accent-color: #fff;
        cursor: pointer;
      }
      .tool-close {
        border: none;
        background: none;
        color: rgba(255, 255, 255, 0.5);
        font-size: 16px;
        line-height: 1;
        padding: 2px 4px;
        cursor: pointer;
        border-radius: 6px;
      }
      .tool-close:hover { color: #fff; background: rgba(255, 255, 255, 0.12); }
      .reopen-fab {
        position: fixed;
        left: 50%;
        bottom: 8%;
        transform: translateX(-50%);
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(0, 0, 0, 0.78);
        color: #fff;
        border-radius: 999px;
        padding: 8px 14px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        pointer-events: auto;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      }
      .reopen-fab:hover { background: rgba(30, 30, 30, 0.92); }
      .scroll {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 6px 0 8px;
        scroll-behavior: auto;
      }
      .scroll::-webkit-scrollbar { width: 6px; }
      .scroll::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.22);
        border-radius: 999px;
      }
      .row {
        display: grid;
        grid-template-columns: 18px 54px 1fr;
        gap: 6px;
        align-items: start;
        padding: 3px 10px 3px 8px;
      }
      @keyframes rowIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-reduced-motion: no-preference) {
        .row.row-new { animation: rowIn var(--lts-dur) var(--lts-ease); }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel, .row, .block, .reopen-fab { transition: none; animation: none; }
      }
      .row-check {
        margin-top: 8px;
        accent-color: #fff;
        cursor: pointer;
      }
      .row-check:disabled {
        opacity: 0.22;
        cursor: default;
      }
      .row.active { background: rgba(255, 255, 255, 0.06); }
      .time-btn {
        margin-top: 6px;
        padding: 2px 0;
        border: none;
        background: none;
        color: rgba(255, 255, 255, 0.55);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        text-align: right;
        font-family: inherit;
        border-radius: 6px;
      }
      .time-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
      .row.active .time-btn { color: #fff; font-weight: 600; }
      .blocks { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
      .block {
        padding: 7px 12px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.1);
        line-height: 1.55;
        word-break: break-word;
        overflow-wrap: anywhere;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
      }
      .row.active .block {
        background: rgba(255, 255, 255, 0.16);
        box-shadow: inset 0 0 0 1px var(--lts-accent, rgba(255, 255, 255, 0.14));
      }
      .block.src {
        font-size: var(--src-size, 18px);
        color: rgba(255, 255, 255, 0.85);
        font-weight: 400;
      }
      .block.tgt {
        font-size: var(--tgt-size, 22px);
        color: #fff;
        font-weight: 600;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 12px rgba(0, 0, 0, 0.5);
      }
      .block.untranslated { color: rgba(255, 255, 255, 0.75); font-style: italic; }
      .row.interim .block.loading {
        color: rgba(255, 255, 255, 0.5);
        font-size: 14px;
        letter-spacing: 3px;
      }
      .row.interim .block.draft {
        opacity: 0.88;
        border-left: 2px solid var(--lts-accent, rgba(255, 200, 100, 0.55));
      }
      .status-bar {
        flex: none;
        padding: 5px 12px 7px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.45);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }
      .resize-handle {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 18px;
        height: 18px;
        cursor: nwse-resize;
        opacity: 0.45;
        z-index: 2;
      }
      .resize-handle::after {
        content: '';
        position: absolute;
        right: 4px;
        bottom: 4px;
        width: 8px;
        height: 8px;
        border-right: 2px solid rgba(255,255,255,0.75);
        border-bottom: 2px solid rgba(255,255,255,0.75);
      }
      .resize-handle:hover { opacity: 0.9; }
      .resize-edge {
        position: absolute;
        left: 0;
        right: 0;
        height: 7px;
        z-index: 2;
        cursor: ns-resize;
      }
      .resize-edge.top { top: 0; }
      .resize-edge.bottom { bottom: 0; }
      .resize-edge:hover { background: rgba(255, 255, 255, 0.06); }
      .compact-cap {
        display: none;
        padding: 8px 14px 10px;
        font-size: var(--tgt-size, 22px);
        font-weight: 600;
        line-height: 1.4;
        color: #fff;
        text-align: center;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 12px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .panel.compact .scroll, .panel.compact .status-bar { display: none; }
      .panel.compact { height: auto; min-height: 0; }
      .panel.compact .compact-cap { display: -webkit-box; }
      .panel.locked .toolbar-actions { opacity: 0.3; pointer-events: none; }
      .panel.locked .toolbar-title { cursor: default; }
      .panel.locked .resize-handle, .panel.locked .resize-edge { display: none; }
      .hidden { display: none !important; }
    
      /* ---- Keterbacaan di segala tema halaman induk ----------------------
         Aturan di bawah menang karena datang belakangan: kontras dinaikkan
         tanpa mengubah tata letak, dan tipografi halaman induk tidak bocor. */
      :host {
        color: #fff; font-size: 16px; line-height: normal; letter-spacing: normal;
        word-spacing: normal; text-transform: none; text-indent: 0; text-align: left;
        direction: ltr; font-style: normal; font-variant: normal; text-shadow: none; filter: none;
      }
      .panel, .reopen-fab, .status-bar { color-scheme: dark; }
      .panel {
        background: rgba(8, 8, 8, 0.9);
        -webkit-backdrop-filter: blur(10px) saturate(1.1);
        backdrop-filter: blur(10px) saturate(1.1);
        border-color: rgba(255, 255, 255, 0.22);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.5);
      }
      .block { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 1px rgba(0, 0, 0, 0.6); }
      .block.src { color: rgba(255, 255, 255, 0.88); }
      .block.tgt { color: #fff; }
      .block.untranslated { color: rgba(255, 255, 255, 0.82); }
      .row.interim .block.loading { color: rgba(255, 255, 255, 0.72); }
      .time-btn { color: rgba(255, 255, 255, 0.72); }
      .status-bar { color: rgba(255, 255, 255, 0.82); }
      .reopen-fab { background: rgba(8, 8, 8, 0.9); border-color: rgba(255, 255, 255, 0.35); }

      @media (prefers-contrast: more) {
        .panel, .reopen-fab { background: rgba(0, 0, 0, 0.98); border-color: #fff; backdrop-filter: none; }
        .block { background: rgba(255, 255, 255, 0.14); }
        .row.active .block { background: rgba(255, 255, 255, 0.22); box-shadow: inset 0 0 0 1px #fff; }
        .block.src, .block.untranslated, .time-btn, .status-bar { color: #fff; }
      }
      @media (forced-colors: active) {
        .panel, .reopen-fab { background: Canvas; color: CanvasText; border: 2px solid CanvasText; backdrop-filter: none; }
        .block { background: Canvas; color: CanvasText; border: 1px solid CanvasText; text-shadow: none; }
        .block.src, .block.tgt, .block.untranslated, .time-btn, .status-bar { color: CanvasText; }
        .row.active .block { border-color: Highlight; box-shadow: none; }
      }
`;

    panel = document.createElement('div');
    panel.className = 'panel';

    const resizeTop = document.createElement('div');
    resizeTop.className = 'resize-edge top';
    resizeTop.title = 'Drag to resize height';
    makeVerticalResize(resizeTop, 'top');

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.title = 'Drag to resize';
    makeResizable(resizeHandle);

    const resizeBottom = document.createElement('div');
    resizeBottom.className = 'resize-edge bottom';
    resizeBottom.title = 'Drag to resize height';
    makeVerticalResize(resizeBottom, 'bottom');

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const title = document.createElement('div');
    title.className = 'toolbar-title';
    title.textContent = 'yravgSubMeetly';

    const actions = document.createElement('div');
    actions.className = 'toolbar-actions';

    const refineLabel = document.createElement('label');
    refineLabel.className = 'tool-toggle';
    refineToggle = document.createElement('input');
    refineToggle.type = 'checkbox';
    refineToggle.checked = refineTranslation;
    refineToggle.title = 'Live refine translation (draft while speaking, correct at end)';
    refineToggle.addEventListener('change', () => {
      applyOverlaySetting({ refineTranslation: refineToggle.checked });
    });
    refineLabel.append(refineToggle, document.createTextNode('RefineShort'));

    const dualLineLabel = document.createElement('label');
    dualLineLabel.className = 'tool-toggle';
    dualLineToggle = document.createElement('input');
    dualLineToggle.type = 'checkbox';
    dualLineToggle.checked = dualLine;
    dualLineToggle.title = 'Show original + translation';
    dualLineToggle.addEventListener('change', () => {
      applyOverlaySetting({ dualLine: dualLineToggle.checked });
    });
    dualLineLabel.append(dualLineToggle, document.createTextNode('Dual Line'));

    forceTranslateWrap = document.createElement('div');
    forceTranslateWrap.className = 'force-wrap';

    forceTranslateBtn = document.createElement('button');
    forceTranslateBtn.type = 'button';
    forceTranslateBtn.className = 'tool-btn force-btn';
    forceTranslateBtn.textContent = 'Force Translate ▾';
    forceTranslateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (forceTranslateBtn.dataset.busy === '1') return;
      toggleForceMenu();
    });

    forceTranslateMenu = document.createElement('div');
    forceTranslateMenu.className = 'force-menu hidden';

    forceAllBtn = document.createElement('button');
    forceAllBtn.type = 'button';
    forceAllBtn.className = 'force-menu-item';
    forceAllBtn.textContent = 'Re-translate all (0)';
    forceAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      forceTranslate('all');
    });

    forceSomeBtn = document.createElement('button');
    forceSomeBtn.type = 'button';
    forceSomeBtn.className = 'force-menu-item';
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
    rangeBtn.textContent = 'Translate time range';
    rangeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      forceTranslate('range');
    });

    rangeSec.append(fromLabel, toLabel, rangeBtn);
    forceTranslateMenu.append(forceAllBtn, forceSomeBtn, rangeSec);
    forceTranslateWrap.append(forceTranslateBtn, forceTranslateMenu);
    document.addEventListener('click', onForceMenuOutside);

    const autoScrollLabel = document.createElement('label');
    autoScrollLabel.className = 'tool-toggle';
    autoScrollToggle = document.createElement('input');
    autoScrollToggle.type = 'checkbox';
    autoScrollToggle.checked = autoScrollEnabled;
    autoScrollToggle.title = 'Follow playback automatically';
    autoScrollToggle.addEventListener('change', () => {
      autoScrollEnabled = autoScrollToggle.checked;
      chrome.storage.local.set({ overlayAutoScroll: autoScrollEnabled }).catch(() => {});
      if (autoScrollEnabled) userPinnedScroll = false;
      followPlayback(video?.currentTime ?? 0, { forceScroll: autoScrollEnabled });
      if (autoScrollEnabled) schedulePlaybackFollow();
    });
    autoScrollLabel.append(autoScrollToggle, document.createTextNode('Auto scroll'));

    compactBtn = document.createElement('button');
    compactBtn.type = 'button';
    compactBtn.className = 'tool-close';
    compactBtn.title = 'Compact caption bar';
    compactBtn.textContent = '▣';
    compactBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      compactMode = !compactMode;
      applyCompactLock();
    });

    lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'tool-close';
    lockBtn.title = 'Lock panel (block drag & resize)';
    lockBtn.textContent = '🔓';
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      locked = !locked;
      applyCompactLock();
    });

    minimizeBtn = document.createElement('button');
    minimizeBtn.type = 'button';
    minimizeBtn.className = 'tool-close';
    minimizeBtn.title = 'Minimize to CC Subtitles';
    minimizeBtn.textContent = '−';
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      minimizeOverlay();
    });

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tool-close';
    closeBtn.title = 'Close subtitles overlay';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissOverlay();
    });

    actions.append(refineLabel, dualLineLabel, forceTranslateWrap, autoScrollLabel, compactBtn, lockBtn, minimizeBtn, closeBtn);
    toolbar.append(title, actions);

    reopenFab = document.createElement('button');
    reopenFab.type = 'button';
    reopenFab.className = 'reopen-fab hidden';
    reopenFab.textContent = 'CC Subtitles';
    reopenFab.title = 'Show subtitles panel';
    reopenFab.addEventListener('click', () => setPanelVisible(true));

    rowsEl = document.createElement('div');
    rowsEl.className = 'scroll';

    compactCap = document.createElement('div');
    compactCap.className = 'compact-cap';
    compactCap.textContent = 'Listening…';

    statusBar = document.createElement('div');
    statusBar.className = 'status-bar hidden';

    panel.append(resizeTop, toolbar, rowsEl, compactCap, statusBar, resizeHandle, resizeBottom);
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
  }

  function applyCompactLock() {
    if (!panel) return;
    panel.classList.toggle('compact', compactMode);
    panel.classList.toggle('locked', locked);
    if (compactBtn) {
      compactBtn.textContent = compactMode ? '▦' : '▣';
      compactBtn.title = compactMode ? 'Expand to full transcript' : 'Compact caption bar';
    }
    if (lockBtn) {
      lockBtn.textContent = locked ? '🔒' : '🔓';
      lockBtn.title = locked ? 'Unlock panel (allow drag & resize)' : 'Lock panel (block drag & resize)';
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

  function setStatus(text) {
    if (!host) buildOverlay();
    if (!text) {
      statusBar.classList.add('hidden');
      statusBar.textContent = '';
      return;
    }
    statusBar.textContent = text;
    statusBar.classList.remove('hidden');
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

    rowsEl.querySelectorAll('.row.interim').forEach((r) => r.remove());
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
        loading.textContent = '● ● ●';
        blocks.appendChild(loading);
      }

      row.append(spacer, time, blocks);
      rowsEl.appendChild(row);
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
    document.removeEventListener('click', onForceMenuOutside);
    if (host) {
      host.remove();
      host = null;
      panel = null;
      rowsEl = null;
      statusBar = null;
      forceTranslateBtn = null;
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

  chrome.storage.local.get(['overlayPos', 'overlayAutoScroll', 'overlayPanelVisible', 'overlayPanelSize', 'overlayCompact', 'overlayLocked', 'settings']).then(
    ({ overlayPos, overlayAutoScroll, overlayPanelVisible, overlayPanelSize, overlayCompact, overlayLocked, settings }) => {
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
  });

  chrome.storage.onChanged?.addListener((changes) => {
    const s = changes.settings?.newValue;
    if (!s) return;
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
    if (pstate === 'loading') setStatus('Loading local AI models…');
    else if (pstate === 'warmup') setStatus('Warming up…');
    else if (pstate === 'listening') setStatus('Listening — live translation active');
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
    setStatus(`Loading models…${resume}`);
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
        if (msg.data?.error) setStatus(msg.data.error);
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
          setStatus('Translation model returned no results — download the language pair model in Settings');
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
