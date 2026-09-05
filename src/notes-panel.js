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
import { listMeetings, saveMeeting, deleteMeeting, backendName } from './lib/notes-store.js';
import { makeT } from './lib/notes-i18n.js';
import { flagMomentAndSave, addItem, removeItem } from './lib/notes-actions.js';
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

/** Urutan terbaru: tanpa timecode (butir manual) paling atas, lalu t0
 *  terbesar, lalu urutan register. Butir yang baru ditambah harus langsung
 *  terlihat di potongan 3-baris tiap bagian. */
function byRecency(a, b) {
  return (b.i.src?.t0 ?? Infinity) - (a.i.src?.t0 ?? Infinity) || b.idx - a.idx;
}

/** Tiga butir terakhir menurut posisi dalam rekaman (t0), lalu urutan register. */
function latestItems(meeting, lang, n = 3) {
  if (!meeting) return [];
  return meeting.items
    .map((i, idx) => ({ i, idx }))
    .sort(byRecency)
    .slice(0, n)
    .map(({ i }) => rowItem(i, lang));
}

function rowItem(i, lang) {
  return {
    ref: i.ref,
    type: i.type,
    text: pickText(i.text, lang),
    tc: i.src?.tc || null,
    speaker: i.src?.speaker ? i.src.speaker.split(/\s+/)[0] : null,
    conf: i.src ? Math.round(i.confidence * 100) : null,
    low: i.confidence < LOW_CONFIDENCE,
    owner: i.owner || null,
    status: i.status || null,
  };
}

