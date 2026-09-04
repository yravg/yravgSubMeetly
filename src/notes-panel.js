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
import { pickText, meetingStats, TYPE_COLOR, ITEM_TYPES, LOW_CONFIDENCE } from './lib/notes-schema.js';
import { listMeetings, backendName } from './lib/notes-store.js';
import { makeT } from './lib/notes-i18n.js';
import { seedSampleData } from './lib/notes-fixture.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function registerUrl() {
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('minutes.html')
    : 'minutes.html';
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

export function renderNotesPanel(root, state, handlers = {}) {
  const { meetings, active, lang, T } = state;
  const stats = active ? meetingStats(active) : null;
  const latest = latestItems(active, lang);
  const counts = active
    ? ITEM_TYPES.map((t) => [t, active.items.filter((i) => i.type === t).length]).filter(([, n]) => n > 0)
    : [];

  root.innerHTML = `
    <div class="notes-panel" data-notes-root>
      <div class="notes-status-row">
        <span class="notes-pill ${active ? 'ready' : 'idle'}">
          <span aria-hidden="true">●</span>
          ${active ? escapeHtml(T('onDevice')) : escapeHtml(T('msgNoMeeting'))}
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
  root.querySelector('#btn-notes-sample')?.addEventListener('click', () => handlers.onLoadSample?.());
  root.querySelectorAll('.notes-latest-row[data-ref]').forEach((row) => {
    row.addEventListener('click', () => handlers.onOpenRegister?.());
  });
  root.querySelectorAll('[data-meeting-id]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onSelectMeeting?.(btn.getAttribute('data-meeting-id')));
  });
}

export async function mountNotesPanel(root) {
  const lang = (document.documentElement.lang || 'en').startsWith('id') ? 'id' : 'en';
  const T = makeT(lang);
  let meetings = await listMeetings();
  let activeId = meetings[0]?.id || null;

  const redraw = () => {
    renderNotesPanel(
      root,
      { meetings, active: meetings.find((m) => m.id === activeId) || null, lang, T },
      {
        onOpenRegister: openRegister,
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
  return () => ({ meetings, activeId });
}
