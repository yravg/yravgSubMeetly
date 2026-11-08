/**
 * THREADS — Minutes boards Inbox (T01), Projects (T02) and Meeting highlights (T04).
 *
 * Contract
 *   mountThreads(ctx) wires one delegated listener set on #pane; renderThreads(view) returns the
 *   HTML for 'inbox' | 'projects' | 'highlights'. All rules live in lib/inbox, lib/librarian and
 *   lib/highlights; this file only draws them and calls the *AndSave actions.
 *   - Every write goes through setStatusAndSave / editItemAndSave / acceptItemAndSave /
 *     issueMeetingAndSave / saveMeeting. Undo is a second write that restores the old value.
 *   - Device-local state (no network): ysmInboxArchived, ysmLibrarianLooks, ysmLibrarianPaused,
 *     ysmMeetingsClosed.
 *   - Five states per board: normal, empty, error (load/save failed, Retry), locked (issued or
 *     closed meeting), needs input (rows without an owner, a change form with no title, items to review).
 *   - Test hook: globalThis.__ysmThreadsFail = true shows the error state until Retry.
 */
import { groupInbox, itemKey, snoozeDue } from './lib/inbox.js';
import { highlightsFor } from './lib/highlights.js';
import {
  pendingSuggestions, suggestFiling, applySuggestion, recordLook, whyText,
} from './lib/librarian.js';
import {
  setStatusAndSave, editItemAndSave, acceptItemAndSave, issueMeetingAndSave, blockingItems, RegisterError,
} from './lib/notes-actions.js';
import { PROJECT_TYPES, pickText, TYPE_COLOR } from './lib/notes-schema.js';
import { saveMeeting } from './lib/notes-store.js';

