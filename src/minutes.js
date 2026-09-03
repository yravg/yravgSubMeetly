/**
 * Minutes Register — workspace tab penuh.
 *
 * Controller untuk src/minutes.html. Membaca/menulis lewat notes-store.js,
 * menegakkan aturan domain lewat notes-actions.js, dan tidak menaruh string
 * antarmuka langsung di markup — semua lewat makeT() dari notes-i18n.js.
 *
 * Full-tab workspace controller for src/minutes.html. Reads/writes through
 * notes-store.js, enforces domain rules through notes-actions.js, and never
 * hardcodes UI strings in markup — everything goes through makeT().
 */
import {
  ITEM_TYPES, pickText, meetingStats, itemAgeDays, toTimecode, TYPE_COLOR,
} from './lib/notes-schema.js';
import { makeT } from './lib/notes-i18n.js';
import {
  listMeetings, getMeeting, saveMeeting, searchItems,
} from './lib/notes-store.js';
import {
  acceptItemAndSave, editItemAndSave, addItemAndSave, removeItemAndSave,
  carryForwardAndSave, issueMeetingAndSave, createAmendment,
  startNextMeeting, carryCandidates, blockingItems, seriesSummary, metricSeries,
  RegisterError,
} from './lib/notes-actions.js';
import { seedSampleData } from './lib/notes-fixture.js';
import { serializeMeetingMarkdown, serializeMeetingCsv } from './lib/notes-export.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LS_LANG = 'ltsMinutesLang';
const LS_NAME = 'ltsMinutesMe';

/* ==========================================================================
   State
   ========================================================================== */
const state = {
  meetings: /** @type {any[]} */ ([]),
  activeId: /** @type {string|null} */ (null),
  view: 'table',
  q: '',
  types: new Set(),
  mine: false,
  dual: false,
  sort: { key: 'ref', dir: 1 },
  sel: /** @type {string|null} */ (null),
  adding: false,
  lang: localStorage.getItem(LS_LANG) || 'en',
  me: localStorage.getItem(LS_NAME) || '',
};

let T = makeT(state.lang);

function activeMeeting() {
  return state.meetings.find((m) => m.id === state.activeId) || null;
}
function replaceActive(meeting) {
  const i = state.meetings.findIndex((m) => m.id === meeting.id);
  if (i >= 0) state.meetings[i] = meeting;
  else state.meetings.unshift(meeting);
  state.activeId = meeting.id;
}
async function reloadAll(keepActive = true) {
  state.meetings = await listMeetings();
  if (!keepActive || !state.meetings.some((m) => m.id === state.activeId)) {
    state.activeId = state.meetings[0]?.id || null;
  }
}

/* ==========================================================================
   Small formatters — mirror test/notes-register.html, driven by real data
   ========================================================================== */
