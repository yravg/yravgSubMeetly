/**
 * Panel Notulen (rel samping) — tiket ringkas hidup, BUKAN tempat tabel.
 * Register lengkap ada di src/minutes.html (tab penuh); panel ini hanya
 * menunjukkan apa yang sudah tertangkap dari rapat aktif (hitungan per jenis
 * + tiga butir terakhir dengan timecode / pembicara / keyakinan ASR), lalu
 * satu tombol ke register. Bentuknya mengikuti artboard "Side panel — live
 * capture" di kanvas desain Minutes Register.
 *
 * Side-panel notes ticker — NOT the table surface. The full register lives
 * at src/minutes.html (a full tab); this panel only shows what has been
 * captured so far from the active meeting (per-type counts + the three
 * latest items with timecode / speaker / ASR confidence) and one button to
 * the register. Layout follows the "Side panel — live capture" artboard.
 */
import {
  pickText, meetingStats, createMeeting, toTimecode,
  TYPE_COLOR, ITEM_TYPES, LOW_CONFIDENCE,
} from './lib/notes-schema.js';
import { listMeetings, saveMeeting, backendName } from './lib/notes-store.js';
import { makeT } from './lib/notes-i18n.js';
import { flagMomentAndSave } from './lib/notes-actions.js';
import { seedSampleData } from './lib/notes-fixture.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function registerUrl() {
  const lang = (document.documentElement.lang || 'en').startsWith('id') ? 'id' : 'en';
  const base = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('minutes.html')
    : 'minutes.html';
  return `${base}?lang=${lang}`;
}

function openRegister() {
  const url = registerUrl();
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank');
}

/** Tiga butir terakhir menurut posisi dalam rekaman (t0), lalu urutan register. */
function latestItems(meeting, lang, n = 3) {
  if (!meeting) return [];
  return meeting.items
    .map((i, idx) => ({ i, idx }))
    .sort((a, b) => (b.i.src?.t0 ?? -1) - (a.i.src?.t0 ?? -1) || b.idx - a.idx)
    .slice(0, n)
    .map(({ i }) => ({
      ref: i.ref,
      type: i.type,
      text: pickText(i.text, lang),
      tc: i.src?.tc || null,
      speaker: i.src?.speaker ? i.src.speaker.split(/\s+/)[0] : null,
      conf: i.src ? Math.round(i.confidence * 100) : null,
      low: i.confidence < LOW_CONFIDENCE,
    }));
}

/** Detik sejak `startedAt` sebagai HH:MM:SS — jam rekaman di kartu. */
function elapsedSeconds(capture, now = Date.now()) {
  if (!capture?.running || !capture.startedAt) return 0;
  return Math.max(0, Math.floor((now - capture.startedAt) / 1000));
}

const macLike = () => /^Mac/i.test(globalThis.navigator?.platform || '');
/** Petunjuk pintasan "flag" — ⌘⇧F di Mac, Ctrl+Shift+F di tempat lain. */
function flagShortcutHint() {
  return macLike() ? '\u2318\u21e7F' : 'Ctrl+Shift+F';
}

// Strip gelombang di artboard adalah DEKORASI, bukan meter amplitudo: tinggi
// batang tetap (deterministik) supaya panel tidak berpura-pura menampilkan
// level audio yang memang belum tersedia dari pipeline.
/** Berapa lama alasan penolakan bertahan di baris status. */
const NOTICE_MS = 6000;

const WAVE_BARS = [22, 38, 55, 31, 64, 44, 73, 36, 58, 81, 47, 29, 66, 52, 88, 61, 94, 70, 45, 78];

function waveHtml(running) {
  const live = WAVE_BARS.length - 5;
  return `<div class="notes-wave" aria-hidden="true">${WAVE_BARS
    .map((h, i) => `<span class="${running && i >= live ? 'on' : ''}" style="height:${h}%"></span>`)
    .join('')}</div>`;
}

/**
 * Rel tangkap langsung (artboard SidePanel): titik status + jam + lencana
 * mesin, strip gelombang, "End & draft", lalu tombol "Flag this moment".
 * Tidak ada tombol Pause — pipeline-nya memang tidak punya jeda, dan kontrol
 * mati lebih buruk daripada kontrol yang tidak ada.
 */