const K_ARCH = 'ysmInboxArchived';
const K_LOOKS = 'ysmLibrarianLooks';
const K_PAUSED = 'ysmLibrarianPaused';
const K_CLOSED = 'ysmMeetingsClosed';

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: state lives for this page only */ } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const L = {
  en: {
    open: 'open', inboxZero: 'Inbox zero', nextMeeting: 'Next meeting', nothingTo: 'Nothing is waiting for you.',
    overdue: 'Overdue', week: 'This week', later: 'Later', nodate: 'No date', doing: 'Doing', done: 'Finished', archived: 'Archived',
    all: 'All', decisions: 'Decisions', actions: 'Actions', questions: 'Questions', risks: 'Risks',
    close: 'Close', reopen: 'Reopen', restore: 'Restore', snooze: 'Snooze', tomorrow: 'Tomorrow', nextWeek: 'Next week', clearDue: 'No date',
    archiveAll: 'Archive all', undo: 'Undo', noOwner: 'No owner', due: 'Due', issued: 'Issued', open_: 'Open in register',
    noMatch: 'No row matches the search.', retry: 'Retry', errTitle: 'Could not read or save.', errBody: 'Your notes are untouched. Try again.',
    lockedRow: 'Issued meeting, read only', needsOwner: (n) => `${n} open item${n === 1 ? ' has' : 's have'} no owner.`,
    closed: 'Closed', reopened: 'Reopened', snoozed: 'Snoozed', archivedN: (n) => `Archived ${n}`,
    projects: 'Projects', librarian: 'Librarian suggests', rules: 'rules, no model', pause: 'Pause', resume: 'Resume', paused: 'Librarian is paused. No new suggestions.',
    toConfirm: 'To confirm', filed: 'Filed', dismissed: 'Dismissed', unfiled: 'Unfiled', history: 'Look history', nothingConfirm: 'Nothing to confirm',
    accept: 'Accept', change: 'Change', dismiss: 'Dismiss', apply: 'Apply', cancel: 'Cancel', title: 'Title', series: 'Series', projectType: 'Project type', why: 'Why',
    userSet: 'A value you set yourself is never overwritten without Accept.', needTitle: 'Enter a title to apply.',
    noLooks: 'No looks yet.', accepted: 'accepted', changed: 'changed', dismissed_: 'dismissed', newSeries: 'This meeting only',
    highlights: 'Highlights', needsYou: 'Needs you', lastItems: 'Last items', source: 'Where this came from', files: 'Files', links: 'Links', changes: 'Changes',
    issueMom: 'Issue MoM', issueAnyway: 'Issue anyway', closeNoMom: 'Close without MoM', review: 'Review', nothingNeeds: 'Nothing needs you.', none: 'None', noItems: 'This meeting has no items yet.',
    lockedMeeting: 'Issued or closed. Highlights are read only.', closedMeeting: 'Closed without MoM',
    reasonReview: 'AI draft, review', reasonLow: 'Low confidence', reasonOverdue: 'Overdue',
    srcLine: (a, b) => `${a} of ${b} items have a source line in the transcript.`,
    needReview: (n) => `${n} item${n === 1 ? ' needs' : 's need'} review before the MoM can be issued.`,
    issuedOk: 'MoM issued', closedOk: 'Meeting closed without MoM', filedOk: 'Filed',
  },
  id: {
    open: 'terbuka', inboxZero: 'Inbox kosong', nextMeeting: 'Rapat berikutnya', nothingTo: 'Tidak ada yang menunggu Anda.',
    overdue: 'Lewat tenggat', week: 'Minggu ini', later: 'Nanti', nodate: 'Tanpa tanggal', doing: 'Dikerjakan', done: 'Selesai', archived: 'Diarsipkan',
    all: 'Semua', decisions: 'Keputusan', actions: 'Tindakan', questions: 'Pertanyaan', risks: 'Risiko',
    close: 'Tutup', reopen: 'Buka lagi', restore: 'Pulihkan', snooze: 'Tunda', tomorrow: 'Besok', nextWeek: 'Minggu depan', clearDue: 'Tanpa tanggal',
    archiveAll: 'Arsipkan semua', undo: 'Urungkan', noOwner: 'Tanpa pemilik', due: 'Tenggat', issued: 'Terbit', open_: 'Buka di register',
    noMatch: 'Tidak ada baris yang cocok.', retry: 'Coba lagi', errTitle: 'Gagal membaca atau menyimpan.', errBody: 'Catatan Anda tidak berubah. Coba lagi.',
    lockedRow: 'Rapat sudah terbit, hanya baca', needsOwner: (n) => `${n} butir terbuka tanpa pemilik.`,
    closed: 'Ditutup', reopened: 'Dibuka lagi', snoozed: 'Ditunda', archivedN: (n) => `${n} diarsipkan`,
    projects: 'Proyek', librarian: 'Pustakawan menyarankan', rules: 'aturan, tanpa model', pause: 'Jeda', resume: 'Lanjutkan', paused: 'Pustakawan dijeda. Tidak ada saran baru.',
    toConfirm: 'Perlu dikonfirmasi', filed: 'Terarsip', dismissed: 'Ditolak', unfiled: 'Belum diarsip', history: 'Riwayat tinjauan', nothingConfirm: 'Tidak ada yang perlu dikonfirmasi',
    accept: 'Terima', change: 'Ubah', dismiss: 'Tolak', apply: 'Terapkan', cancel: 'Batal', title: 'Judul', series: 'Seri', projectType: 'Tipe proyek', why: 'Alasan',
    userSet: 'Nilai yang Anda isi sendiri tidak pernah ditimpa tanpa Terima.', needTitle: 'Isi judul untuk menerapkan.',
    noLooks: 'Belum ada tinjauan.', accepted: 'diterima', changed: 'diubah', dismissed_: 'ditolak', newSeries: 'Hanya rapat ini',
    highlights: 'Sorotan', needsYou: 'Perlu Anda', lastItems: 'Butir terakhir', source: 'Asal catatan ini', files: 'Berkas', links: 'Tautan', changes: 'Perubahan',
    issueMom: 'Terbitkan MoM', issueAnyway: 'Terbitkan tetap', closeNoMom: 'Tutup tanpa MoM', review: 'Tinjau', nothingNeeds: 'Tidak ada yang perlu Anda.', none: 'Tidak ada', noItems: 'Rapat ini belum punya butir.',
    lockedMeeting: 'Terbit atau ditutup. Sorotan hanya baca.', closedMeeting: 'Ditutup tanpa MoM',
    reasonReview: 'Draf AI, tinjau', reasonLow: 'Keyakinan rendah', reasonOverdue: 'Lewat tenggat',
    srcLine: (a, b) => `${a} dari ${b} butir punya baris sumber di transkrip.`,
    needReview: (n) => `${n} butir perlu ditinjau sebelum MoM terbit.`,
    issuedOk: 'MoM terbit', closedOk: 'Rapat ditutup tanpa MoM', filedOk: 'Terarsip',
  },
};

const S = {
  types: new Set(), undo: null, error: null, snoozeFor: null,
  changing: null, changeDraft: {}, showArchived: false,
};
let ctx = null;
const t = (k, ...a) => { const v = (L[ctx.lang()] || L.en)[k] ?? L.en[k]; return typeof v === 'function' ? v(...a) : v; };