function daysTo(iso, today) {
  if (!iso) return null;
  return Math.round((new Date(`${iso}T00:00:00Z`) - today) / 86400000);
}
function todayUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function dueClass(it) {
  if (!it.due || it.status === 'closed') return '';
  const d = daysTo(it.due, todayUTC());
  if (d < 0) return 'over';
  if (d <= 3) return 'soon';
  return '';
}
function relLabel(it) {
  if (!it.due || it.status === 'closed') return '';
  const d = daysTo(it.due, todayUTC());
  if (d === 0) return T('today');
  if (d < 0) return `${Math.abs(d)}${T('days')} ${T('overdue')}`;
  return `${T('dueIn')} ${d}${T('days')}`;
}
function initials(n) {
  return String(n || '').split(/[\s/]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}
function ownerColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 45%)`;
}
function confColor(c) {
  return c >= 0.9 ? 'var(--accent)' : c >= LOW_CONF ? 'var(--warn-text)' : 'var(--danger)';
}
const LOW_CONF = 0.7;

function itemText(it) {
  return pickText(it.text, state.lang);
}
function itemAltText(it) {
  const other = state.lang === 'en' ? 'id' : 'en';
  return it.text?.[other] || '';
}

/* ==========================================================================
   Filtering / sorting (scoped to the active meeting's register)
   ========================================================================== */
function filteredItems() {
  const m = activeMeeting();
  if (!m) return [];
  const q = state.q.trim().toLowerCase();
  return m.items.filter((it) => {
    if (state.types.size && !state.types.has(it.type)) return false;
    if (state.mine && state.me && it.owner !== state.me) return false;
    if (q) {
      const hay = [it.ref, itemText(it), itemAltText(it), it.owner, it.src?.speaker, it.src?.tr, it.src?.orig]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function sortedItems(rows) {
  const { key, dir } = state.sort;
  const val = (it) => {
    if (key === 'due') return it.due || '9999-99-99';
    if (key === 'type') return it.type;
    if (key === 'owner') return it.owner || 'zzz';
    if (key === 'status') return it.status;
    if (key === 'topic') return it.topic;
    return it.ref;
  };
  return [...rows].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
}

/* ==========================================================================
   Cell renderers
   ========================================================================== */
function cellType(it) {
  return `<span class="type" data-type="${it.type}"><i></i>${esc(T(it.type))}</span>`;
}
function cellOwner(it) {
  if (!it.owner) return `<span class="owner"><span class="nm" style="color:var(--muted2)">${esc(T('noOwner'))}</span></span>`;
  return `<span class="owner">
    <span class="av" style="background:${ownerColor(it.owner)}">${esc(initials(it.owner))}</span>
    <span style="min-width:0"><span class="nm">${esc(it.owner)}</span>
    ${it.org ? `<span class="org">${esc(it.org)}</span>` : ''}</span></span>`;
}
function cellDue(it) {
  if (!it.due) return `<span class="due" style="color:var(--muted2)">${esc(T('noDue'))}</span>`;
  return `<span class="due ${dueClass(it)}">${esc(it.due.slice(5))}<span class="rel">${esc(relLabel(it))}</span></span>`;
}
function cellStatus(it) {
  return `<span class="status" data-s="${it.status}"><span class="sd"></span>${esc(T(it.status))}</span>`;
}
function cellSrc(it) {
  if (!it.src) return `<span class="src" style="color:var(--muted2)">${esc(T('noSource'))}</span>`;
  return `<span class="src" data-play="${esc(it.src.tc)}"><span class="play">▶</span>${esc(it.src.tc)}
    <span class="conf" title="ASR ${Math.round(it.confidence * 100)}%"><i style="width:${it.confidence * 100}%;background:${confColor(it.confidence)}"></i></span>
    </span><span class="rev" data-r="${it.review}">${esc(T(it.review))}</span>`;
}
function cellItem(it) {
  const alt = state.dual && itemAltText(it) ? `<span class="alt">${esc(itemAltText(it))}</span>` : '';
  return `<span class="itemtext">${it.agenda ? `<span class="agenda">${esc(it.agenda)}</span>` : ''}${esc(itemText(it))}${it.type === 'metric' && it.metric ? metricLine(it) : ''}${alt}</span>`;
}
function metricLine(it) {
  const mt = it.metric;
  const sign = mt.variance == null ? '' : mt.variance >= 0 ? '+' : '';
  return `<span class="metricline">${esc(mt.value)}${esc(mt.unit)}${mt.baseline != null ? ` <span class="muted">(baseline ${esc(mt.baseline)}${esc(mt.unit)}, ${sign}${esc(mt.variance)}${esc(mt.unit)})</span>` : ''}</span>`;
}

/* ==========================================================================
   Views
   ========================================================================== */
function viewTable(rows) {
  if (!rows.length) return `<p class="empty">${esc(T('msgEmpty'))}</p>`;
  const th = (k, cls, label) => {
    const active = state.sort.key === k;
    return `<th class="${cls}" data-sort="${k}">${esc(label)}${active ? `<span class="sort">${state.sort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
  };
  return `<table>
    <thead><tr>
      ${th('ref', 'c-ref', T('cRef'))}
      ${th('type', 'c-type', T('cType'))}
      ${th('topic', 'c-topic', T('cTopic'))}
      <th class="c-item">${esc(T('cItem'))}</th>
      ${th('owner', 'c-owner', T('cOwner'))}
      ${th('due', 'c-due', T('cDue'))}
      ${th('status', 'c-status', T('cStatus'))}
      <th class="c-src">${esc(T('cSource'))}</th>
    </tr></thead>
    <tbody>${rows.map((it) => `
      <tr data-ref="${esc(it.ref)}" aria-selected="${state.sel === it.ref}">
        <td class="c-ref"><span class="ref ${it.carriedFrom ? 'carry' : ''}">${esc(it.ref)}</span></td>
        <td class="c-type">${cellType(it)}</td>
        <td class="c-topic"><span class="topic">${esc(it.topic)}</span></td>
        <td class="c-item">${cellItem(it)}</td>
        <td class="c-owner">${cellOwner(it)}</td>
        <td class="c-due">${cellDue(it)}</td>
        <td class="c-status">${cellStatus(it)}</td>
        <td class="c-src">${cellSrc(it)}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

function viewTopic(rows) {
  const keys = [...new Set(rows.map((r) => r.topic))].sort();
  if (!keys.length) return `<p class="empty">${esc(T('msgEmpty'))}</p>`;
  return `<div class="grp">${keys.map((k) => {
    const rs = rows.filter((r) => r.topic === k);
    const openN = rs.filter((r) => r.status !== 'closed').length;
    return `<h2>${esc(k)}<span class="cnt">${rs.length}</span>
      <span class="cov" style="color:${openN ? 'var(--warn-text)' : 'var(--accent)'}">${openN} ${esc(T('open')).toLowerCase()}</span></h2>
      ${rs.map((it) => `
        <div class="gcard" data-ref="${esc(it.ref)}">
          <div>${cellType(it)}<div class="ref ${it.carriedFrom ? 'carry' : ''}" style="margin-top:4px">${esc(it.ref)}</div></div>
          <div>${cellItem(it)}<div style="margin-top:6px">${cellOwner(it)}</div></div>
          <div class="gmeta">${cellStatus(it)}${cellDue(it)}</div>
        </div>`).join('')}`;
  }).join('')}</div>`;
}

function viewDoc(rows) {
  const m = activeMeeting();
  const stats = meetingStats(m, todayUTC());
  const sec = (title, type) => {
    const rs = rows.filter((r) => r.type === type);
    if (!rs.length) return '';
    return `<h2>${esc(title)}</h2><ul>${rs.map((it) => `
      <li data-type="${it.type}" data-ref="${esc(it.ref)}">
        <i></i>
        <span>${esc(itemText(it))}
          ${it.owner || it.due ? `<span class="tail"> — ${esc(it.owner || T('noOwner'))}${it.due ? ` · ${esc(it.due)}` : ''}</span>` : ''}
        </span>
      </li>`).join('')}</ul>`;
  };
  const summary = state.lang === 'id'
    ? `${stats.decisions} keputusan, ${stats.actionsOpen}/${stats.actionsTotal} tindak lanjut masih terbuka, ${stats.questionsOpen} pertanyaan terbuka, dan ${stats.carried} butir bawaan dari rapat sebelumnya. Agenda terbahas ${stats.agendaPct}% (${stats.agendaCovered}/${stats.agendaTotal}).`
    : `${stats.decisions} decisions, ${stats.actionsOpen}/${stats.actionsTotal} actions still open, ${stats.questionsOpen} open questions, and ${stats.carried} items carried from the previous meeting. Agenda covered ${stats.agendaPct}% (${stats.agendaCovered}/${stats.agendaTotal}).`;
  return `<div class="doc">
    <h2>${esc(T('docSummary'))}</h2>
    <p>${esc(summary)}</p>
    ${sec(T('docDecisions'), 'decision')}
    ${sec(T('docActions'), 'action')}
    ${sec(T('docQuestions'), 'question')}
    ${sec(T('docRisks'), 'risk')}
    ${sec(T('docMetrics'), 'metric')}
    ${sec(T('docNotes'), 'info')}
    <div class="sig">
      <span>${esc(T('preparedBy'))}: Local TransSub · ${esc(T('onDevice'))} · ${esc(m.generatedAt.slice(0, 16).replace('T', ' '))}</span>
      ${m.issuedAt ? `<span>${esc(T('issued'))}: ${esc(m.issuedAt.slice(0, 16).replace('T', ' '))}</span>` : ''}
    </div>
  </div>`;
}

function viewCarry() {
  const m = activeMeeting();
  const carriedIn = m.items.filter((i) => i.carriedFrom);
  const eligible = carryCandidates(m);
  const today = todayUTC();
  const row = (it, actions) => {
    const age = itemAgeDays(it, today) ?? 0;
    return `<div class="cfrow ${age > 14 ? 'hot' : ''}" data-ref="${esc(it.ref)}">
      <span class="rail"></span>
      <div class="cfmain">
        <div class="t">${cellType(it)} ${esc(itemText(it))}</div>
        <div class="m">${esc(it.ref)}${it.carriedFrom ? ` · ${esc(it.carriedFrom)}` : ''} · ${esc(T('openFor'))} ${age}${esc(T('days'))} · ${esc(it.owner || T('noOwner'))}</div>
      </div>
      <div class="cfact">${actions}</div>
    </div>`;
  };
  return `<div class="pad">
    <p class="intro">${esc(T('carryIntro'))}</p>
    <h2 style="margin:14px 0 8px">${esc(T('vCarry'))} — ${esc(m.title)}</h2>
    <div class="cfrow" style="border-style:dashed">
      <div class="cfmain"><div class="t">${esc(T('startNext'))}</div></div>
      <div class="cfact"><button class="btn primary" id="btn-start-next">↳ ${esc(T('startNext'))}</button></div>
    </div>
    ${carriedIn.length
      ? carriedIn.map((it) => row(it, `<button class="btn" data-close="${esc(it.ref)}">✓ ${esc(T('close'))}</button>`)).join('')
      : `<p class="empty">${esc(T('noneYet'))}</p>`}
    <h2 style="margin:18px 0 8px">${esc(T('vCarry'))} → ${esc(T('next'))}</h2>
    ${eligible.length
      ? eligible.map((it) => row(it, `<span class="muted" style="font-size:11.5px">${esc(T('carryIn'))}</span>`)).join('')
      : `<p class="empty">${esc(T('noneYet'))}</p>`}
  </div>`;
}

function viewSeries() {
  const m = activeMeeting();
  const series = state.meetings.filter((x) => x.seriesId === m.seriesId).sort((a, b) => a.seq - b.seq);
  const summary = seriesSummary(series, todayUTC());
  const points = metricSeries(series, 'cumulative_progress');
  const cards = [
    { n: summary.meetings, l: T('meetings') },
    { n: summary.open, l: T('sItems') },
    { n: summary.meanAge ?? '—', l: T('sMeanAge') },
    { n: summary.oldest ?? '—', l: T('sOldest') },
  ];
  const orgRows = Object.entries(summary.byOrg).sort((a, b) => b[1] - a[1]);
  return `<div class="pad">
    <div class="cards">${cards.map((c) => `<div class="mini"><span class="n">${esc(c.n)}</span><span class="l">${esc(c.l)}</span></div>`).join('')}</div>
    ${points.length ? `<h2 style="margin:16px 0 8px">${esc(T('sVariance'))}</h2>
      <div class="orgbar">${points.map((p) => `<div class="cfrow"><div class="cfmain"><div class="t">${esc(p.seq)} — ${esc(p.value)}${esc(p.unit)} <span class="muted">(${p.variance >= 0 ? '+' : ''}${esc(p.variance)}${esc(p.unit)} vs baseline, as of ${esc(p.asOf)})</span></div></div></div>`).join('')}</div>` : ''}
    <h2 style="margin:16px 0 8px">${esc(T('distribution'))}</h2>
    ${orgRows.length ? orgRows.map(([org, n]) => `<div class="cfrow"><div class="cfmain"><div class="t">${esc(org)}</div></div><div class="cfact"><span class="muted">${n}</span></div></div>`).join('') : `<p class="empty">${esc(T('noneYet'))}</p>`}
  </div>`;
}

/* ==========================================================================
   Header / strip / chips
   ========================================================================== */
function paintHeader() {
  const m = activeMeeting();
  if (!m) return;
  const stats = meetingStats(m, todayUTC());
  $('#m-title').textContent = m.title;
  $('#m-date').textContent = m.date;
  $('#m-time').textContent = [m.start, m.end].filter(Boolean).join('–') + (m.tz ? ` ${m.tz}` : '');
  $('#m-chair').textContent = m.chair || '—';
  $('#m-mom').textContent = m.id;
  $('#prov-line').textContent = m.engine
    ? T('pipeline', m.engine.asr, m.engine.segments, m.items.length)
    : T('noSource');
  $('#prov-unreviewed').textContent = String(stats.unreviewed);
  $('#btn-issue').classList.toggle('hidden', !!m.issuedAt);
  $('#btn-issue').innerHTML = `✓ <span>${esc(T('issue'))}</span>`;
  $('#issued-badge').classList.toggle('hidden', !m.issuedAt);
  $('#issued-badge').textContent = m.issuedAt ? `${T('issued')} — ${m.issuedAt.slice(0, 10)}` : '';
  $('#btn-amend').classList.toggle('hidden', !m.issuedAt);

  const cells = [
    { n: stats.total, l: T('sItems') },
    { n: `${stats.actionsOpen}/${stats.actionsTotal}`, l: T('sActions') },
    { n: stats.overdue, l: T('sOverdue'), cls: stats.overdue ? 'is-alert' : 'is-ok' },
    { n: stats.decisions, l: T('sDecisions') },
    { n: stats.questionsOpen, l: T('sQuestions') },
    { n: stats.unreviewed, l: T('sUnreviewed'), cls: stats.unreviewed ? 'is-warn' : 'is-ok' },
    { n: `${stats.agendaPct}%`, l: T('sCoverage'), bar: stats.agendaPct },
  ];
  $('#strip').innerHTML = cells.map((c) => `
    <div class="stat ${c.cls || ''}">
      <span class="n">${esc(c.n)}</span>
      <span class="l">${esc(c.l)}</span>
      ${c.bar != null ? `<span class="bar"><i style="width:${c.bar}%"></i></span>` : ''}
    </div>`).join('');
}

function paintChips() {
  const m = activeMeeting();
  $('#chips').innerHTML = ITEM_TYPES.map((t) => {
    const n = m ? m.items.filter((i) => i.type === t).length : 0;
    const on = state.types.has(t);
    return `<button class="chip" data-type="${t}" aria-pressed="${on}" style="--dot:${TYPE_COLOR[t]}">
      <span class="dot"></span>${esc(T(t))}<span class="ct">${n}</span></button>`;
  }).join('');
}

function paintSwitcher() {
  const sel = $('#m-switch');
  sel.innerHTML = state.meetings.map((m) => `<option value="${esc(m.id)}" ${m.id === state.activeId ? 'selected' : ''}>${esc(m.date)} — ${esc(m.title)}${m.issuedAt ? ' ✓' : ''}</option>`).join('');
}

/* ==========================================================================
   Drawer
   ========================================================================== */
function activeItem() {
  const m = activeMeeting();
  return m ? m.items.find((i) => i.ref === state.sel) : null;
}

function paintDrawer() {
  const dr = $('#drawer');
  const m = activeMeeting();
  if (state.adding) return paintDrawerAdd();
  const it = m ? activeItem() : null;
  if (!it) { dr.hidden = true; return; }
  dr.hidden = false;
  const locked = !!m.issuedAt;
  $('#d-id').innerHTML = `${esc(it.ref)}${it.carriedFrom ? ` <span style="color:var(--warn-text)">↩ ${esc(it.carriedFrom)}</span>` : ''}`;
  $('#d-type').innerHTML = cellType(it);

  const prov = it.src ? `
    <div class="fld">
      <label>${esc(T('dProvenance'))}</label>
      <div class="quote">
        <div class="qh">
          <span class="tc" data-play="${esc(it.src.tc)}">▶ ${esc(it.src.tc)}</span>
          ${it.src.speaker ? `<span>·</span><span>${esc(it.src.speaker)}</span>` : ''}
          ${it.src.meetingId && it.src.meetingId !== m.id ? `<span>·</span><span class="mono">${esc(it.src.meetingId)}</span>` : ''}
          <span style="margin-left:auto" class="mono">ASR ${Math.round(it.confidence * 100)}%</span>
        </div>
        ${it.src.orig ? `<div class="qt orig"><span class="lbl">${esc(T('asSpoken'))}</span>${esc(it.src.orig)}</div>` : ''}
        ${it.src.tr ? `<div class="qt"><span class="lbl">${esc(T('machineTranslation'))}</span>${esc(it.src.tr)}</div>` : ''}
      </div>
    </div>` : `<p class="empty" style="padding:0">${esc(T('noSource'))}</p>`;

  $('#d-body').innerHTML = `
    <div class="fld">
      <label>${esc(T('dText'))} (${state.lang.toUpperCase()})</label>
      <textarea rows="4" id="f-text" ${locked ? 'disabled' : ''}>${esc(itemText(it))}</textarea>
    </div>
    <div class="two">
      <div class="fld"><label>${esc(T('dOwner'))}</label>
        <input id="f-owner" list="dl-owners" value="${esc(it.owner || '')}" ${locked ? 'disabled' : ''} /></div>
      <div class="fld"><label>${esc(T('dDue'))}</label>
        <input type="date" id="f-due" value="${esc(it.due || '')}" ${locked ? 'disabled' : ''} /></div>
    </div>
    <div class="two">
      <div class="fld"><label>${esc(T('dStatus'))}</label>
        <select id="f-status" ${locked ? 'disabled' : ''}>
          ${['open', 'progress', 'closed', 'carried'].map((s) => `<option value="${s}" ${s === it.status ? 'selected' : ''}>${esc(T(s))}</option>`).join('')}
        </select></div>
      <div class="fld"><label>${esc(T('dTopic'))}</label>
        <input id="f-topic" list="dl-topics" value="${esc(it.topic)}" ${locked ? 'disabled' : ''} /></div>
    </div>
    ${prov}
    ${it.history?.length ? `<div class="fld"><label>${esc(T('dHistory'))}</label>
      <div class="hist">${it.history.slice().reverse().map((h) => `<div>${esc(h.field)}: ${esc(JSON.stringify(h.from))} → ${esc(JSON.stringify(h.to))} <span class="muted">(${esc(h.by)}, ${esc(h.at.slice(0, 16).replace('T', ' '))})</span></div>`).join('')}</div>
    </div>` : ''}
    <datalist id="dl-owners">${(m.attendees || []).map((a) => `<option value="${esc(a.name)}">`).join('')}</datalist>
    <datalist id="dl-topics">${[...new Set(m.items.map((i) => i.topic))].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
  `;

  $('#d-foot').innerHTML = locked
    ? `<span class="muted">${esc(T('msgIssuedFrozen'))}</span>`
    : `<button class="btn primary" id="d-save">✓ ${esc(T(it.review === 'ai' ? 'accept' : 'saveEdit'))}</button>
       <button class="btn" id="d-play">▶ ${esc(T('playFrom'))}</button>
       <span class="spacer"></span>
       <button class="btn" id="d-discard" style="color:var(--danger)">${esc(T('discard'))}</button>`;
}

function paintDrawerAdd() {
  const dr = $('#drawer');
  dr.hidden = false;
  $('#d-id').textContent = T('addItem');
  $('#d-type').innerHTML = '';
  $('#d-body').innerHTML = `
    <div class="fld"><label>${esc(T('cType'))}</label>
      <select id="f-type">${ITEM_TYPES.map((t) => `<option value="${t}">${esc(T(t))}</option>`).join('')}</select></div>
    <div class="fld"><label>${esc(T('dText'))}</label><textarea rows="3" id="f-text"></textarea></div>
    <div class="two">
      <div class="fld"><label>${esc(T('dOwner'))}</label><input id="f-owner" /></div>
      <div class="fld"><label>${esc(T('dDue'))}</label><input type="date" id="f-due" /></div>
    </div>
    <div class="fld"><label>${esc(T('dTopic'))}</label><input id="f-topic" value="general" /></div>
  `;
  $('#d-foot').innerHTML = `<button class="btn primary" id="d-save">＋ ${esc(T('addItem'))}</button><span class="spacer"></span><button class="btn" id="d-discard">${esc(T('discard'))}</button>`;
}

/* ==========================================================================
   Top-level paint
   ========================================================================== */
function paint() {
  document.documentElement.lang = state.lang;
  const m = activeMeeting();
  $('#empty-state').hidden = !!m;
  $('#workspace').hidden = !m;
  if (!m) return;

  paintHeader();
  paintChips();
  paintSwitcher();

  const rows = sortedItems(filteredItems());
  const pane = $('#pane');
  pane.innerHTML = state.view === 'table' ? viewTable(rows)
    : state.view === 'topic' ? viewTopic(rows)
    : state.view === 'doc' ? viewDoc(rows)
    : state.view === 'series' ? viewSeries()
    : viewCarry();

  $('#q').value = state.q;
  $('#showing').textContent = T('showing', rows.length, m.items.length);
  paintDrawer();
}

/* ==========================================================================
   Actions
   ========================================================================== */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

async function saveDrawer() {
  const m = activeMeeting();
  if (state.adding) {
    const type = $('#f-type').value;
    const text = $('#f-text').value.trim();
    if (!text) return;
    const meeting = await addItemAndSave(m, {
      type, topic: $('#f-topic').value.trim() || 'general',
      text: { [state.lang]: text },
      owner: $('#f-owner').value.trim() || null,
      due: $('#f-due').value || null,
    });
    replaceActive(meeting);
    state.adding = false;
    state.sel = null;
    toast(T('msgItemAdded'));
    paint();
    return;
  }
  const it = activeItem();
  if (!it) return;
  const patch = {
    text: { ...it.text, [state.lang]: $('#f-text').value },
    owner: $('#f-owner').value.trim() || null,
    due: $('#f-due').value || null,
    status: $('#f-status').value,
    topic: $('#f-topic').value.trim() || it.topic,
  };
  const changed = Object.keys(patch).some((k) => JSON.stringify(patch[k]) !== JSON.stringify(it[k]));
  let meeting;
  if (!changed && it.review === 'ai') {
    meeting = await acceptItemAndSave(m, it.ref);
  } else if (changed) {
    meeting = await editItemAndSave(m, it.ref, patch);
  } else {
    return;
  }
  replaceActive(meeting);
  toast(T('msgAccepted'));
  paint();
}

async function discardDrawer() {
  if (state.adding) { state.adding = false; paint(); return; }
  const it = activeItem();
  if (!it) return;
  if (!confirm(`${T('discard')}: ${it.ref}?`)) return;
  const meeting = await removeItemAndSave(activeMeeting(), it.ref);
  replaceActive(meeting);
  state.sel = null;
  paint();
}

async function doIssue(force = false) {
  const m = activeMeeting();
  try {
    const meeting = await issueMeetingAndSave(m, { force, by: state.me || 'local' });
    replaceActive(meeting);
    toast(T('msgIssued'));
    paint();
  } catch (e) {
    if (e instanceof RegisterError && e.code === 'unreviewed' && !force) {
      const blocked = blockingItems(m);
      if (confirm(T('msgBlocked', blocked.length))) await doIssue(true);
      return;
    }
    toast(e && e.message ? e.message : String(e));
  }
}

async function doAmend() {
  const m = activeMeeting();
  const amended = createAmendment(m, { by: state.me || 'local' });
  const saved = await saveMeeting(amended);
  await reloadAll(false);
  state.activeId = saved.id;
  toast(T('msgAmended', saved.id));
  paint();
}

async function doStartNext() {
  const m = activeMeeting();
  const nextDate = prompt(T('date'), addDaysISO(m.date, 7));
  if (!nextDate) return;
  const next = startNextMeeting(m, { date: nextDate });
  const saved = await saveMeeting(next);
  await reloadAll(false);
  state.activeId = saved.id;
  state.view = 'table';
  toast(T('msgCarried'));
  paint();
}
function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function doExport(format) {
  const m = activeMeeting();
  const safe = (m.id || 'meeting').replace(/[^\w.-]+/g, '_');
  if (format === 'json') downloadText(`${safe}.json`, JSON.stringify(m, null, 2));
  else if (format === 'csv') downloadText(`${safe}.csv`, serializeMeetingCsv(m, state.lang));
  else downloadText(`${safe}.md`, serializeMeetingMarkdown(m, state.lang, T));
}

/* ==========================================================================
   Events
   ========================================================================== */
function wireEvents() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    [...$('#tabs').children].forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    paint();
  });

  $('#chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const t = c.dataset.type;
    if (state.types.has(t)) state.types.delete(t); else state.types.add(t);
    paint();
  });

  $('#q').addEventListener('input', (e) => { state.q = e.target.value; paint(); });

  $('#btn-mine').addEventListener('click', (e) => {
    if (!state.me) {
      const name = prompt(T('mine'));
      if (!name) return;
      state.me = name;
      localStorage.setItem(LS_NAME, name);
    }
    state.mine = !state.mine;
    e.currentTarget.setAttribute('aria-pressed', String(state.mine));
    e.currentTarget.classList.toggle('on', state.mine);
    paint();
  });
  $('#btn-dual').addEventListener('click', (e) => {
    state.dual = !state.dual;
    e.currentTarget.setAttribute('aria-pressed', String(state.dual));
    e.currentTarget.classList.toggle('on', state.dual);
    paint();
  });

  $('.langsw').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (!b) return;
    state.lang = b.dataset.lang;
    localStorage.setItem(LS_LANG, state.lang);
    T = makeT(state.lang);
    [...b.parentNode.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    paintStaticStrings();
    paint();
  });

  $('#m-switch').addEventListener('change', (e) => {
    state.activeId = e.target.value;
    state.sel = null;
    state.adding = false;
    paint();
  });

  $('#pane').addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    if (play) { e.stopPropagation(); toast(`${T('msgSeeking')} ${play.dataset.play}`); return; }

    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      editItemAndSave(activeMeeting(), closeBtn.dataset.close, { status: 'closed' })
        .then((meeting) => { replaceActive(meeting); paint(); });
      return;
    }
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 };
      paint();
      return;
    }
    const startNext = e.target.closest('#btn-start-next');
    if (startNext) { doStartNext(); return; }

    const row = e.target.closest('[data-ref]');
    if (row) { state.adding = false; state.sel = row.dataset.ref; paint(); }
  });

  $('#d-close').addEventListener('click', () => { state.sel = null; state.adding = false; $('#drawer').hidden = true; paint(); });
  $('#drawer').addEventListener('click', (e) => {
    if (e.target.closest('#d-save')) { saveDrawer(); return; }
    if (e.target.closest('#d-discard')) { discardDrawer(); return; }
    if (e.target.closest('#d-play')) {
      const it = activeItem();
      if (it?.src) toast(`${T('msgSeeking')} ${it.src.tc}`);
    }
  });

  $('#btn-add-item').addEventListener('click', () => {
    state.sel = null;
    state.adding = true;
    paint();
  });

  $('#btn-issue').addEventListener('click', () => doIssue(false));
  $('#btn-amend').addEventListener('click', () => doAmend());

  $('#btn-export').addEventListener('click', (e) => {
    const menu = $('#export-menu');
    menu.hidden = !menu.hidden;
  });
  $('#export-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    doExport(b.dataset.export);
    $('#export-menu').hidden = true;
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-export') && !e.target.closest('#export-menu')) $('#export-menu').hidden = true;
  });

  $('#btn-load-sample').addEventListener('click', async () => {
    $('#btn-load-sample').disabled = true;
    await seedSampleData();
    await reloadAll(false);
    toast(T('msgMigrated', 2));
    paint();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (state.sel || state.adding)) { state.sel = null; state.adding = false; $('#drawer').hidden = true; paint(); }
    if (e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); }
  });
}

function paintStaticStrings() {
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = T(el.dataset.t); });
  $('#q').placeholder = T('search');
}

/* ==========================================================================
   Boot
   ========================================================================== */
async function boot() {
  document.querySelector(`.langsw button[data-lang="${state.lang}"]`)?.setAttribute('aria-pressed', 'true');
  document.querySelector(`.langsw button[data-lang="${state.lang === 'en' ? 'id' : 'en'}"]`)?.setAttribute('aria-pressed', 'false');
  wireEvents();
  paintStaticStrings();
  await reloadAll(false);
  paint();
}

boot();