function captureRailHtml(capture, T, { issued = false } = {}) {
  const running = !!capture.running;
  // Dua alasan berbeda untuk tombol mati: belum merekam, atau notulen aktif
  // sudah terbit (beku). Judul tooltip mengatakan yang mana.
  const blocked = !running || issued;
  const why = issued ? T('flagRefusedIssued') : T('flagNeedsRecording');
  return `
      <div class="notes-rec" id="notes-recording-card">
        <div class="notes-rec-head">
          <span class="notes-rec-dot${running ? ' live' : ''}" aria-hidden="true"></span>
          <span class="notes-rec-label">${escapeHtml(T(running ? 'recording' : 'idle'))}</span>
          <span class="notes-rec-clock mono" id="notes-elapsed">${toTimecode(elapsedSeconds(capture))}</span>
          <span class="notes-rec-spacer"></span>
          <span class="notes-engine mono">${escapeHtml(capture.engine || '')}</span>
        </div>
        ${waveHtml(running)}
        <div class="notes-rec-actions">
          <button type="button" class="btn primary notes-end-btn" id="btn-end-draft"${running ? '' : ' disabled'}>
            ${escapeHtml(T('endAndDraft'))}
          </button>
        </div>
      </div>

      <button type="button" class="notes-flag" id="btn-flag-moment"${blocked ? ` disabled title="${escapeHtml(why)}"` : ''}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e0b05c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 5h12l-2.2 3.6L17 12H5"/></svg>
        ${escapeHtml(T('flagMoment'))}
        <span class="notes-flag-key mono">${escapeHtml(flagShortcutHint())}</span>
      </button>`;
}

export function renderNotesPanel(root, state, handlers = {}) {
  const { meetings, active, lang, T, capture, notice } = state;
  const stats = active ? meetingStats(active) : null;
  const latest = latestItems(active, lang);
  const counts = active
    ? ITEM_TYPES.map((t) => [t, active.items.filter((i) => i.type === t).length]).filter(([, n]) => n > 0)
    : [];

  root.innerHTML = `
    <div class="notes-panel" data-notes-root>
      ${capture ? captureRailHtml(capture, T, { issued: !!active?.issuedAt }) : ''}

      <div class="notes-status-row">
        <span class="notes-pill ${notice ? 'error' : active ? 'ready' : 'idle'}" id="notes-status-pill">
          <span aria-hidden="true">●</span>
          ${notice ? escapeHtml(notice) : active ? escapeHtml(T('onDevice')) : escapeHtml(T('msgNoMeeting'))}
        </span>
        <span class="notes-meta">${escapeHtml(backendName())}</span>
      </div>

      <div class="notes-block" id="notes-active-block">
        <div class="notes-block-head">
          <h3>${active ? escapeHtml(T('capturedSoFar')) : escapeHtml(T('minutes'))}</h3>
          ${active ? `<span class="notes-count">${stats.total}</span>` : ''}
        </div>
        ${active
          ? `<p class="notes-meta notes-title-line">${escapeHtml(active.title)} · ${escapeHtml(active.date)}${stats.unreviewed ? ` · <span class="warn">${stats.unreviewed} ${escapeHtml(T('needReview'))}</span>` : ''}</p>
             ${counts.length ? `<div class="notes-chips">${counts.map(([t, n]) => `<span class="notes-chip"><i style="background:${TYPE_COLOR[t]}"></i>${escapeHtml(T(t))}<b>${n}</b></span>`).join('')}</div>` : ''}
             ${latest.length ? `<div class="notes-latest-label">${escapeHtml(T('latest'))}</div>
             <div class="notes-latest" id="notes-open-list">${latest.map((i, idx) => `
               <div class="notes-latest-row${idx === latest.length - 1 && latest.length > 2 ? ' dim' : ''}" data-ref="${escapeHtml(i.ref)}">
                 <span class="rail" style="background:${TYPE_COLOR[i.type]}"></span>
                 <span class="body">
                   <span class="txt">${escapeHtml(i.text)}</span>
                   <span class="meta">${i.tc ? `${escapeHtml(i.tc)} · ` : ''}${i.speaker ? `${escapeHtml(i.speaker)} · ` : ''}${i.conf != null ? `<span class="${i.low ? 'low' : ''}">${i.conf}%</span>` : escapeHtml(i.ref)}</span>
                 </span>
               </div>`).join('')}</div>` : `<p class="notes-empty">${escapeHtml(T('noneYet'))}</p>`}`
          : `<p class="notes-empty">${escapeHtml(T('nothingLeft'))}</p>`}
      </div>

      <div class="notes-toolbar">
        <button type="button" class="btn primary notes-open-btn" id="btn-open-register">
          ${escapeHtml(T('openRegister'))}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 16 16 8"/><path d="M9.5 8H16v6.5"/></svg>
        </button>
        ${!meetings.length ? `<button type="button" class="btn ghost" id="btn-notes-sample">${escapeHtml(T('startNext'))} (${escapeHtml(T('minutes'))} demo)</button>` : ''}
      </div>
      <p class="notes-meta notes-hint">${escapeHtml(T('panelHint'))}</p>

      ${meetings.length > 1
        ? `<div class="notes-block" id="notes-recent-block">
            <h3>${escapeHtml(T('meetings'))}</h3>
            <div class="notes-saved-list" id="notes-saved-list">
              ${meetings
                .slice(0, 6)
                .map(
                  (m) => `
                <button type="button" class="notes-saved-item${m.id === active?.id ? ' active' : ''}" data-meeting-id="${escapeHtml(m.id)}">
                  <div>
                    <div class="ns-title">${escapeHtml(m.title)}</div>
                    <div class="ns-meta">${escapeHtml(m.date)}${m.issuedAt ? ` · ${escapeHtml(T('issued'))}` : ''}</div>
                  </div>
                </button>`,
                )
                .join('')}
            </div>
          </div>`
        : ''}
    </div>
  `;

  root.querySelector('#btn-open-register')?.addEventListener('click', () => handlers.onOpenRegister?.());
  root.querySelector('#btn-end-draft')?.addEventListener('click', () => handlers.onEndAndDraft?.());
  root.querySelector('#btn-flag-moment')?.addEventListener('click', () => handlers.onFlagMoment?.());
  root.querySelector('#btn-notes-sample')?.addEventListener('click', () => handlers.onLoadSample?.());
  root.querySelectorAll('.notes-latest-row[data-ref]').forEach((row) => {
    row.addEventListener('click', () => handlers.onOpenRegister?.());
  });
  root.querySelectorAll('[data-meeting-id]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onSelectMeeting?.(btn.getAttribute('data-meeting-id')));
  });
}