const tile = (type) => `<span class="th-tile" style="--c:${TYPE_COLOR[type] || 'var(--muted)'}" aria-hidden="true"></span>`;
const closedIds = () => new Set(read(K_CLOSED, []));
const isLocked = (m) => !!m.issuedAt || closedIds().has(m.id);
const mById = (id) => ctx.meetings().find((m) => m.id === id);

/* ---------- shared pieces ---------- */
const failing = () => S.error || (globalThis.__ysmThreadsFail ? 'hook' : null);
const errorBanner = () => `<div class="th-banner err" role="alert"><div><b>${esc(t('errTitle'))}</b> ${esc(t('errBody'))}</div><button type="button" class="btn sm" data-th="retry">${esc(t('retry'))}</button></div>`;
const undoBar = () => (S.undo ? `<div class="th-undo" role="status"><span>${esc(S.undo.label)}</span><button type="button" class="btn sm" data-th="undo">${esc(t('undo'))}</button></div>` : '');
const head = (title, sub, extra = '') => `<header class="th-head"><div><h2>${esc(title)}</h2><div class="th-sub">${sub}</div></div><div class="th-head-act">${extra}</div></header>`;

/* ---------- Inbox (T01) ---------- */
function inboxRow(r, kind) {
  const it = r.item;
  const m = r.meeting;
  const locked = isLocked(m);
  const text = pickText(it.text, ctx.lang());
  const tc = it.src?.tc ? ` · <span class="th-tc">${esc(it.src.tc)}</span>` : '';
  const due = it.due ? `${esc(t('due'))} ${esc(ctx.fmtDate(it.due, false))}` : esc(t('nodate'));
  const owner = it.owner ? esc(it.owner) : `<span class="th-none">${esc(t('noOwner'))}</span>`;
  const key = itemKey(m.id, it.ref);
  let acts = '';
  if (locked) acts = `<span class="th-lock">${esc(t('lockedRow'))}</span>`;
  else if (kind === 'done') acts = `<button type="button" class="btn sm" data-th="reopen">${esc(t('reopen'))}</button>`;
  else if (kind === 'archived') acts = `<button type="button" class="btn sm" data-th="restore">${esc(t('restore'))}</button>`;
  else {
    const menu = S.snoozeFor === key
      ? `<span class="th-snooze" role="group" aria-label="${esc(t('snooze'))}"><button type="button" class="btn sm" data-th="snooze" data-k="tomorrow">${esc(t('tomorrow'))}</button><button type="button" class="btn sm" data-th="snooze" data-k="week">${esc(t('nextWeek'))}</button><button type="button" class="btn sm" data-th="snooze" data-k="none">${esc(t('clearDue'))}</button></span>`
      : `<button type="button" class="btn sm" data-th="snoozemenu">${esc(t('snooze'))}</button>`;
    acts = `${menu}<button type="button" class="btn sm primary" data-th="close">${esc(t('close'))}</button>`;
  }
  return `<li class="th-row${kind === 'done' || kind === 'archived' ? ' is-done' : ''}" data-mid="${esc(m.id)}" data-ref="${esc(it.ref)}" data-k="${esc(key)}" tabindex="0">
    ${tile(it.type)}
    <div class="th-main">
      <div class="th-text">${esc(text)}</div>
      <div class="th-meta"><span class="th-ref">${esc(it.ref)}</span> · ${esc(m.title)} · ${esc(ctx.fmtDate(m.date, false))} · ${owner} · ${due}${tc}</div>
    </div>
    <div class="th-act">${acts}</div></li>`;
}

function inboxGroup(id, label, rows, kind, extra = '') {
  if (!rows.length && id !== 'done') return '';
  return `<section class="th-sec" data-sec="${id}"><h3>${esc(label)} <span class="th-n">${rows.length}</span>${extra}</h3><ul class="th-list">${rows.map((r) => inboxRow(r, kind)).join('')}</ul></section>`;
}