/** Butir terbaru per jenis untuk tiga bagian panel (keputusan / tindak lanjut). */
function latestByType(meeting, lang, type, n = 3) {
  if (!meeting) return [];
  return meeting.items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => i.type === type)
    .sort(byRecency)
    .slice(0, n)
    .map(({ i }) => rowItem(i, lang));
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
  const { meetings, active, lang, T, capture, notice, summaryDraft, addingDecision, addingAction } = state;
  const stats = active ? meetingStats(active) : null;
  const latest = latestItems(active, lang);
  const decisions = latestByType(active, lang, 'decision');
  const actions = latestByType(active, lang, 'action');
  const summary = active ? pickText(active.summary, lang) : '';
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
              <div class="notes-sec">
                <div class="notes-sec-head"><h4>${escapeHtml(T('secSummary'))}</h4></div>
                ${summaryDraft
                  ? `<p class="notes-summary notes-draft">${escapeHtml(summaryDraft)}</p>
                     <div class="notes-draft-actions">
                       <button type="button" class="mini-btn" id="btn-save-summary">${escapeHtml(T('saveSummary'))}</button>
                       <button type="button" class="mini-btn" id="btn-cancel-summary">${escapeHtml(T('draftCancel'))}</button>
                     </div>`
                  : summary
                    ? `<p class="notes-summary">${escapeHtml(summary)}</p>`
                    : `<p class="notes-empty">${escapeHtml(T('noneYet'))}</p>`}
                ${!summaryDraft && active.items.length ? `<div class="notes-draft-actions"><button type="button" class="mini-btn" id="btn-auto-summary">${escapeHtml(T('autoSummary'))}</button></div>` : ''}
              </div>
              <div class="notes-sec">
                <div class="notes-sec-head"><h4>${escapeHtml(T('secDecisions'))}</h4>${stats.decisions ? `<span class="notes-count">${stats.decisions}</span>` : ''}</div>
                ${decisions.length ? `<div class="notes-latest">${decisions.map((i) => `
                <div class="notes-latest-row" data-ref="${escapeHtml(i.ref)}">
                  <span class="rail" style="background:${TYPE_COLOR[i.type]}"></span>
                  <span class="body">
                    <span class="txt">${escapeHtml(i.text)}</span>
                    <span class="meta">${i.tc ? `${escapeHtml(i.tc)} · ` : ''}${escapeHtml(i.ref)}</span>
                  </span>
                  <button type="button" class="mini-btn row-del" data-del="${escapeHtml(i.ref)}" title="✕">✕</button>
                </div>`).join('')}</div>` : `<p class="notes-empty">${escapeHtml(T('noneYet'))}</p>`}
                ${addingDecision
                  ? `<div class="notes-add-row">
                       <input type="text" id="decision-input" class="notes-input" placeholder="${escapeHtml(T('decision'))}…" />
                       <button type="button" class="mini-btn" id="btn-save-decision">${escapeHtml(T('saveShort'))}</button>
                       <button type="button" class="mini-btn" id="btn-cancel-decision">${escapeHtml(T('draftCancel'))}</button>
                     </div>`
                  : `<div class="notes-draft-actions"><button type="button" class="mini-btn" id="btn-add-decision">+ ${escapeHtml(T('secDecisions'))}</button></div>`}
              </div>
              <div class="notes-sec">
                <div class="notes-sec-head"><h4>${escapeHtml(T('secActions'))}</h4>${stats.actionsTotal ? `<span class="notes-count">${stats.actionsOpen}/${stats.actionsTotal}</span>` : ''}</div>
                ${actions.length ? `<div class="notes-latest">${actions.map((i) => `
                <div class="notes-latest-row" data-ref="${escapeHtml(i.ref)}">
                  <span class="rail" style="background:${TYPE_COLOR[i.type]}"></span>
                  <span class="body">
                    <span class="txt">${escapeHtml(i.text)}</span>
                    <span class="meta">${i.owner ? `${escapeHtml(i.owner)} · ` : `${escapeHtml(T('noOwner'))} · `}${i.tc ? `${escapeHtml(i.tc)}` : escapeHtml(i.ref)}</span>
                  </span>
                  <button type="button" class="mini-btn row-del" data-del="${escapeHtml(i.ref)}" title="✕">✕</button>
                </div>`).join('')}</div>` : `<p class="notes-empty">${escapeHtml(T('noneYet'))}</p>`}
                ${addingAction
                  ? `<div class="notes-add-row">
                       <input type="text" id="action-input" class="notes-input" placeholder="${escapeHtml(T('secActions'))}…" />
                       <input type="text" id="action-owner-input" class="notes-input notes-owner-input" placeholder="${escapeHtml(T('ownerLabel'))}" />
                       <button type="button" class="mini-btn" id="btn-save-action">${escapeHtml(T('saveShort'))}</button>
                       <button type="button" class="mini-btn" id="btn-cancel-action">${escapeHtml(T('draftCancel'))}</button>
                     </div>`
                  : `<div class="notes-draft-actions"><button type="button" class="mini-btn" id="btn-add-action">+ ${escapeHtml(T('secActions'))}</button></div>`}
              </div>
              ${latest.length ? `<div class="notes-latest-label">${escapeHtml(T('latest'))}</div>
              <div class="notes-latest" id="notes-open-list">${latest.map((i, idx) => `
                <div class="notes-latest-row${idx === latest.length - 1 && latest.length > 2 ? ' dim' : ''}" data-ref="${escapeHtml(i.ref)}">
                  <span class="rail" style="background:${TYPE_COLOR[i.type]}"></span>
                  <span class="body">
                    <span class="txt">${escapeHtml(i.text)}</span>
                    <span class="meta">${i.tc ? `${escapeHtml(i.tc)} · ` : ''}${i.speaker ? `${escapeHtml(i.speaker)} · ` : ''}${i.conf != null ? `<span class="${i.low ? 'low' : ''}">${i.conf}%</span>` : escapeHtml(i.ref)}</span>
                  </span>
                </div>`).join('')}</div>` : ''}`
          : `<p class="notes-empty">${escapeHtml(T('nothingLeft'))}</p>`}
      </div>

      <div class="notes-toolbar">
        <button type="button" class="btn primary notes-open-btn" id="btn-open-register">
          ${escapeHtml(T('openRegister'))}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 16 16 8"/><path d="M9.5 8H16v6.5"/></svg>
        </button>
        ${active ? `<div class="notes-export-row">
          <button type="button" class="mini-btn" id="btn-notes-txt">TXT</button>
          <button type="button" class="mini-btn" id="btn-notes-md">Markdown</button>
          <button type="button" class="mini-btn" id="btn-notes-sync" title="Dorong ke penyimpanan bersama Native Helper">Sync</button>
        </div>` : ''}
        ${!meetings.length ? `<button type="button" class="btn ghost" id="btn-notes-sample">${escapeHtml(T('startNext'))} (${escapeHtml(T('minutes'))} demo)</button>` : ''}
      </div>
      <p class="notes-meta notes-hint">${escapeHtml(T('panelHint'))}</p>

      ${meetings.length
        ? `<div class="notes-block" id="notes-recent-block">
            <div class="notes-block-head">
              <h3>${escapeHtml(T('meetings'))}</h3>
              <span class="notes-count">${meetings.length}</span>
            </div>
            <div class="notes-saved-list" id="notes-saved-list">
              ${meetings
                .slice(0, 6)
                .map(
                  (m) => `
                <div class="notes-saved-row">
                  <button type="button" class="notes-saved-item${m.id === active?.id ? ' active' : ''}" data-meeting-id="${escapeHtml(m.id)}">
                    <div>
                      <div class="ns-title">${escapeHtml(m.title)}</div>
                      <div class="ns-meta">${escapeHtml(m.date)}${m.issuedAt ? ` · ${escapeHtml(T('issued'))}` : ''}</div>
                    </div>
                  </button>
                  <button type="button" class="mini-btn row-del" data-meeting-del="${escapeHtml(m.id)}" title="✕">✕</button>
                </div>`,
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
  root.querySelector('#btn-notes-txt')?.addEventListener('click', () => handlers.onExportNotes?.('txt'));
  root.querySelector('#btn-notes-md')?.addEventListener('click', () => handlers.onExportNotes?.('md'));
  root.querySelector('#btn-notes-sync')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    Promise.resolve(handlers.onPushShared?.()).finally(() => {
      btn.disabled = false;
    });
  });
  root.querySelector('#btn-auto-summary')?.addEventListener('click', () => handlers.onGenerateSummary?.());
  root.querySelector('#btn-save-summary')?.addEventListener('click', () => handlers.onSaveSummary?.());
  root.querySelector('#btn-cancel-summary')?.addEventListener('click', () => handlers.onCancelSummary?.());
  root.querySelector('#btn-add-decision')?.addEventListener('click', () => handlers.onAddDecision?.());
  root.querySelector('#btn-save-decision')?.addEventListener('click', () => handlers.onSaveDecision?.());
  root.querySelector('#btn-cancel-decision')?.addEventListener('click', () => handlers.onCancelDecision?.());
  root.querySelector('#btn-add-action')?.addEventListener('click', () => handlers.onAddAction?.());
  root.querySelector('#btn-save-action')?.addEventListener('click', () => handlers.onSaveAction?.());
  root.querySelector('#btn-cancel-action')?.addEventListener('click', () => handlers.onCancelAction?.());
  root.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onDeleteDecision?.(btn.getAttribute('data-del'));
    });
  });
  root.querySelectorAll('.notes-latest-row[data-ref]').forEach((row) => {
    row.addEventListener('click', () => handlers.onOpenRegister?.());
  });
  root.querySelectorAll('[data-meeting-id]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onSelectMeeting?.(btn.getAttribute('data-meeting-id')));
  });
  root.querySelectorAll('[data-meeting-del]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onDeleteMeeting?.(btn.getAttribute('data-meeting-del'));
    });
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
export async function mountNotesPanel(root, { getCapture, onEndCapture, onExportNotes, onPushShared } = {}) {
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

  // Editor poin keputusan & tindak lanjut: form tambah sebaris + hapus per baris.
  let addingDecision = false;
  let addingAction = false;
  const guardEditable = (meeting) => {
    if (!meeting) {
      say(T('msgNoMeeting'));
      return false;
    }
    if (meeting.issuedAt) {
      say(T('flagRefusedIssued'));
      return false;
    }
    return true;
  };
  const persistMeeting = async (meeting) => {
    await saveMeeting(meeting);
    meetings = await listMeetings();
    redraw();
  };

  // Draf ringkasan otomatis (mock lokal): heuristik dari butir tertangkap,
  // belum tersimpan sampai pengguna menekan Simpan.
  let summaryDraft = null;
  const draftSummary = (meeting) => {
    const texts = (meeting?.items || [])
      .map((i) => pickText(i.text, lang).trim())
      .filter(Boolean);
    if (!texts.length) return null;
    if (texts.length === 1) return texts[0];
    return `${texts[0]} … ${texts[texts.length - 1]} (${texts.length} butir).`;
  };

  // Panel ini tidak punya toast. Alasan sebuah tanda ditolak muncul beberapa
  // detik di baris status yang sudah ada — gagal diam-diam itu bug, bukan gaya.
  let notice = null;
  const say = (msg) => {
    notice = msg;
    // Cerminkan ke toast global bila ada (tab Notes mungkin tidak terlihat).
    try {
      window.__ltsToast?.(msg, 'error');
    } catch {
      /* toast opsional — pill status tetap sumber utama */
    }
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
    try {
      window.__ltsToast?.(T('flaggedAt', tc), 'ok');
    } catch {
      /* toast opsional */
    }
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
        summaryDraft,
        addingDecision,
        addingAction,
      },
      {
        onOpenRegister: openRegister,
        onFlagMoment: flagNow,
        onExportNotes: (kind) => onExportNotes?.(kind),
        onPushShared: async () => {
          const meeting = meetings.find((m) => m.id === activeId) || null;
          if (!meeting) {
            say(T('msgNoMeeting'));
            return;
          }
          try {
            const note = await onPushShared?.(meeting, lang);
            if (note) {
              try {
                window.__ltsToast?.(note.title || 'Synced', 'ok');
              } catch {
                /* toast opsional */
              }
            } else {
              say(lang === 'id' ? 'Helper native luring' : 'Native helper offline');
            }
          } catch (e) {
            say(String(e?.message || e));
          }
        },
        onGenerateSummary: () => {
          const meeting = meetings.find((m) => m.id === activeId) || null;
          if (meeting?.issuedAt) {
            say(T('flagRefusedIssued'));
            return;
          }
          summaryDraft = draftSummary(meeting);
          if (!summaryDraft) {
            say(T('noneYet'));
            return;
          }
          redraw();
        },
        onSaveSummary: async () => {
          const meeting = meetings.find((m) => m.id === activeId) || null;
          if (!meeting || !summaryDraft) return;
          if (meeting.issuedAt) {
            say(T('flagRefusedIssued'));
            return;
          }
          try {
            meeting.summary = { ...(meeting.summary || {}), [lang]: summaryDraft };
            await saveMeeting(meeting);
          } catch (e) {
            say(String(e?.message || e));
            return;
          }
          summaryDraft = null;
          meetings = await listMeetings();
          try {
            window.__ltsToast?.(T('msgSummarySaved'), 'ok');
          } catch {
            /* toast opsional */
          }
          redraw();
        },
        onCancelSummary: () => {
          summaryDraft = null;
          redraw();
        },
        onAddDecision: () => {
          const meeting = meetings.find((m) => m.id === activeId) || null;
          if (!meeting) {
            say(T('msgNoMeeting'));
            return;
          }
          if (meeting.issuedAt) {
            say(T('flagRefusedIssued'));
            return;
          }
          addingDecision = true;
          redraw();
          root.querySelector('#decision-input')?.focus();
        },
        onSaveDecision: async () => {
          const meeting = meetings.find((m) => m.id === activeId) || null;
          const text = root.querySelector('#decision-input')?.value.trim() || '';
          if (!meeting || !text) {
            addingDecision = false;
            redraw();
            return;
          }
          addingDecision = false;
          try {
            await persistMeeting(addItem(meeting, { type: 'decision', text: { [lang]: text } }));
          } catch (e) {
            say(e?.code === 'issued' ? T('flagRefusedIssued') : String(e?.message || e));
            return;
          }
          try {
            window.__ltsToast?.(T('secDecisions'), 'ok');
          } catch {
            /* toast opsional */
          }
        },
        onCancelDecision: () => {
          addingDecision = false;
          redraw();
        },
        onDeleteDecision: async (ref) => {
          const meeting = meetings.find((m) => m.id === activeId) || null;
          if (!meeting || !ref) return;
          try {
            await persistMeeting(removeItem(meeting, ref));
          } catch (e) {
            say(e?.code === 'issued' ? T('flagRefusedIssued') : String(e?.message || e));
          }
        },
        onAddAction: () => {
          const meeting = meetings.find((m) => m.id === activeId) || null;
          if (!guardEditable(meeting)) return;
          addingAction = true;
          redraw();
          root.querySelector('#action-input')?.focus();
        },
        onSaveAction: async () => {
          const meeting = meetings.find((m) => m.id === activeId) || null;
          const text = root.querySelector('#action-input')?.value.trim() || '';
          const owner = root.querySelector('#action-owner-input')?.value.trim() || null;
          addingAction = false;
          if (!meeting || !text) {
            redraw();
            return;
          }
          try {
            await persistMeeting(
              addItem(meeting, { type: 'action', text: { [lang]: text }, ...(owner ? { owner } : {}) }),
            );
          } catch (e) {
            say(e?.code === 'issued' ? T('flagRefusedIssued') : String(e?.message || e));
          }
        },
        onCancelAction: () => {
          addingAction = false;
          redraw();
        },
        onEndAndDraft: async () => {
          await onEndCapture?.();
          openRegister();
        },
        onSelectMeeting: (id) => {
          activeId = id;
          summaryDraft = null;
          addingDecision = false;
          addingAction = false;
          redraw();
        },
        onDeleteMeeting: async (id) => {
          if (!id) return;
          try {
            await deleteMeeting(id);
          } catch (e) {
            say(String(e?.message || e));
            return;
          }
          meetings = await listMeetings();
          if (activeId === id) {
            activeId = meetings[0]?.id || null;
            summaryDraft = null;
            addingDecision = false;
            addingAction = false;
          }
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
