/**
 * Panel Notulen (rel samping) — tiket ringkas hidup, BUKAN tempat tabel.
 * Register lengkap ada di src/minutes.html (tab penuh); panel ini hanya
 * menunjukkan status rapat aktif + tindak lanjut terbuka, lalu satu tombol
 * ke sana. Menggantikan draf lama yang memakai bentuk data v1
 * (saveNote/listNotes) yang sudah tidak ada sejak register v2.
 *
 * Side-panel notes ticker — NOT the table surface. The full register lives
 * at src/minutes.html (a full tab); this panel only shows the active
 * meeting's status and open follow-ups, plus one button to get there.
 * Replaces the old draft, which called the v1 store shape (saveNote/
 * listNotes) that no longer exists since the v2 register landed.
 */
import { pickText, meetingStats } from './lib/notes-schema.js';
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

function openFollowUps(meeting, T, lang) {
  if (!meeting) return [];
  return meeting.items
    .filter((i) => i.status !== 'closed' && (i.type === 'action' || i.type === 'question' || i.type === 'risk'))
    .slice(0, 5)
    .map((i) => ({
      ref: i.ref,
      type: T(i.type),
      text: pickText(i.text, lang),
      owner: i.owner,
      due: i.due,
      status: T(i.status),
    }));
}

export function renderNotesPanel(root, state, handlers = {}) {
  const { meetings, active, lang, T } = state;
  const stats = active ? meetingStats(active) : null;
  const openItems = openFollowUps(active, T, lang);

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
        <h3>${active ? escapeHtml(active.title) : escapeHtml(T('minutes'))}</h3>
        ${active
          ? `<p class="notes-meta">${escapeHtml(active.date)} · ${stats.total} ${escapeHtml(T('sItems')).toLowerCase()} · ${stats.unreviewed} ${escapeHtml(T('needReview'))}</p>`
          : `<p class="notes-empty">${escapeHtml(T('nothingLeft'))}</p>`}
      </div>

      <div class="notes-block" id="notes-open-block">
        <h3>${escapeHtml(T('sActions'))}</h3>
        ${openItems.length
          ? `<ul class="notes-actions-list" id="notes-open-list">${openItems
              .map(
                (i) => `
              <li data-ref="${escapeHtml(i.ref)}">
                <div class="act-text">${escapeHtml(i.text)}</div>
                <span class="act-meta">${escapeHtml(i.owner || T('noOwner'))}</span>
                <span class="act-meta">${escapeHtml(i.due || T('noDue'))} · ${escapeHtml(i.status)}</span>
              </li>`,
              )
              .join('')}</ul>`
          : `<p class="notes-empty">${escapeHtml(T('noneYet'))}</p>`}
      </div>

      <div class="notes-toolbar">
        <button type="button" class="btn primary" id="btn-open-register">
          ${escapeHtml(T('openRegister'))}
        </button>
        ${!meetings.length ? `<button type="button" class="btn ghost" id="btn-notes-sample">${escapeHtml(T('startNext'))} (${escapeHtml(T('minutes'))} demo)</button>` : ''}
      </div>
      <p class="notes-meta">${escapeHtml(T('registerHint'))}</p>

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