function renderInbox() {
  const meetings = ctx.meetings();
  const archived = new Set(read(K_ARCH, []));
  const g = groupInbox(meetings, { now: new Date(), types: S.types.size ? S.types : null, archived });
  const q = ctx.query().trim().toLowerCase();
  const keep = (r) => !q || [r.item.ref, pickText(r.item.text, ctx.lang()), r.item.owner, r.meeting.title].join(' ').toLowerCase().includes(q);
  const grp = (k) => g.groups[k].filter(keep);
  const arch = g.archived.filter(keep);

  const chips = [['all', 'all'], ['decision', 'decisions'], ['action', 'actions'], ['question', 'questions'], ['risk', 'risks']]
    .map(([ty, key]) => `<button type="button" class="chip" data-th="chip" data-type="${ty}" aria-pressed="${ty === 'all' ? S.types.size === 0 : S.types.has(ty)}">${esc(t(key))}</button>`).join('');

  const noOwner = g.groups.overdue.concat(g.groups.week, g.groups.later, g.groups.nodate, g.groups.doing).filter((r) => !r.item.owner).length;
  const archiveBtn = g.groups.done.length && !g.groups.done.every((r) => isLocked(r.meeting))
    ? `<button type="button" class="btn sm th-archive" data-th="archiveall">${esc(t('archiveAll'))}</button>` : '';

  let body;
  if (failing()) body = errorBanner();
  else if (g.open === 0 && !g.groups.done.length && !arch.length) {
    body = `<div class="th-zero" id="th-zero"><h3>${esc(t('inboxZero'))}</h3><p>${esc(t('nothingTo'))}</p>${g.next ? `<p class="th-next">${esc(t('nextMeeting'))}: <b>${esc(g.next.title)}</b> · ${esc(ctx.fmtDate(g.next.date, false))}</p>` : ''}</div>`;
  } else {
    const all = ['overdue', 'week', 'later', 'nodate', 'doing'].map((k) => grp(k));
    const shown = all.reduce((n, a) => n + a.length, 0) + grp('done').length + arch.length;
    body = `${noOwner ? `<div class="th-banner need" role="status">${esc(t('needsOwner', noOwner))}</div>` : ''}
      ${g.open === 0 ? `<div class="th-zero small"><b>${esc(t('inboxZero'))}</b> ${g.next ? `· ${esc(t('nextMeeting'))}: <b>${esc(g.next.title)}</b> · ${esc(ctx.fmtDate(g.next.date, false))}` : ''}</div>` : ''}
      ${inboxGroup('overdue', t('overdue'), all[0], 'open')}${inboxGroup('week', t('week'), all[1], 'open')}${inboxGroup('later', t('later'), all[2], 'open')}${inboxGroup('nodate', t('nodate'), all[3], 'open')}${inboxGroup('doing', t('doing'), all[4], 'open')}
      ${grp('done').length ? inboxGroup('done', t('done'), grp('done'), 'done', archiveBtn) : ''}
      ${arch.length ? `<section class="th-sec" data-sec="archived"><h3><button type="button" class="th-fold" data-th="fold" aria-expanded="${S.showArchived}">${esc(t('archived'))} <span class="th-n">${arch.length}</span></button></h3>${S.showArchived ? `<ul class="th-list">${arch.map((r) => inboxRow(r, 'archived')).join('')}</ul>` : ''}</section>` : ''}
      ${shown === 0 ? `<div class="th-zero small">${esc(t('noMatch'))}</div>` : ''}`;
  }
  const openLabel = `<span id="th-open-count">${g.open}</span> ${esc(t('open'))}`;
  return `<div class="th-board" id="th-inbox">${head('Inbox', openLabel, `<div class="th-chips">${chips}</div>`)}${body}${undoBar()}</div>`;
}

/* ---------- Projects (T02) ---------- */
function projectsData() {
  const meetings = ctx.meetings();
  const looks = read(K_LOOKS, []);
  const paused = !!read(K_PAUSED, false);
  const pending = pendingSuggestions(meetings, looks, { paused });
  const bySeries = new Map();
  for (const m of meetings) (bySeries.get(m.seriesId) || bySeries.set(m.seriesId, []).get(m.seriesId)).push(m);
  const unfiled = meetings.filter((m) => (m.projectType || 'general') === 'general' && bySeries.get(m.seriesId).length === 1);
  const filed = [...bySeries.values()].filter((a) => !(a.length === 1 && (a[0].projectType || 'general') === 'general'));
  return { meetings, looks, paused, pending, filed, unfiled };
}