/**
 * Pasang tiket panel. `getCapture()` (dipasok sidepanel.js) melaporkan
 * `{ running, startedAt, engine }`; tanpa itu rel tangkap-langsung tidak
 * dirender sama sekali — panel tetap berguna di konteks lain (uji, lab).
 *
 * Jam berdetak sekali per detik; interval lama SELALU dibersihkan lebih dulu
 * karena applyI18n() memanggil ulang mountNotesPanel pada root yang sama saat
 * bahasa berubah.
 */
export async function mountNotesPanel(root, { getCapture, onEndCapture } = {}) {
  const lang = (document.documentElement.lang || 'en').startsWith('id') ? 'id' : 'en';
  const T = makeT(lang);
  let meetings = await listMeetings();
  let activeId = meetings[0]?.id || null;

  if (root.__notesTick) {
    clearInterval(root.__notesTick);
    root.__notesTick = null;
  }
  if (root.__notesNoticeTimer) {
    clearTimeout(root.__notesNoticeTimer);
    root.__notesNoticeTimer = null;
  }

  // Panel ini tidak punya toast. Alasan sebuah tanda ditolak muncul beberapa
  // detik di baris status yang sudah ada — gagal diam-diam itu bug, bukan gaya.
  let notice = null;
  const say = (msg) => {
    notice = msg;
    redraw();
    clearTimeout(root.__notesNoticeTimer);
    root.__notesNoticeTimer = setTimeout(() => {
      notice = null;
      root.__notesNoticeTimer = null;
      redraw();
    }, NOTICE_MS);
  };

  const readCapture = () => {
    if (!getCapture) return null;
    const c = getCapture() || {};
    return { running: !!c.running, startedAt: c.startedAt ?? null, engine: c.engine || '' };
  };

  const flagNow = async () => {
    const cap = readCapture();
    if (!cap?.running) return;
    const t0 = elapsedSeconds(cap);
    const tc = toTimecode(t0);
    let meeting = meetings.find((m) => m.id === activeId) || null;
    if (meeting?.issuedAt) {
      // Notulen terbit itu beku (assertEditable). Katakan kenapa, jangan diam.
      say(T('flagRefusedIssued'));
      return;
    }
    if (!meeting) {
      meeting = await saveMeeting(
        createMeeting({
          title: T('untitledMeeting'),
          date: new Date().toISOString().slice(0, 10),
          locale: lang,
        }),
      );
    }
    try {
      await flagMomentAndSave(meeting, { tc, t0, text: T('flaggedAt', tc) });
    } catch (e) {
      console.warn('[notes] flagMoment:', e?.message || e);
      say(e?.code === 'issued' ? T('flagRefusedIssued') : String(e?.message || e));
      return;
    }
    meetings = await listMeetings();
    activeId = meeting.id;
    redraw();
  };

  const redraw = () => {
    renderNotesPanel(
      root,
      {
        meetings,
        active: meetings.find((m) => m.id === activeId) || null,
        lang,
        T,
        capture: readCapture(),
        notice,
      },
      {
        onOpenRegister: openRegister,
        onFlagMoment: flagNow,
        onEndAndDraft: async () => {
          await onEndCapture?.();
          openRegister();
        },
        onSelectMeeting: (id) => {
          activeId = id;
          redraw();
        },
        onLoadSample: async () => {
          await seedSampleData();
          meetings = await listMeetings();
          activeId = meetings[0]?.id || null;
          redraw();
          openRegister();
        },
      },
    );
  };

  redraw();

  if (getCapture) {
    // Satu detak per detik: selagi merekam ia hanya menulis ulang jam (murah),
    // dan menggambar ulang kartu hanya ketika status rekam benar-benar berubah.
    let wasRunning = readCapture().running;
    root.__notesTick = setInterval(() => {
      const cap = readCapture();
      if (cap.running !== wasRunning) {
        wasRunning = cap.running;
        redraw();
        return;
      }
      if (!cap.running) return;
      const clock = root.querySelector('#notes-elapsed');
      if (clock) clock.textContent = toTimecode(elapsedSeconds(cap));
    }, 1000);
  }

  return () => ({ meetings, activeId });
}