function suggestionCard({ meeting: m, suggestion: s }) {
  const editing = S.changing === m.id;
  const d = S.changeDraft;
  const seriesOpts = ctx.meetings().filter((x) => x.id !== m.id)
    .reduce((acc, x) => (acc.some((a) => a.id === x.seriesId) ? acc : [...acc, { id: x.seriesId, label: x.title }]), [{ id: m.seriesId, label: t('newSeries') }]);
  const typeOpts = (cur) => PROJECT_TYPES.map((p) => `<option value="${p}"${p === cur ? ' selected' : ''}>${esc(p)}</option>`).join('');
  const form = editing ? (() => {
    const title = d.title ?? s.title;
    return `<div class="th-form">
      <label>${esc(t('title'))}<input type="text" data-th-f="title" value="${esc(title)}"></label>
      <label>${esc(t('series'))}<select data-th-f="seriesId">${seriesOpts.map((o) => `<option value="${esc(o.id)}"${o.id === (d.seriesId ?? s.seriesId) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
      <label>${esc(t('projectType'))}<select data-th-f="projectType">${typeOpts(d.projectType ?? s.projectType)}</select></label>
      ${title.trim() ? '' : `<div class="th-banner need" role="status">${esc(t('needTitle'))}</div>`}
      <div class="th-act"><button type="button" class="btn sm primary" data-th="applychange"${title.trim() ? '' : ' disabled'}>${esc(t('apply'))}</button><button type="button" class="btn sm" data-th="cancelchange">${esc(t('cancel'))}</button></div></div>`;
  })() : `<dl class="th-fields"><dt>${esc(t('title'))}</dt><dd>${esc(s.title)}</dd><dt>${esc(t('projectType'))}</dt><dd>${esc(m.projectType)} → <b>${esc(s.projectType)}</b></dd>${s.seriesId !== m.seriesId ? `<dt>${esc(t('series'))}</dt><dd>${esc(m.seriesId)} → <b>${esc(s.seriesId)}</b></dd>` : ''}</dl>
    <div class="th-act"><button type="button" class="btn sm primary" data-th="accept">${esc(t('accept'))}</button><button type="button" class="btn sm" data-th="change">${esc(t('change'))}</button><button type="button" class="btn sm" data-th="dismiss">${esc(t('dismiss'))}</button></div>`;
  return `<article class="th-card" data-mid="${esc(m.id)}"><div class="th-card-h"><b>${esc(t('librarian'))}</b><span class="th-faint">${esc(t('rules'))}</span></div>
    <div class="th-meetline">${esc(m.title)} · ${esc(ctx.fmtDate(m.date, false))}</div>${form}
    <p class="th-why"><b>${esc(t('why'))}:</b> ${esc(whyText(s, ctx.lang()))}</p><p class="th-faint">${esc(t('userSet'))}</p></article>`;
}

function renderProjects() {
  const d = projectsData();
  const mTitle = (id) => d.meetings.find((m) => m.id === id)?.title || id;
  const dismissed = d.looks.filter((l) => l.outcome === 'dismissed');
  const pauseBtn = `<button type="button" class="btn sm" data-th="pause" aria-pressed="${d.paused}">${esc(d.paused ? t('resume') : t('pause'))}</button>`;
  let body;
  if (failing()) body = errorBanner();
  else {
    body = `${d.paused ? `<div class="th-banner need" role="status">${esc(t('paused'))}</div>` : ''}
      <section class="th-sec" data-sec="confirm"><h3>${esc(t('toConfirm'))} <span class="th-n">${d.pending.length}</span></h3>
        ${d.pending.length ? d.pending.map(suggestionCard).join('') : `<div class="th-zero small" id="th-nothing"><b>${esc(t('nothingConfirm'))}</b></div>`}</section>
      <section class="th-sec" data-sec="filed"><h3>${esc(t('filed'))} <span class="th-n">${d.filed.length}</span></h3><ul class="th-list">
        ${d.filed.map((a) => `<li class="th-row"><div class="th-main"><div class="th-text">${esc(a[0].title)}</div><div class="th-meta">${esc(a[0].projectType)} · ${a.length} ${a.length === 1 ? 'meeting' : 'meetings'}${a.some((m) => m.issuedAt) ? ` · ${esc(t('issued'))}` : ''}</div></div></li>`).join('')}</ul></section>
      <section class="th-sec" data-sec="unfiled"><h3>${esc(t('unfiled'))} <span class="th-n">${d.unfiled.length}</span></h3><ul class="th-list">
        ${d.unfiled.map((m) => `<li class="th-row" data-mid="${esc(m.id)}"><div class="th-main"><div class="th-text">${esc(m.title)}</div><div class="th-meta">${esc(ctx.fmtDate(m.date, false))}</div></div></li>`).join('')}</ul></section>
      <section class="th-sec" data-sec="dismissed"><h3>${esc(t('dismissed'))} <span class="th-n">${dismissed.length}</span></h3><ul class="th-list">
        ${dismissed.map((l) => `<li class="th-row is-done"><div class="th-main"><div class="th-text">${esc(mTitle(l.meetingId))}</div><div class="th-meta">${esc(l.suggestion.why)}</div></div></li>`).join('')}</ul></section>
      <section class="th-sec" data-sec="history"><h3>${esc(t('history'))} <span class="th-n">${d.looks.length}</span></h3>
        ${d.looks.length ? `<ol class="th-looks" id="th-looks">${[...d.looks].reverse().slice(0, 20).map((l) => `<li><span class="th-out ${esc(l.outcome)}">${esc(t(l.outcome === 'dismissed' ? 'dismissed_' : l.outcome))}</span> ${esc(mTitle(l.meetingId))} · <span class="th-faint">${esc(l.suggestion.projectType)} · ${esc(String(l.at).slice(0, 10))}</span></li>`).join('')}</ol>` : `<p class="th-faint">${esc(t('noLooks'))}</p>`}</section>`;
  }
  return `<div class="th-board" id="th-projects">${head(t('projects'), `${d.pending.length} ${esc(t('toConfirm').toLowerCase())}`, pauseBtn)}${body}${undoBar()}</div>`;
}

/* ---------- Highlights (T04) ---------- */
function renderHighlights() {
  const m = ctx.activeMeeting();
  const lang = ctx.lang();
  const h = highlightsFor(m, { now: new Date() });
  const locked = isLocked(m);
  const byRef = new Map(m.items.map((i) => [i.ref, i]));
  const tiles = [['decision', 'decisions', h.counts.decisions], ['action', 'actions', h.counts.actions], ['question', 'questions', h.counts.questions], ['risk', 'risks', h.counts.risks]]
    .map(([ty, key, n]) => `<div class="th-count" style="--c:${TYPE_COLOR[ty]}"><b data-count="${ty}">${n}</b><span>${esc(t(key))}</span></div>`).join('');
  const reason = { review: 'reasonReview', low: 'reasonLow', overdue: 'reasonOverdue' };
  const needs = h.needsYou.map((n) => {
    const it = byRef.get(n.ref);
    const btn = locked ? '' : `<button type="button" class="btn sm" data-th="tick" data-ref="${esc(n.ref)}" data-reason="${n.reason}" aria-label="${esc(n.reason === 'overdue' ? t('close') : t('accept'))} ${esc(n.ref)}">${esc(n.reason === 'overdue' ? t('close') : t('accept'))}</button>`;
    return `<li class="th-row" data-ref="${esc(n.ref)}" data-mid="${esc(m.id)}">${tile(it.type)}<div class="th-main"><div class="th-text">${esc(pickText(it.text, lang))}</div><div class="th-meta"><span class="th-ref">${esc(n.ref)}</span> · ${esc(t(reason[n.reason]))}</div></div><div class="th-act">${btn}</div></li>`;
  }).join('');
  const last = h.last.map((it) => `<li class="th-row" data-ref="${esc(it.ref)}" data-mid="${esc(m.id)}" tabindex="0">${tile(it.type)}<div class="th-main"><div class="th-text">${esc(pickText(it.text, lang))}</div><div class="th-meta"><span class="th-ref">${esc(it.ref)}</span></div></div></li>`).join('');
  const list = (arr, fn) => (arr.length ? `<ul class="th-plain">${arr.map(fn).join('')}</ul>` : `<p class="th-faint">${esc(t('none'))}</p>`);
  // The register's own gate (AI draft or confidence below the line), not only what is listed above.
  const blocking = blockingItems(m).length;
  const acts = locked ? '' : `<button type="button" class="btn sm primary" data-th="issue">${esc(t('issueMom'))}</button><button type="button" class="btn sm" data-th="closemeeting">${esc(t('closeNoMom'))}</button>`;
  let body;
  if (failing()) body = errorBanner();
  else if (!m.items.length) body = `<div class="th-zero small" id="th-empty"><b>${esc(t('noItems'))}</b></div>`;
  else {
    body = `${locked ? `<div class="th-banner lock" role="status">${esc(closedIds().has(m.id) && !m.issuedAt ? t('closedMeeting') : t('lockedMeeting'))}</div>` : ''}
      ${!locked && blocking ? `<div class="th-banner need" role="status"><span>${esc(t('needReview', blocking))}</span><button type="button" class="btn sm" data-th="issueforce">${esc(t('issueAnyway'))}</button></div>` : ''}
      <div class="th-counts">${tiles}</div>
      <section class="th-sec" data-sec="needs"><h3>${esc(t('needsYou'))} <span class="th-n">${h.needsYou.length}</span></h3>${h.needsYou.length ? `<ul class="th-list">${needs}</ul>` : `<p class="th-faint">${esc(t('nothingNeeds'))}</p>`}</section>
      <section class="th-sec" data-sec="last"><h3>${esc(t('lastItems'))}</h3><ul class="th-list">${last}</ul></section>
      <section class="th-sec" data-sec="source"><h3>${esc(t('source'))}</h3><p>${esc(t('srcLine', h.source.withSource, h.source.total))}</p></section>
      <div class="th-three">
        <section class="th-sec" data-sec="files"><h3>${esc(t('files'))} <span class="th-n">${h.files.length}</span></h3>${list(h.files, (f) => `<li>${esc(f.name)}</li>`)}</section>
        <section class="th-sec" data-sec="links"><h3>${esc(t('links'))} <span class="th-n">${h.links.length}</span></h3>${list(h.links, (l) => `<li>${esc(l.url)}</li>`)}</section>
        <section class="th-sec" data-sec="changes"><h3>${esc(t('changes'))} <span class="th-n">${h.changes.length}</span></h3>${list(h.changes.slice(0, 6), (c) => `<li><span class="th-ref">${esc(c.ref)}</span> ${esc(c.field)}: ${esc(c.from ?? '-')} → ${esc(c.to ?? '-')}</li>`)}</section>
      </div>`;
  }
  return `<div class="th-board" id="th-highlights">${head(t('highlights'), esc(m.title), acts)}${body}${undoBar()}</div>`;
}

export function renderThreads(view) {
  if (view === 'inbox') return renderInbox();
  if (view === 'projects') return renderProjects();
  return renderHighlights();
}

/* ---------- actions ---------- */
async function run(fn, undo = null, label = '') {
  try {
    await fn();
    S.error = null;
    S.undo = undo ? { label, undo } : null;
  } catch (e) {
    if (e instanceof RegisterError) ctx.toast(e.message, true);
    else S.error = e?.message || 'error';
  }
  await ctx.reload();
  ctx.paint();
}

const by = () => ({ by: ctx.me() || 'local' });
const setStatus = (mid, ref, status) => setStatusAndSave(mById(mid), ref, status, by());

function rowOf(el) {
  const li = el.closest('[data-ref]');
  return li ? { mid: li.dataset.mid, ref: li.dataset.ref, key: li.dataset.k } : null;
}

async function onClick(e) {
  const b = e.target.closest('[data-th]');
  if (!b) {
    const row = e.target.closest('.th-row[data-ref]');
    if (row && row.dataset.mid) ctx.openRef(row.dataset.mid, row.dataset.ref);
    return;
  }
  const a = b.dataset.th;
  const r = rowOf(b);
  if (a === 'retry') { globalThis.__ysmThreadsFail = false; S.error = null; await ctx.reload(); return ctx.paint(); }
  if (a === 'undo') { const u = S.undo; S.undo = null; return run(u.undo); }
  if (a === 'chip') {
    const ty = b.dataset.type;
    if (ty === 'all') S.types.clear(); else if (S.types.has(ty)) S.types.delete(ty); else S.types.add(ty);
    return ctx.paint();
  }
  if (a === 'fold') { S.showArchived = !S.showArchived; return ctx.paint(); }
  if (a === 'snoozemenu') { S.snoozeFor = r.key; return ctx.paint(); }
  if (a === 'close') return run(() => setStatus(r.mid, r.ref, 'closed'), () => setStatus(r.mid, r.ref, 'open'), `${t('closed')} ${r.ref}`);
  if (a === 'reopen') return run(() => setStatus(r.mid, r.ref, 'open'), () => setStatus(r.mid, r.ref, 'closed'), `${t('reopened')} ${r.ref}`);
  if (a === 'snooze') {
    const it = mById(r.mid).items.find((i) => i.ref === r.ref);
    const prev = it.due;
    S.snoozeFor = null;
    const to = snoozeDue(b.dataset.k, new Date());
    return run(() => editItemAndSave(mById(r.mid), r.ref, { due: to }, by()), () => editItemAndSave(mById(r.mid), r.ref, { due: prev }, by()), `${t('snoozed')} ${r.ref}`);
  }
  if (a === 'restore' || a === 'archiveall') {
    const keys = read(K_ARCH, []);
    if (a === 'restore') {
      const was = keys.slice();
      write(K_ARCH, keys.filter((k) => k !== r.key));
      S.undo = { label: `${t('restore')} ${r.ref}`, undo: async () => write(K_ARCH, was) };
    } else {
      const g = groupInbox(ctx.meetings(), { now: new Date(), archived: new Set(keys) });
      const add = g.groups.done.filter((x) => !isLocked(x.meeting)).map((x) => itemKey(x.meeting.id, x.item.ref));
      write(K_ARCH, [...keys, ...add]);
      S.undo = { label: t('archivedN', add.length), undo: async () => write(K_ARCH, keys) };
    }
    return ctx.paint();
  }
  if (a === 'pause') { write(K_PAUSED, !read(K_PAUSED, false)); return ctx.paint(); }
  if (a === 'change') { S.changing = b.closest('[data-mid]').dataset.mid; S.changeDraft = {}; return ctx.paint(); }
  if (a === 'cancelchange') { S.changing = null; S.changeDraft = {}; return ctx.paint(); }
  if (a === 'accept' || a === 'applychange' || a === 'dismiss') return fileMeeting(b.closest('[data-mid]').dataset.mid, a);
  if (a === 'tick') {
    const m = mById(ctx.activeMeeting().id);
    const prev = m.items.find((i) => i.ref === b.dataset.ref).review;
    if (b.dataset.reason === 'overdue') return run(() => setStatus(m.id, b.dataset.ref, 'closed'), () => setStatus(m.id, b.dataset.ref, 'open'), `${t('closed')} ${b.dataset.ref}`);
    return run(() => acceptItemAndSave(m, b.dataset.ref, by()), () => editItemAndSave(m, b.dataset.ref, { review: prev }, by()), `${t('accept')} ${b.dataset.ref}`);
  }
  if (a === 'issue' || a === 'issueforce') {
    const m = ctx.activeMeeting();
    try { await issueMeetingAndSave(m, { ...by(), force: a === 'issueforce' }); ctx.toast(t('issuedOk')); S.error = null; } catch (err) {
      if (err instanceof RegisterError) ctx.toast(err.message, true); else S.error = err?.message || 'error';
    }
    await ctx.reload();
    return ctx.paint();
  }
  if (a === 'closemeeting') {
    const m = ctx.activeMeeting();
    const ids = read(K_CLOSED, []);
    write(K_CLOSED, [...ids, m.id]);
    S.undo = { label: t('closedOk'), undo: async () => write(K_CLOSED, ids) };
    return ctx.paint();
  }
  return undefined;
}

async function fileMeeting(mid, how) {
  const m = mById(mid);
  const looks = read(K_LOOKS, []);
  const s = suggestFiling(m, { meetings: ctx.meetings(), lines: m.transcript });
  const patch = how === 'applychange' ? { ...s, ...S.changeDraft, title: (S.changeDraft.title ?? s.title) } : s;
  const outcome = how === 'accept' ? 'accepted' : how === 'dismiss' ? 'dismissed' : 'changed';
  const at = new Date().toISOString();
  const sugg = how === 'dismiss' ? s : patch;
  await run(async () => {
    if (how !== 'dismiss') await saveMeeting(applySuggestion(m, patch, { meetings: ctx.meetings() }));
    write(K_LOOKS, recordLook(looks, { meetingId: mid, suggestion: sugg, outcome, at }));
  }, null);
  S.changing = null;
  S.changeDraft = {};
}

function onField(e) {
  const f = e.target.closest('[data-th-f]');
  if (!f) return;
  S.changeDraft[f.dataset.thF] = f.value;
  // Only the title gates Apply, so only it repaints; a select repaint would drop focus for nothing.
  if (f.dataset.thF === 'title') {
    const ok = f.value.trim() !== '';
    const btn = f.closest('.th-form').querySelector('[data-th="applychange"]');
    if (btn) btn.disabled = !ok;
    const hint = f.closest('.th-form').querySelector('.th-banner.need');
    if (hint) hint.hidden = ok;
  }
}

export function mountThreads(c) {
  ctx = c;
  const pane = c.pane();
  pane.addEventListener('click', onClick);
  pane.addEventListener('input', onField);
  pane.addEventListener('change', onField);
  pane.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.closest('button')) return;
    const row = e.target.closest('.th-row[data-ref]');
    if (row?.dataset.mid) ctx.openRef(row.dataset.mid, row.dataset.ref);
  });
}
