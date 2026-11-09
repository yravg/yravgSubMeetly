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
 *
 * Visual source of truth: the "Minutes Register" Claude Design canvas —
 * Main (register), Provenance (drawer), Progress (metric detail), Series
 * (standing register), MoM (issued document) and SidePanel artboards.
 */
import {
  ITEM_TYPES, LIKELIHOODS, pickText, meetingStats, itemAgeDays, TYPE_COLOR, LOW_CONFIDENCE,
} from './lib/notes-schema.js';
import { makeT } from './lib/notes-i18n.js';
import { listMeetings, saveMeeting, deleteMeeting, backendName } from './lib/notes-store.js';
import {
  acceptItemAndSave, editItemAndSave, addItemAndSave, removeItemAndSave,
  applyCorrectionAndSave, issueMeetingAndSave, createAmendment, setSummaryAndSave,
  startNextMeeting, carryCandidates, blockingItems, seriesSummary, metricSeries,
  seriesFlow, linkedItems, carryChain, RegisterError,
} from './lib/notes-actions.js';
import { seedSampleData, isDemoMeeting } from './lib/notes-fixture.js';
import { serializeMeetingMarkdown, serializeMeetingCsv } from './lib/notes-export.js';
import { slidingNumber, autoHeight, highlight } from './lib/motion.js';
import { mountExtras } from './minutes-extras.js';
import { startEngineSync, engineOrigin } from './lib/engine-sync.js';
import { mountDraftOptions } from './minutes-draft.js';
import { mountDock } from './minutes-dock.js';
import { mountThreads, renderThreads } from './minutes-threads.js';
import { migrateLegacyLocalKeys } from './lib/legacy-keys.js';

/** Lapisan tata letak: panel kiri/kanan/bawah, rel, dan dok tampilan. */
let dock = null;

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Kunci `lts` lama dipindah sebelum apa pun membacanya.
migrateLegacyLocalKeys();

// A04a "Modern" register: ?skin=tide adds the Tide colour layer. Classic (no parameter) is unchanged (TIDE-024).
if (new URLSearchParams(globalThis.location?.search || '').get('skin') === 'tide') {
  document.documentElement.dataset.reskin = 'tide';
  for (const href of ['theme-tide.css', 'minutes-tide.css']) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.append(l);
  }
}

const LS_LANG = 'ysmMinutesLang';
const LS_NAME = 'ysmMinutesMe';
const LS_GLOSSARY = 'ysmGlossary';

/* ==========================================================================
   State
   ========================================================================== */
const THREAD_VIEWS = new Set(['inbox', 'projects', 'highlights']);
const state = {
  meetings: /** @type {any[]} */ ([]),
  activeId: /** @type {string|null} */ (null),
  view: 'table',
  q: '',
  types: new Set(),
  mine: false,
  ownerFilter: '',
  dual: false,
  reviewOnly: false,
  seriesAll: false,
  sort: { key: 'ref', dir: 1 },
  group: 'none',
  ptFilter: 'all',
  // Bahasa tujuan popover terjemahan di dok: bawaan = lawan dari bahasa antarmuka.
  tgt: localStorage.getItem('ysmMinutesTgt') || ((localStorage.getItem(LS_LANG) || 'en') === 'en' ? 'id' : 'en'),
  sel: /** @type {string|null} */ (null),
  adding: false,
  // ?lang= from the side panel wins once, then the toggle is remembered.
  lang: (() => {
    const q = new URLSearchParams(globalThis.location?.search || '').get('lang');
    if (q === 'en' || q === 'id') { localStorage.setItem(LS_LANG, q); return q; }
    return localStorage.getItem(LS_LANG) || 'en';
  })(),
  me: localStorage.getItem(LS_NAME) || '',
  lastSaved: /** @type {Date|null} */ (null),
};

let T = makeT(state.lang);

function activeMeeting() {
  return state.meetings.find((m) => m.id === state.activeId) || null;
}
const ptKey = (t) => `pt_${String(t || 'general').replace(/-/g, '_')}`;
/** Rapat yang lolos filter tipe proyek — dipakai pengalih rapat, bukan tabel butir. */
function visibleMeetings() {
  return state.ptFilter === 'all' ? state.meetings : state.meetings.filter((m) => (m.projectType || 'general') === state.ptFilter);
}
function seriesOf(m) {
  return state.meetings.filter((x) => x.seriesId === m.seriesId).sort((a, b) => a.seq - b.seq);
}
function replaceActive(meeting) {
  const i = state.meetings.findIndex((m) => m.id === meeting.id);
  if (i >= 0) state.meetings[i] = meeting;
  else state.meetings.unshift(meeting);
  state.activeId = meeting.id;
  state.lastSaved = new Date();
}
// ?meeting=<id> (from the app shell's "Issue minutes"): open that meeting on first load.
let wantedMeeting = new URLSearchParams(globalThis.location?.search || '').get('meeting');
async function reloadAll(keepActive = true) {
  state.meetings = await listMeetings();
  if (wantedMeeting && state.meetings.some((m) => m.id === wantedMeeting)) state.activeId = wantedMeeting;
  wantedMeeting = null;
  if (!keepActive || !state.meetings.some((m) => m.id === state.activeId)) {
    state.activeId = state.meetings[0]?.id || null;
  }
}

/* ==========================================================================
   Small formatters — driven by real data
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
  return c >= 0.9 ? 'var(--accent)' : c >= LOW_CONFIDENCE ? 'var(--warn-text)' : 'var(--danger)';
}
function pct(c) {
  return Math.round((Number(c) || 0) * 100);
}
function isLow(it) {
  return it.confidence < LOW_CONFIDENCE;
}
function itemText(it) {
  return pickText(it.text, state.lang);
}
function itemAltText(it) {
  const other = state.lang === 'en' ? 'id' : 'en';
  return it.text?.[other] || '';
}
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
};
function fmtDate(iso, withYear = true) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const mon = (MONTHS[state.lang] || MONTHS.en)[Number(m[2]) - 1] || m[2];
  return `${m[3]} ${mon}${withYear ? ` ${m[1]}` : ''}`;
}
function fmtShortDate(iso) {
  return fmtDate(iso, false);
}
function fmtClock(d) {
  return d ? d.toTimeString().slice(0, 5) : '';
}
function weekLabel(m) {
  return `W${String(m.seq).padStart(2, '0')}`;
}
function segLabel(src) {
  const ids = src.segmentIds || [];
  if (!ids.length) return '';
  const n = (s) => String(s).replace(/^\D+/, '');
  return T('segRange', n(ids[0]), n(ids[ids.length - 1]));
}
function tcRange(src) {
  if (!src) return '';
  if (src.t1 != null && src.t1 > src.t0) return `${src.tc} – ${toTc(src.t1)}`;
  return src.tc;
}
function toTc(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function sign(n) {
  return n == null ? '' : n >= 0 ? '+' : '';
}
function fmtNum(n) {
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : '—';
}
/** Big counts (man-hours) need thousands separators; percentages must not get them. */
function fmtMeasure(n) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 1000) return fmtNum(n);
  return new Intl.NumberFormat(state.lang === 'id' ? 'id-ID' : 'en-US').format(Number(n.toFixed(2)));
}
/* --------------------------------------------------------------------------
   MP-01 — the three metric numbers count up instead of appearing whole.

   The odometer has to reproduce fmtMeasure() exactly, digit for digit, or the
   drawer would start disagreeing with every other place a figure is printed.
   That means: decimals taken from the formatted string (fmtNum trims trailing
   zeros, so 9.0 shows as "9" and 9.78 as "9.78"), grouping only above 1000,
   and the group separator following the locale fmtMeasure itself uses — while
   the decimal point stays "." in both languages, because fmtNum never went
   through Intl.
   -------------------------------------------------------------------------- */
function odoDecimals(n) {
  const dot = fmtNum(n).indexOf('.');
  return dot === -1 ? 0 : fmtNum(n).length - dot - 1;
}
/**
 * fmtMeasure only reaches for Intl above 1000, and id-ID swaps both separators
 * there ("35.000,5") while fmtNum below 1000 always prints a plain ".". The
 * odometer has to follow that same split or the drawer stops matching the
 * register behind it.
 */
function odoSeparators(value) {
  if (Math.abs(value) < 1000) return { groupSeparator: '', decimalSeparator: '.' };
  return state.lang === 'id'
    ? { groupSeparator: '.', decimalSeparator: ',' }
    : { groupSeparator: ',', decimalSeparator: '.' };
}
/** Placeholder the drawer renders; mountMetricOdometers turns it into digits. */
function odoSlot(value, signed = false) {
  if (!Number.isFinite(value)) return '—';
  return `<span class="mo-num" data-v="${value}" data-dec="${odoDecimals(value)}"${signed ? ' data-signed="1"' : ''}></span>`;
}

let metricOdometers = [];

function mountMetricOdometers(root) {
  for (const o of metricOdometers) o.destroy();
  metricOdometers = [];
  if (!root) return;
  for (const el of root.querySelectorAll('.mo-num')) {
    const value = Number(el.dataset.v);
    if (!Number.isFinite(value)) continue;
    const odo = slidingNumber(el, {
      decimals: Number(el.dataset.dec) || 0,
      signed: el.dataset.signed === '1',
      ...odoSeparators(value),
    });
    odo.to(value);
    metricOdometers.push(odo);
  }
}

/** Highlight the extractor's mis-hearing inside the item text (Main artboard). */
function textWithFlag(it) {
  const t = itemText(it);
  if (!it.correction) return esc(t);
  const idx = t.toLowerCase().indexOf(it.correction.from.toLowerCase());
  if (idx < 0) return esc(t);
  return `${esc(t.slice(0, idx))}<span class="flagword">${esc(t.slice(idx, idx + it.correction.from.length))}</span>${esc(t.slice(idx + it.correction.from.length))}`;
}
/** Highlight the corrected phrase inside the MT / spoken text (Provenance artboard). */
function textWithMark(text, phrase) {
  if (!text) return '';
  if (!phrase) return esc(text);
  const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx < 0) return esc(text);
  return `${esc(text.slice(0, idx))}<mark>${esc(text.slice(idx, idx + phrase.length))}</mark>${esc(text.slice(idx + phrase.length))}`;
}

/* ==========================================================================
   Filtering / sorting (scoped to the active meeting's register)
   ========================================================================== */
const itemMatches = (it, q) => [it.ref, itemText(it), itemAltText(it), it.owner, it.src?.speaker, it.src?.tr, it.src?.orig, it.topic]
  .join(' ').toLowerCase().includes(q);
function filteredItems() {
  const m = activeMeeting();
  if (!m) return [];
  const q = state.q.trim().toLowerCase();
  return m.items.filter((it) => {
    if (state.types.size && !state.types.has(it.type)) return false;
    if (state.mine && state.me && it.owner !== state.me) return false;
    if (state.ownerFilter && it.owner !== state.ownerFilter) return false;
    if (state.reviewOnly && !(it.review === 'ai' || isLow(it))) return false;
    return !q || itemMatches(it, q);
  });
}
/** Search reaches every meeting, not only the open one: matches elsewhere are listed under the table with a jump. */
const XS_MAX = 8;
function crossSearchHtml() {
  const q = state.q.trim().toLowerCase();
  if (!q) return '';
  const hits = [];
  for (const m of state.meetings) {
    if (m.id === state.activeId) continue;
    for (const it of m.items) if (itemMatches(it, q)) hits.push({ m, it });
  }
  if (!hits.length) return '';
  const rows = hits.slice(0, XS_MAX).map(({ m, it }) => `<button type="button" class="xs-row" data-xs-meeting="${esc(m.id)}" data-xs-ref="${esc(it.ref)}"><b>${esc(it.ref)}</b><span class="xs-text">${esc(itemText(it))}</span><span class="xs-mtg">${esc(m.title)} · ${esc(m.date || '')}</span></button>`).join('');
  const more = hits.length > XS_MAX ? `<p class="xs-more">+${hits.length - XS_MAX}</p>` : '';
  return `<section class="xs" aria-label="${esc(T('xsHead', hits.length))}"><h4>${esc(T('xsHead', hits.length))}</h4>${rows}${more}</section>`;
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
let visibleRefs = /** @type {string[]} */ ([]);

/* ==========================================================================
   Cell renderers
   ========================================================================== */
function cellType(it) {
  return `<span class="type" data-type="${it.type}"><i></i>${esc(T(it.type))}</span>`;
}
function cellRef(it) {
  return `<span class="ref">${esc(it.ref)}${it.carriedFrom ? ` <span class="carry" title="${esc(it.carriedFrom)}">↩</span>` : ''}</span>`;
}
function cellOwner(it) {
  if (!it.owner) return `<span class="owner none"><span class="nm">${esc(T('noOwner'))}</span></span>`;
  return `<span class="owner">
    <span class="av" style="background:${ownerColor(it.owner)}">${esc(initials(it.owner))}</span>
    <span style="min-width:0"><span class="nm">${esc(it.owner)}</span>
    ${it.org ? `<span class="org">${esc(it.org)}</span>` : ''}</span></span>`;
}
function cellDue(it) {
  if (it.type === 'metric' && it.metric?.asOf) {
    return `<span class="due">${esc(it.metric.asOf.slice(5))}<span class="rel">${esc(T('reported'))}</span></span>`;
  }
  if (!it.due) return `<span class="due none">—</span>`;
  return `<span class="due ${dueClass(it)}">${esc(it.due.slice(5))}<span class="rel">${esc(relLabel(it))}</span></span>`;
}
function cellStatus(it) {
  return `<span class="status" data-s="${it.status}"><span class="sd"></span>${esc(T(it.status))}</span>`;
}
function cellSrc(it) {
  if (!it.src) return `<span class="src none">${esc(T('noSource'))}</span>`;
  const low = isLow(it);
  // Satu penanda keyakinan per baris: bendera ⚑ ASR n% menggantikan batang dan persen.
  const conf = low
    ? `<span class="pill-warn src-flag" title="${esc(T('lowAsr'))}">${flagIcon(10)} ${esc(T('asr'))} ${pct(it.confidence)}%</span>`
    : `<span class="conf" title="${esc(T('asr'))} ${pct(it.confidence)}%"><i style="width:${pct(it.confidence)}%;background:${confColor(it.confidence)}"></i></span>`;
  return `<span class="src ${low ? 'lit' : ''}" data-play="${esc(it.src.tc)}">▶ ${esc(it.src.tc)}</span>
    ${conf}
    <span class="rev ${low ? 'low' : ''}" data-r="${it.review}">${esc(T(it.review))}</span>`;
}
function cellItem(it) {
  const alt = state.dual && itemAltText(it) ? `<span class="alt">${esc(itemAltText(it))}</span>` : '';
  return `<span class="itemtext">${it.agenda ? `<span class="agenda">${esc(it.agenda)}</span>` : ''}${textWithFlag(it)}${it.type === 'metric' && it.metric ? metricLine(it) : ''}${alt}</span>`;
}
function metricLine(it) {
  const mt = it.metric;
  const v = mt.variance;
  const m = activeMeeting();
  const pts = metricSeries(seriesOf(m), mt.measure).slice(-6);
  const max = Math.max(...pts.map((p) => Math.abs(p.value)), 1);
  const spark = pts.length > 1 ? `<span class="spark" aria-hidden="true">${pts.map((p) => `<i class="${p.variance == null ? '' : p.variance >= 0 ? 'lit' : 'neg'}" style="height:${Math.max(4, Math.round((Math.abs(p.value) / max) * 19))}px"></i>`).join('')}</span>` : '';
  return `<span class="metricline">
    <span class="big">${esc(fmtMeasure(mt.value))}${esc(mt.unit)}</span>
    ${mt.baseline != null ? `<span class="base">${esc(T('vsBaseline'))} <span class="mono">${esc(fmtMeasure(mt.baseline))}${esc(mt.unit)}</span></span>` : ''}
    ${v != null ? `<span class="var ${v >= 0 ? 'up' : 'down'}">${sign(v)}${esc(fmtMeasure(v))}${esc(mt.unit)} ${esc(T(v >= 0 ? 'ahead' : 'behind'))}</span>` : ''}
    ${spark}
    ${mt.asOf ? `<span class="note">${esc(fmtShortDate(mt.asOf))} ${esc(T('reported'))}${mt.sourceDoc ? ` · ${esc(mt.sourceDoc)}` : ''}</span>` : ''}
  </span>`;
}
function flagIcon(size = 12) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20V5.5"/><path d="M5 6h11l-2 3.2 2 3.3H5"/></svg>`;
}
function alertIcon(size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5"/><path d="M12 16.5h.01"/><circle cx="12" cy="12" r="8.5"/></svg>`;
}
function playIcon(size = 10) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5 19 12 7 19.5z"/></svg>`;
}
function checkIcon(size = 13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7"/></svg>`;
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
    <tbody>${groupRows(rows).map(({ label, count, items }) => `
      ${label == null ? '' : `<tr class="ghead"><td colspan="8">${esc(label)}<span class="cnt">${count}</span></td></tr>`}
      ${items.map((it) => `
      <tr data-ref="${esc(it.ref)}" aria-selected="${state.sel === it.ref}"${it.review === 'ai' || isLow(it) ? ' class="needs-review"' : ''}>
        <td class="c-ref">${cellRef(it)}</td>
        <td class="c-type">${cellType(it)}</td>
        <td class="c-topic"><span class="topic${!it.topic || it.topic === 'general' ? ' plain' : ''}">${esc(topicLabel(it.topic))}</span></td>
        <td class="c-item">${cellItem(it)}</td>
        <td class="c-owner">${cellOwner(it)}</td>
        <td class="c-due">${cellDue(it)}</td>
        <td class="c-status">${cellStatus(it)}</td>
        <td class="c-src">${cellSrc(it)}</td>
      </tr>`).join('')}`).join('')}</tbody>
  </table>`;
}
/**
 * Group the already-sorted rows into runs. Grouping never re-orders inside a
 * group — the column sort still decides that — it only inserts a header row
 * before each run, in the order the groups first appear.
 * @returns {Array<{label: string|null, count: number, items: object[]}>}
 */
function groupRows(rows) {
  if (state.group === 'none') return [{ label: null, count: rows.length, items: rows }];
  const key = (it) => {
    if (state.group === 'owner') return it.owner || T('noOwner');
    if (state.group === 'status') return T(it.status);
    return topicLabel(it.topic);
  };
  const out = [];
  const byLabel = new Map();
  for (const it of rows) {
    const label = key(it);
    if (!byLabel.has(label)) {
      const g = { label, count: 0, items: [] };
      byLabel.set(label, g);
      out.push(g);
    }
    const g = byLabel.get(label);
    g.items.push(it);
    g.count += 1;
  }
  return out;
}
function topicLabel(key) {
  const m = activeMeeting();
  const t = m?.topics?.[key];
  return t ? pickText(t, state.lang) : key;
}

function viewTopic(rows) {
  const keys = [...new Set(rows.map((r) => r.topic))].sort();
  if (!keys.length) return `<p class="empty">${esc(T('msgEmpty'))}</p>`;
  return `<div class="grp">${keys.map((k) => {
    const rs = rows.filter((r) => r.topic === k);
    const openN = rs.filter((r) => r.status !== 'closed').length;
    return `<h2>${esc(topicLabel(k))}<span class="cnt">${rs.length}</span>
      <span class="cov" style="color:${openN ? 'var(--warn-text)' : 'var(--accent)'}">${esc(T('nOpen', openN))}</span></h2>
      ${rs.map((it) => `
        <div class="gcard" data-ref="${esc(it.ref)}" aria-selected="${state.sel === it.ref}">
          <div>${cellType(it)}<div style="margin-top:4px">${cellRef(it)}</div></div>
          <div>${cellItem(it)}<div style="margin-top:6px">${cellOwner(it)}</div></div>
          <div class="gmeta">${cellStatus(it)}${cellDue(it)}</div>
        </div>`).join('')}`;
  }).join('')}</div>`;
}

/* ---- issued document (MoM artboard) ---- */
function viewDoc() {
  const m = activeMeeting();
  const today = todayUTC();
  const stats = meetingStats(m, today);
  const items = m.items;
  const byType = (t) => items.filter((i) => i.type === t);
  const mark = (it) => `${esc(it.ref)}${it.carriedFrom ? ' ↩' : ''}${it.review === 'ai' ? ' ‡' : ''}`;
  const carriedNote = (it) => (it.carriedFrom ? ` <span class="sub">${esc(T('docCarriedFrom', it.carriedFrom, itemAgeDays(it, today) ?? 0))}</span>` : '');
  const statusCell = (it) => {
    if (it.status === 'closed') return `<td class="green">${esc(T('closed'))}</td>`;
    if (dueClass(it) === 'over') return `<td class="red">${esc(T('overdue'))}</td>`;
    return `<td>${esc(T(it.status))}</td>`;
  };
  const dueCell = (it) => `<td class="mono ${dueClass(it) === 'over' ? 'red b' : ''}">${it.due ? esc(it.due.slice(5)) : '—'}</td>`;
  const ownerCell = (it) => `<td>${it.owner ? `${esc(it.owner)}${it.org ? `<br><span class="sub">${esc(it.org)}</span>` : ''}` : `<span class="red">${esc(T('noOwner'))}</span>`}</td>`;
  const progressPt = byType('metric').find((i) => i.metric?.measure === 'cumulative_progress');
  const series = seriesOf(m);
  const next = series.find((x) => x.seq > m.seq);
  const [project, seriesName] = splitTitle(m.title);
  const corrected = items.flatMap((it) => (it.history || [])
    .filter((h) => h.field === 'correction' && h.from && !h.to)
    .map((h) => ({ ref: it.ref, from: h.from.from, to: h.from.to, tc: it.src?.tc || '—', applied: it.review === 'edited' })))
    .filter((c) => c.applied);
  const aiN = stats.unreviewed;
  const dateLine = `${m.date}${m.start ? `, ${m.start}${m.end ? `–${m.end}` : ''}` : ''}${m.tz && m.tz !== 'local' ? ` ${m.tz}` : ''}`;
  const noteGroups = [...new Set(byType('info').map((i) => i.topic))];
  const infoByTopic = noteGroups.map((k, idx) => `<div class="note"><h3>7.${idx + 1} ${esc(topicLabel(k))}</h3>${byType('info').filter((i) => i.topic === k).map((i) => `<p>${esc(itemText(i))}</p>`).join('')}</div>`).join('');
  const generatedSummary = state.lang === 'id'
    ? `${stats.decisions} keputusan, ${stats.actionsOpen} dari ${stats.actionsTotal} tindak lanjut masih terbuka, ${stats.questionsOpen} pertanyaan terbuka, ${stats.carried} butir bawaan dari rapat sebelumnya. Agenda terbahas ${stats.agendaPct}% (${stats.agendaCovered}/${stats.agendaTotal}).${progressPt?.metric ? ` Progres aktual kumulatif ${fmtNum(progressPt.metric.value)}${progressPt.metric.unit}${progressPt.metric.variance != null ? `, ${sign(progressPt.metric.variance)}${fmtNum(progressPt.metric.variance)}${progressPt.metric.unit} terhadap baseline` : ''}.` : ''}`
    : `${stats.decisions} decision(s), ${stats.actionsOpen} of ${stats.actionsTotal} actions still open, ${stats.questionsOpen} open question(s), ${stats.carried} item(s) carried from the previous meeting. Agenda covered ${stats.agendaPct}% (${stats.agendaCovered}/${stats.agendaTotal}).${progressPt?.metric ? ` Cumulative actual progress ${fmtNum(progressPt.metric.value)}${progressPt.metric.unit}${progressPt.metric.variance != null ? `, ${sign(progressPt.metric.variance)}${fmtNum(progressPt.metric.variance)}${progressPt.metric.unit} against baseline` : ''}.` : ''}`;
  // A human-written summary replaces the generated statistics sentence.
  //
  // The editable box only ever holds what a human typed IN THIS LANGUAGE: it
  // starts empty (with a placeholder) rather than pre-filled, because a Save on
  // a pre-filled box would silently sign the machine's sentence as the
  // minute-taker's prose — or, since pickText falls back across languages,
  // write English into summary.id. The generated sentence still carries the
  // document, read-only, underneath.
  const authored = m.summary?.[state.lang] || '';
  const summaryBlock = m.issuedAt
    ? `<p>${esc(pickText(m.summary, state.lang) || generatedSummary)}</p>`
    : `<div class="sumedit">
        <p contenteditable="true" id="doc-summary" spellcheck="false"
           data-placeholder="${esc(T('summaryPlaceholder'))}">${esc(authored)}</p>
        <button type="button" class="btn xs" id="btn-save-summary">${esc(T('saveSummary'))}</button>
        ${authored ? '' : `<p class="genfallback"><span class="lead">${esc(T('summaryGenerated'))}</span> ${esc(generatedSummary)}</p>`}
      </div>`;
  const rev = /-A(\d+)$/.exec(m.id)?.[1] || '0';
  const chairOrg = m.attendees.find((a) => a.name === m.chair)?.org || '';
  const distribution = [...new Set(m.attendees.map((a) => a.org).filter(Boolean))].join(' · ');
  let n = 0;
  const sec = (title, body) => (body ? `<section><h2>${++n} · ${esc(title)}</h2>${body}</section>` : '');
  const table = (heads, rowsHtml) => (rowsHtml ? `<table><thead><tr>${heads.map(([h, w]) => `<th${w ? ` style="width:${w}"` : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>` : '');

  const decisions = table([[T('cRef'), '76px'], [T('docDecision')], [T('docAccountable'), '150px']],
    byType('decision').map((it) => `<tr data-ref="${esc(it.ref)}"><td class="mref">${mark(it)}</td><td>${esc(itemText(it))}</td>${ownerCell(it)}</tr>`).join(''));
  const actions = table([[T('cRef'), '76px'], [T('docAction')], [T('cOwner'), '118px'], [T('cDue'), '76px'], [T('cStatus'), '84px']],
    byType('action').map((it) => `<tr data-ref="${esc(it.ref)}"><td class="mref">${mark(it)}</td><td>${esc(itemText(it))}${carriedNote(it)}</td>${ownerCell(it)}${dueCell(it)}${statusCell(it)}</tr>`).join(''));
  // A question that keeps coming back is the finding, not the question — the
  // Series view already says so; the issued document has to say it too.
  const repeatNote = (it) => {
    const chain = carryChain(series, m, it);
    if (chain < 2) return '';
    return ` <b>${esc(it.owner ? T('docRaisedRepeatedlyOwned', chain) : T('docRaisedRepeatedly', chain))}</b>`;
  };
  const questions = table([[T('cRef'), '76px'], [T('docQuestion')], [T('docReferredTo'), '118px'], [T('docBy'), '76px']],
    byType('question').map((it) => `<tr data-ref="${esc(it.ref)}"><td class="mref">${mark(it)}</td><td>${esc(itemText(it))}${repeatNote(it)}${carriedNote(it)}</td>${ownerCell(it)}${dueCell(it)}</tr>`).join(''));
  const risks = table([[T('cRef'), '76px'], [T('docRisk')], [T('cOwner'), '118px'], [T('docSevLik'), '100px']],
    byType('risk').map((it) => `<tr data-ref="${esc(it.ref)}"><td class="mref">${mark(it)}</td><td>${esc(itemText(it))}${carriedNote(it)}</td>${ownerCell(it)}<td>${esc(sevLikLabel(it))}</td></tr>`).join(''));
  const metrics = byType('metric');
  const progress = metrics.length ? `<div class="kpi">${metrics.map((it) => {
    const mt = it.metric;
    if (!mt) return '';
    return `<div><small>${esc(itemText(it))}</small><b>${esc(fmtMeasure(mt.value))}${esc(mt.unit)}</b></div>
      ${mt.baseline != null ? `<div><small>${esc(T('mBaseline'))}</small><b class="base">${esc(fmtMeasure(mt.baseline))}${esc(mt.unit)}</b></div>` : ''}
      ${mt.variance != null ? `<div><small>${esc(T('mVariance'))}</small><b class="${mt.variance >= 0 ? 'up' : 'down'}">${sign(mt.variance)}${esc(fmtMeasure(mt.variance))}${esc(mt.unit)}</b></div>` : ''}`;
  }).join('')}</div>${metrics.map((it) => (it.src?.tr ? `<p>${esc(it.src.tr)}</p>` : '')).join('')}` : '';

  return `<div class="docwrap"><div class="paper">
    <div class="lh">
      <div class="org">
        <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="1.2" y="1.2" width="29.6" height="29.6" rx="5" stroke="#1c1c1a" stroke-width="2"/><path d="M8 21.5c2.6 0 2.6-3 5.2-3s2.6 3 5.2 3 2.6-3 5.2-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 12h14" stroke="#1c1c1a" stroke-width="2" stroke-linecap="round"/><path d="M9 16.5h8" stroke="#1c1c1a" stroke-width="2" stroke-linecap="round"/></svg>
        <div><b>${esc(chairOrg || project)}</b><small>${esc(project)}</small></div>
      </div>
      <div class="ttl">
        <b>${esc(T('momTitle'))}</b>
        <span>${esc(m.id)} · ${esc(T('rev'))} ${esc(rev)}${m.issuedAt ? ` · ${esc(T('issued'))} ${esc(m.issuedAt.slice(0, 10))}` : ''}</span>
        ${m.issuedAt ? '' : `<span class="draft">${esc(T('draftWatermark'))}</span>`}
      </div>
    </div>
    <div class="meta">
      <div><span>${esc(T('docProject'))}</span><span>${esc(project)}</span></div>
      <div><span>${esc(T('docMeeting'))}</span><span>${esc(seriesName || project)} — ${esc(T('docNo', m.seq))}</span></div>
      <div><span>${esc(T('date'))}</span><span class="mono">${esc(dateLine)}</span></div>
      <div><span>${esc(T('chair'))}</span><span>${esc(m.chair || '—')}</span></div>
      <div><span>${esc(T('present'))}</span><span>${m.attendees.length ? esc(m.attendees.map((a) => a.name).join(', ')) : '—'}</span></div>
      <div><span>${esc(T('next'))}</span><span class="mono">${next ? esc(meetingWhen(next)) : '—'}</span></div>
    </div>
    ${sec(T('docSummary'), summaryBlock)}
    ${sec(T('docDecisions'), decisions)}
    ${sec(T('docActions'), actions)}
    ${sec(T('docQuestions'), questions)}
    ${sec(T('docRisks'), risks)}
    ${sec(T('docMetrics'), progress)}
    ${sec(T('docNotes'), infoByTopic)}
    <div class="pfoot">
      <div class="row">
        <div class="txt">
          ${aiN ? `<b>‡</b> ${esc(T('docFootAi', aiN))}` : esc(T('docFootAllReviewed'))}
          ${corrected.map((c) => `<br>${esc(T('docFootCorrected', c.ref, c.from, c.to, c.tc))}`).join('')}
          ${m.engine ? `<br>${esc(T('docFootEngine', m.engine.asr, m.engine.segments))}` : ''}
          <br>${esc(T('docFootTrace'))}
        </div>
        <div class="sig">
          <small>${esc(T('minutedBy'))}</small>
          <div class="line"></div>
          <b>${esc(m.chair || state.me || '—')}</b>
          <span>${esc(chairOrg)}</span>
        </div>
      </div>
      <div class="dist">
        <span class="mono">${esc(m.id)} · ${esc(T('rev'))} ${esc(rev)}</span>
        ${distribution ? `<span>${esc(T('distribution'))}: ${esc(distribution)}</span>` : ''}
        <span>${esc(T('preparedBy'))}: yravgSubMeetly · ${esc(T('onDevice'))}</span>
      </div>
    </div>
  </div></div>`;
}
function cssEscape(v) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
}
function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}
/** Risk matrix read out loud: "High × Possible". */
function sevLikLabel(it) {
  return `${T(`pr${cap(it.priority)}`)} × ${T(`lk${cap(it.likelihood)}`)}`;
}
/** "2026-09-09, 10:00 GMT+8" — a date alone does not tell anyone when to dial in. */
function meetingWhen(m) {
  return `${m.date}${m.start ? `, ${m.start}` : ''}${m.tz && m.tz !== 'local' ? ` ${m.tz}` : ''}`;
}
function splitTitle(title) {
  const parts = String(title || '').split(/\s+[—–-]\s+/);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(' — ')];
  return [title, ''];
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
        <div class="m">${esc(it.ref)}${it.carriedFrom ? ` · ↩ ${esc(it.carriedFrom)}` : ''} · ${esc(T('openFor'))} ${age}${esc(T('days'))} · ${esc(it.owner || T('noOwner'))}</div>
      </div>
      <div class="cfact">${actions}</div>
    </div>`;
  };
  return `<div class="pad">
    <p class="intro">${esc(T('carryIntro'))}</p>
    <h2 style="margin:14px 0 8px">${esc(T('vCarry'))} — ${esc(weekLabel(m))}</h2>
    ${carriedIn.length
      ? carriedIn.map((it) => row(it, `<button class="btn" data-close="${esc(it.ref)}">${checkIcon(12)} ${esc(T('close'))}</button>`)).join('')
      : `<p class="empty">${esc(T('noneYet'))}</p>`}
    <h2 style="margin:18px 0 8px">${esc(T('vCarry'))} → ${esc(T('next'))}</h2>
    <div class="cfrow" style="border-style:dashed">
      <span class="rail" style="background:var(--accent)"></span>
      <div class="cfmain"><div class="t">${esc(T('startNext'))}</div><div class="m">${esc(T('nOpen', eligible.length))}</div></div>
      <div class="cfact"><button class="btn primary" id="btn-start-next">↳ ${esc(T('startW', m.seq + 1))}</button></div>
    </div>
    ${eligible.length
      ? eligible.map((it) => row(it, `<span class="muted" style="font-size:11.5px">${esc(T('carryIn'))}</span>`)).join('')
      : `<p class="empty">${esc(T('noneYet'))}</p>`}
  </div>`;
}

/* ---- series (Series artboard) ---- */
function cadenceLabel(series) {
  if (series.length < 2) return T('cadenceNA');
  const gaps = [];
  for (let i = 1; i < series.length; i++) gaps.push(daysTo(series[i].date, new Date(`${series[i - 1].date}T00:00:00Z`)));
  gaps.sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  if (med === 7) return T('cadenceWeekly');
  if (med === 14) return T('cadenceBiweekly');
  return T('cadenceDays', med);
}
function viewSeries() {
  const m = activeMeeting();
  const series = seriesOf(m);
  const today = todayUTC();
  const summary = seriesSummary(series, today);
  const flow = seriesFlow(series);
  const [project, seriesName] = splitTitle(m.title);
  const rows = summary.rows;
  const shown = state.seriesAll ? rows : rows.slice(0, 8);
  const maxAge = Math.max(...rows.map((r) => r.age ?? 0), 1);
  const maxOpen = Math.max(...flow.map((f) => f.open), 1);
  const maxFlow = Math.max(...flow.map((f) => Math.max(f.opened, f.closed)), 1);
  // Two labels, not one: the artboard names the tallest opened bar AND the
  // tallest closed bar, because the gap between them is the story.
  const maxOpened = Math.max(...flow.map((f) => f.opened), 0);
  const maxClosed = Math.max(...flow.map((f) => f.closed), 0);
  const upN = flow.filter((f) => f.opened > f.closed).length;
  const net = flow.reduce((a, f) => a + f.opened - f.closed, 0);
  const orgRows = Object.entries(summary.byOrg).sort((a, b) => b[1] - a[1]);
  const orgMax = Math.max(...orgRows.map((r) => r[1]), 1);
  const orgColor = ['var(--accent)', 'var(--t-decision)', 'var(--t-info)', 'var(--t-question)'];
  const repeat = rows.filter((r) => r.chain >= 2 && !r.item.owner).sort((a, b) => b.chain - a.chain)[0]
    || rows.filter((r) => r.chain >= 2).sort((a, b) => b.chain - a.chain)[0];

  const ageCell = (r) => {
    const age = r.age ?? 0;
    const hot = age > 14;
    return `<span class="age ${hot ? 'hot' : ''}">${age}${esc(T('days'))}</span><span class="agebar"><i class="${hot ? 'hot' : ''}" style="width:${Math.round((age / maxAge) * 100)}%"></i></span>`;
  };
  const dueCell = (it) => {
    if (!it.due) return `<span class="due none">—</span>`;
    return `<span class="due ${dueClass(it)}">${esc(it.due.slice(5))}${dueClass(it) === 'over' ? `<span class="rel">${esc(relLabel(it))}</span>` : ''}</span>`;
  };

  return `<div class="series">
    <div class="shead">
      <div class="top">
        <div style="flex:1;min-width:240px">
          <div class="lbl">${esc(T('seriesLabel'))}</div>
          <h1>${esc(project)}${seriesName ? ` — ${esc(seriesName)}` : ''}</h1>
          <div class="facts">
            <span><span class="k">${esc(T('meetings'))}</span> <span class="v mono">${series.length}</span></span>
            <span><span class="k">${esc(T('span'))}</span> <span class="v mono">${esc(series[0].date)} → ${esc(series[series.length - 1].date)}</span></span>
            <span><span class="k">${esc(T('cadence'))}</span> <span class="v">${esc(cadenceLabel(series))}${m.start ? `, ${esc(m.start)}${m.tz && m.tz !== 'local' ? ` ${esc(m.tz)}` : ''}` : ''}</span></span>
            <span><span class="k">${esc(T('chair'))}</span> <span class="v">${esc(m.chair || '—')}</span></span>
          </div>
        </div>
        <div class="acts">
          <button class="btn" id="btn-export-standing">${esc(T('exportStanding'))}</button>
          <button class="btn primary" id="btn-start-next">${esc(T('startW', series[series.length - 1].seq + 1))}</button>
        </div>
      </div>
      <div class="mstrip">${flow.map((f) => `
        <div class="mcard ${f.meetingId === m.id ? 'cur' : ''}" data-meeting="${esc(f.meetingId)}">
          <div class="d">${esc(fmtShortDate(f.date))}${f.meetingId === m.id ? ` · W${f.seq}` : ''}</div>
          <span class="t"><i style="width:${Math.round((f.open / maxOpen) * 100)}%"></i></span>
          <div class="o">${esc(T('nOpen', f.open))}</div>
        </div>`).join('')}</div>
    </div>
    <div class="sbody">
      <div class="smain">
        <div class="sttl">
          <b>${esc(T('standingRegister'))}</b>
          <span class="cnt">${esc(T('openAcross', summary.open, series.length))}</span>
          <span class="hint">${esc(T('sortedByAge'))}</span>
        </div>
        ${rows.length ? `<table>
          <thead><tr>
            <th class="c-ref">${esc(T('cRef'))}</th><th class="c-type" style="width:98px">${esc(T('cType'))}</th><th>${esc(T('cItem'))}</th>
            <th style="width:146px">${esc(T('cOwner'))}</th><th class="c-raised">${esc(T('cRaised'))}</th><th class="c-age">${esc(T('cAge'))}</th><th class="c-due">${esc(T('cDue'))}</th>
          </tr></thead>
          <tbody>${shown.map((r) => `
            <tr data-ref="${esc(r.item.ref)}" data-meeting="${esc(r.meeting.id)}">
              <td class="c-ref">${cellRef(r.item)}</td>
              <td class="c-type">${cellType(r.item)}</td>
              <td><span class="itemtext">${esc(pickText(r.item.text, state.lang))}${r.chain >= 2 && r.item.type === 'question' ? `<span class="pill-amber">${esc(T('consecutivePill', r.chain))}</span>` : ''}</span></td>
              <td>${r.item.owner ? `<span style="font-size:12px;color:var(--text2)">${esc(r.item.owner)}</span>${r.item.org ? `<span style="display:block;font-size:10px;color:var(--muted2)">${esc(r.item.org)}</span>` : ''}` : `<span class="muted2" style="font-size:12px">${esc(T('noOwner'))}</span>`}</td>
              <td class="c-raised"><span class="mono" style="font-size:11.5px;color:var(--muted)">${esc(fmtShortDate(r.item.openedAt || r.meeting.date))}</span></td>
              <td class="c-age">${ageCell(r)}</td>
              <td class="c-due">${dueCell(r.item)}</td>
            </tr>`).join('')}</tbody>
        </table>
        ${rows.length > 8 ? `<div class="smore">${state.seriesAll ? '' : `${esc(T('moreOpen', rows.length - 8))} · `}<button id="btn-series-all">${esc(T(state.seriesAll ? 'showLess' : 'showAll'))}</button></div>` : ''}`
        : `<p class="empty">${esc(T('noneYet'))}</p>`}
      </div>
      <div class="srail">
        <div class="cards">
          <div class="mini"><span class="n">${summary.meanAge ?? '—'}<span class="unit">${summary.meanAge != null ? esc(T('days')) : ''}</span></span><span class="l">${esc(T('sMeanAge'))}</span></div>
          <div class="mini ${summary.oldest > 14 ? 'alert' : ''}"><span class="n">${summary.oldest ?? '—'}<span class="unit">${summary.oldest != null ? esc(T('days')) : ''}</span></span><span class="l">${esc(T('sOldest'))}</span></div>
        </div>
        <div class="card">
          <h3>${esc(T('flowTitle'))}</h3>
          <div class="sub">${esc(T('flowNote', upN, flow.length, net))}</div>
          <div class="legend"><span><i style="background:var(--down-bar)"></i>${esc(T('opened'))}</span><span><i style="background:var(--up)"></i>${esc(T('closed'))}</span></div>
          <div class="flow">
            <div class="gl" style="top:0"></div><div class="gl" style="top:37px"></div><div class="gl" style="top:73px"></div>
            <div class="bars">${flow.map((f) => `<span><i class="o" style="height:${Math.round((f.opened / maxFlow) * 110)}px" title="${f.opened}"></i><i class="c" style="height:${Math.round((f.closed / maxFlow) * 110)}px" title="${f.closed}"></i></span>`).join('')}</div>
            ${[['o', maxOpened], ['c', maxClosed]].filter(([, val]) => val > 0).map(([cls, val]) => `<span class="ymax ${cls}" style="bottom:${Math.round((val / maxFlow) * 110)}px">${val}</span>`).join('')}
          </div>
          <div class="flowx">${flow.map((f) => `<span class="${f.meetingId === m.id ? 'cur' : ''}">W${f.seq}</span>`).join('')}</div>
        </div>
        <div class="card">
          <h3 style="margin-bottom:11px">${esc(T('byParty'))}</h3>
          ${orgRows.length ? `<div class="orgbar">${orgRows.map(([org, n], i) => `<div>
            <div class="row"><span>${esc(org === 'unassigned' ? T('noOwner') : org)}</span><span class="mono">${n}</span></div>
            <div class="track"><i style="width:${Math.round((n / orgMax) * 100)}%;background:${orgColor[i % orgColor.length]}"></i></div>
          </div>`).join('')}</div>` : `<p class="empty" style="padding:8px 0">${esc(T('noneYet'))}</p>`}
        </div>
        <div class="card amber">
          <h3><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/></svg>${esc(T('raisedAgain'))}</h3>
          <p>${repeat
            ? esc(repeat.item.owner ? T('raisedAgainOwned', pickText(repeat.item.text, state.lang), repeat.chain, repeat.owner || repeat.item.owner) : T('raisedAgainBody', pickText(repeat.item.text, state.lang), repeat.chain))
            : esc(T('raisedAgainNone'))}</p>
        </div>
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   Header / strip / chips / crumbs
   ========================================================================== */
function paintHeader() {
  const m = activeMeeting();
  if (!m) return;
  const stats = meetingStats(m, todayUTC());
  const series = seriesOf(m);
  const [project, seriesName] = splitTitle(m.title);
  // Hanya jejaknya yang ditulis ulang; tautan "Minutes" harus bertahan, kalau
  // tidak jalan pulang ikut hilang begitu ada rapat aktif.
  $('#crumb-trail').innerHTML = `<span class="sep">/</span><span>${esc(project)}</span>${seriesName ? `<span class="sep">/</span><span>${esc(seriesName)}</span>` : ''}<span class="sep">/</span><span class="now mono">${esc(weekLabel(m))} · ${esc(fmtDate(m.date))}</span>`;
  $('#m-title').textContent = m.title;
  $('#m-date').textContent = m.date;
  $('#m-time').textContent = [m.start, m.end].filter(Boolean).join('–') + (m.tz && m.tz !== 'local' ? ` ${m.tz}` : '');
  $('#m-chair').textContent = m.chair || '—';
  $('#m-present').textContent = m.attendees.length ? T('presentN', m.attendees.length) : '—';
  $('#m-mom').textContent = m.id;
  $('#m-series').textContent = T('seriesNth', series.findIndex((x) => x.id === m.id) + 1);
  $('#m-ptype').textContent = T(ptKey(m.projectType));
  $('#prov-line').textContent = m.engine
    ? T('pipeline', m.engine.asr, m.engine.segments, m.items.length)
    : T('noSource');
  $('#prov-unreviewed').textContent = String(stats.unreviewed);
  $('#prov-low').textContent = String(stats.lowConfidence);
  $('#prov-low-wrap').hidden = !stats.lowConfidence;
  $('#prov-low-sep').hidden = !stats.lowConfidence;
  $('#btn-issue').hidden = !!m.issuedAt;
  $('#issued-badge').classList.toggle('hidden', !m.issuedAt);
  $('#issued-badge').textContent = m.issuedAt ? `${T('issued')} — ${m.issuedAt.slice(0, 10)}` : '';
  $('#btn-amend').hidden = !m.issuedAt;
  $('#btn-add-item').hidden = !!m.issuedAt;

  paintSummary(stats);
}

/* --------------------------------------------------------------------------
   D01 — ringkasan register yang lebih tenang.

   Tujuh kartu angka diganti satu ringkasan: total besar (odometer MP-01, 250 ms),
   batang bertumpuk per tipe, daftar peringkat, blok statistik, dan tombol
   "Review N". Rangka dibangun sekali dan diperbarui di tempat, supaya odometer
   tidak mulai dari nol tiap filter berubah. Ketujuh angka tetap terlihat:
   butir (total), tindak lanjut, lewat tenggat, pertanyaan (baris peringkat),
   belum ditinjau, keputusan/varians (peringkat atau blok), cakupan agenda.
   -------------------------------------------------------------------------- */
/* TIDE-024 (A04d): satu pita ≤ 72 px. Legenda sebaris membawa jumlah; chevron
   membuka legenda penuh (.sum-rank) dengan jumlah dan persentase. */
let sum = null;
let sumOpen = false;

function buildSummary(host) {
  host.innerHTML = `<div class="sum-box"><div class="sum">
    <div class="sum-total"><span class="n"><span class="mo-num"></span></span><span class="l"></span></div>
    <div class="sum-mid"><div class="sum-stack" role="img"></div><ul class="sum-legend"></ul></div>
    <dl class="sum-stats"></dl>
    <div class="sum-act"><button type="button" class="btn sm sum-review" id="btn-sum-review"></button>
    <button type="button" class="icon-btn sum-xp" id="btn-sum-expand" title="${esc(T('expandPanel'))}" aria-label="${esc(T('expandPanel'))}" aria-controls="sum-rank" aria-expanded="false"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div>
  </div><ul class="sum-rank" id="sum-rank" hidden></ul></div>`;
  sum = {
    host,
    total: slidingNumber(host.querySelector('.mo-num'), { decimals: 0, groupSeparator: '', decimalSeparator: '.' }),
    label: host.querySelector('.sum-total .l'),
    stack: host.querySelector('.sum-stack'),
    legend: host.querySelector('.sum-legend'),
    rank: host.querySelector('.sum-rank'),
    stats: host.querySelector('.sum-stats'),
    review: host.querySelector('.sum-review'),
    xp: host.querySelector('.sum-xp'),
  };
  sum.review.addEventListener('click', () => $('#btn-review-only').click());
  sum.xp.addEventListener('click', () => { sumOpen = !sumOpen; paintSummaryOpen(); });
}

function paintSummaryOpen() {
  sum.xp.setAttribute('aria-expanded', String(sumOpen));
  sum.xp.title = T(sumOpen ? 'sumLess' : 'sumMore');
  sum.xp.setAttribute('aria-label', sum.xp.title);
  sum.rank.hidden = !sumOpen || !sum.rank.childElementCount;
}

function paintSummary(stats) {
  const host = $('#strip');
  if (!sum || sum.host !== host || !host.contains(sum.stack)) buildSummary(host);
  const m = activeMeeting();
  sum.total.to(stats.total);
  sum.label.textContent = T('sTotal');
  const counts = ITEM_TYPES.map((t) => [t, m.items.filter((i) => i.type === t).length]).filter(([, n]) => n).sort((x, y) => y[1] - x[1]);
  const share = (n) => (stats.total ? Math.round((n / stats.total) * 100) : 0);
  sum.stack.setAttribute('aria-label', counts.map(([t, n]) => `${T(t)} ${n}`).join(', '));
  sum.stack.innerHTML = counts.map(([t, n]) => `<i style="flex:${n};background:${TYPE_COLOR[t]}" title="${esc(T(t))} ${n}"></i>`).join('');
  sum.legend.innerHTML = counts.length
    ? counts.map(([t, n]) => `<li><span class="sw" style="background:${TYPE_COLOR[t]}"></span>${esc(T(t))} <b class="mono">${n}</b></li>`).join('')
    : `<li class="none">${esc(T('sumNone'))}</li>`;
  sum.rank.innerHTML = counts.map(([t, n]) => `<li><span class="sw" style="background:${TYPE_COLOR[t]}"></span><span class="nm">${esc(T(t))}${t === 'question' && stats.questionsOpen !== n ? ` <em>${esc(T('openN', stats.questionsOpen))}</em>` : ''}</span><span class="v mono">${n}</span><span class="sh mono">${share(n)}%</span></li>`).join('');
  sum.xp.hidden = !counts.length;
  paintSummaryOpen();
  const rows = [
    [T('sActions'), `${stats.actionsOpen}<span class="of">/${stats.actionsTotal}</span>`, ''],
    [T('sOverdue'), String(stats.overdue), stats.overdue ? 'is-alert' : ''],
    [T('sCoverage'), `${stats.agendaPct}%`, ''],
    [T('sUnreviewed'), String(stats.unreviewed), stats.unreviewed ? 'is-warn' : 'is-ok'],
  ];
  if (stats.variance != null) rows.push([T('sVariance'), `${sign(stats.variance)}${esc(fmtMeasure(stats.variance))}${esc(stats.varianceUnit || '')}`, stats.variance >= 0 ? 'is-up' : 'is-alert']);
  sum.stats.innerHTML = rows.map(([l, v, c]) => `<div class="${c}"><dt>${esc(l)}</dt><dd class="mono">${v}</dd></div>`).join('');
  sum.review.hidden = !stats.lowConfidence;
  sum.review.textContent = T('reviewN', stats.lowConfidence);
}

/** Pelarut 180 ms saat filter "needs review" berganti; hormati reduce-motion. */
function fadeRows() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelector('#pane tbody')?.animate?.([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
}

function paintChips() {
  const m = activeMeeting();
  $('#chips').innerHTML = ITEM_TYPES.map((t) => {
    const n = m ? m.items.filter((i) => i.type === t).length : 0;
    const on = state.types.has(t);
    return `<button class="chip" data-type="${t}" aria-pressed="${on}" style="--dot:${TYPE_COLOR[t]}">
      <span class="dot"></span>${esc(T(t))}<span class="ct">${n}</span></button>`;
  }).join('');
  $('#btn-review-only').setAttribute('aria-pressed', String(state.reviewOnly));
}

function paintSwitcher() {
  const opt = (m) => `<option value="${esc(m.id)}" ${m.id === state.activeId ? 'selected' : ''}>${esc(m.date)} — ${esc(weekLabel(m))}${m.issuedAt ? ' ✓' : ''}</option>`;
  const vis = visibleMeetings();
  const types = [...new Set(vis.map((m) => m.projectType || 'general'))];
  const sel = $('#m-switch');
  // Lebih dari satu tipe → kelompokkan per tipe supaya 200 rapat tetap bisa dinavigasi.
  sel.innerHTML = types.length > 1
    ? types.map((t) => `<optgroup label="${esc(T(ptKey(t)))}">${vis.filter((m) => (m.projectType || 'general') === t).map(opt).join('')}</optgroup>`).join('')
    : vis.map(opt).join('');

  const counts = new Map();
  for (const m of state.meetings) { const t = m.projectType || 'general'; counts.set(t, (counts.get(t) || 0) + 1); }
  const of = $('#owner-filter');
  if (of) {
    const owners = [...new Set((activeMeeting()?.items || []).map((i) => i.owner).filter(Boolean))].sort();
    if (state.ownerFilter && !owners.includes(state.ownerFilter)) owners.push(state.ownerFilter);
    of.innerHTML = `<option value="">${esc(T('ownerAll'))}</option>` + owners.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    of.value = state.ownerFilter;
    of.hidden = !owners.length;
    of.closest('label').hidden = of.hidden;
  }
  const pf = $('#pt-filter');
  if (pf) {
    pf.innerHTML = `<option value="all">${esc(T('allTypes'))} (${state.meetings.length})</option>` +
      [...counts.entries()].map(([t, n]) => `<option value="${t}"${t === state.ptFilter ? ' selected' : ''}>${esc(T(ptKey(t)))} (${n})</option>`).join('');
    pf.value = counts.has(state.ptFilter) ? state.ptFilter : 'all';
    pf.hidden = counts.size < 2;
  }
}

function paintFooter(rows) {
  const m = activeMeeting();
  $('#showing').innerHTML = m ? esc(T('showing', rows.length, m.items.length)) : '';
  $('#kbd-hints').innerHTML = [
    `<kbd>j</kbd>/<kbd>k</kbd> ${esc(T('kbdMove'))}`,
    `<kbd>a</kbd> ${esc(T('kbdAccept'))}`,
    `<kbd>o</kbd> ${esc(T('kbdOwner'))}`,
    `<kbd>d</kbd> ${esc(T('kbdDate'))}`,
    `<kbd>/</kbd> ${esc(T('kbdSearch'))}`,
    `<kbd>Esc</kbd> ${esc(T('kbdClose'))}`,
  ].join(' · ');
  $('#saved-line').textContent = state.lastSaved ? T('lastSaved', fmtClock(state.lastSaved), backendName()) : T('notSavedYet', backendName());
}

/* ==========================================================================
   Drawer (Provenance + Progress artboards)
   ========================================================================== */
function activeItem() {
  const m = activeMeeting();
  return m ? m.items.find((i) => i.ref === state.sel) : null;
}

/** Deterministic pseudo-waveform: no audio yet (Phase 2.2), so the bars are a
 *  stable function of the timecode — the CITED span and low-confidence words
 *  are the information, the amplitudes are decoration. */
function waveform(it) {
  const src = it.src;
  let seed = (src.t0 * 9301 + 49297) % 233280;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const N = 24;
  const inStart = 7;
  const inEnd = 17;
  const low = isLow(it);
  return `<div class="wave" aria-hidden="true">${Array.from({ length: N }, (_, i) => {
    const h = 20 + Math.round(rnd() * 76);
    const inside = i >= inStart && i <= inEnd;
    const bad = low && inside && i >= 12 && i <= 14;
    return `<i class="${bad ? 'bad' : inside ? 'in' : ''}" style="height:${h}%"></i>`;
  }).join('')}</div>
  <div class="wlegend"><span><i style="background:var(--accent)"></i>${esc(T('citedSpan'))}</span>${low ? `<span><i style="background:var(--danger)"></i>${esc(T('lowConfWords'))}</span>` : ''}</div>`;
}

function provenanceBlock(it, m) {
  if (!it.src) return `<p class="empty" style="padding:0;text-align:left">${esc(T('noSource'))}</p>`;
  const src = it.src;
  const to = it.correction?.to || null;
  // The mis-hearing is marked in BOTH quotes when the extractor could map it
  // back to the source-language phrase — seeing 弯管和涂敷 lit up is what makes
  // "the audio says bending and coating" checkable by someone who reads zh.
  const origMark = it.correction?.origPhrase || null;
  return `<div class="fld">
    <label>${esc(T('dProvenance'))}</label>
    <div class="quote">
      <div class="qh">
        <span class="tc" data-play="${esc(src.tc)}">${playIcon()}${esc(tcRange(src))}</span>
        ${src.speaker ? `<span class="sep">·</span><span class="spk">${esc(src.speaker)}</span>` : ''}
        ${segLabel(src) ? `<span class="sep">·</span><span class="mono">${esc(segLabel(src))}</span>` : ''}
        ${src.meetingId && src.meetingId !== m.id ? `<span class="sep">·</span><span class="mono">${esc(src.meetingId)}</span>` : ''}
        <span class="asr" style="color:${confColor(it.confidence)}">${esc(T('asr'))} ${pct(it.confidence)}%</span>
      </div>
      ${src.orig ? `<div class="qt orig"><span class="lbl">${esc(T('asSpoken'))}${src.lang && src.lang !== 'auto' ? ` · ${esc(src.lang)}` : ''}</span>${textWithMark(src.orig, origMark)}</div>` : ''}
      ${src.tr ? `<div class="qt"><span class="lbl">${esc(T('machineTranslation'))} · en</span>${textWithMark(src.tr, to)}</div>` : ''}
      ${waveform(it)}
    </div>
  </div>`;
}

function linkedBlock(it, m, variant = 'fld') {
  const links = linkedItems(state.meetings, m, it);
  if (!links.length) return '';
  return `<div class="${variant === 'card' ? 'pcard' : 'fld'}">
    <label class="lbl">${esc(T('dLinked'))}</label>
    <div class="linkrows">${links.map(({ item, meeting }) => `
      <div class="linkrow" data-link="${esc(item.ref)}" data-meeting="${esc(meeting.id)}">
        <span class="bar" style="background:${TYPE_COLOR[item.type]}"></span>
        <span class="r">${esc(item.ref)}</span>
        <span class="t">${esc(pickText(item.text, state.lang))}${item.type === 'metric' && item.metric ? ` · ${esc(fmtNum(item.metric.value))}${esc(item.metric.unit)}` : ''}</span>
      </div>`).join('')}</div>
  </div>`;
}

function historyBlock(it) {
  const rows = [];
  const first = it.history?.[0];
  const created = first?.at || null;
  rows.push(`<div><span class="at">${created ? esc(created.slice(11, 16)) : '—'}</span> · ${esc(T('extractedBy', first?.by || 'local'))} · <span class="ai">${esc(T('ai'))}</span></div>`);
  if (isLow(it)) rows.push(`<div><span class="at">${created ? esc(created.slice(11, 16)) : '—'}</span> · ${esc(T('flaggedLow', pct(it.confidence)))}</div>`);
  for (const h of (it.history || []).slice().reverse()) {
    if (h.field === 'created' || h.field === 'carriedFrom') {
      if (h.field === 'carriedFrom') rows.push(`<div><span class="at">${esc(h.at.slice(11, 16))}</span> · ↩ ${esc(h.from)} → ${esc(h.to)} <span class="muted2">(${esc(h.by)})</span></div>`);
      continue;
    }
    const fmt = (v) => (v == null ? '∅' : typeof v === 'object' ? esc(JSON.stringify(v)) : esc(String(v)));
    rows.push(`<div><span class="at">${esc(h.at.slice(11, 16))}</span> · ${esc(h.field)}: ${fmt(h.from)} → ${fmt(h.to)} <span class="muted2">(${esc(h.by)})</span></div>`);
  }
  return `<div class="fld"><label>${esc(T('dHistory'))}</label><div class="hist">${rows.join('')}</div></div>`;
}

function correctionBanner(it) {
  if (!it.correction || !isLow(it) && it.review !== 'ai') return '';
  const c = it.correction;
  return `<div class="lowconf">
    <div class="h">${alertIcon(15)}<b>${esc(T('asrUnsure', pct(it.confidence)))}</b></div>
    <div class="b">${esc(T('extractorWrote'))} <code class="bad">${esc(c.from)}</code>. ${esc(T('audioSays'))}${it.src ? ` <span class="tc">${esc(it.src.tc)}</span>` : ''} <code class="good">${esc(c.to)}</code>.</div>
    <div class="acts">
      <button class="btn xs primary" id="d-apply">${esc(T('applyCorrection'))}</button>
      <button class="btn xs" id="d-keep">${esc(T('keepAsHeard'))}</button>
      <button class="btn xs" id="d-glossary" data-term="${esc(c.to)}">${esc(T('addToGlossary'))}</button>
    </div>
  </div>`;
}

/**
 * Progress artboard: three numbers, the curve across the series, then the
 * evidence beside the links — the whole point of the wide drawer is that the
 * figure and what it came from are read together, not scrolled past.
 */
function metricDetail(it, m) {
  const mt = it.metric;
  if (!mt) return '';
  const pts = metricSeries(seriesOf(m), mt.measure);
  const v = mt.variance;
  const dir = v == null ? 'mOnBaseline' : v > 0 ? 'mAhead' : v < 0 ? 'mBehind' : 'mOnBaseline';
  const risks = m.items.filter((i) => i.type === 'risk' && i.status !== 'closed' && (i.agenda && i.agenda === it.agenda || (it.links || []).includes(i.ref)));
  const callout = risks.length && v != null && v > 0
    ? `<div class="callout"><div class="h">${alertIcon(14)}${esc(T('mAheadNotSafe'))}</div><p>${esc(T('mAheadNotSafeBody', risks.length))}</p></div>`
    : '';
  const side = `${linkedBlock(it, m, 'card')}${callout}`;
  return `
    <div class="mcards">
      <div class="mc"><span class="lbl">${esc(T('mActual'))}</span><span class="n">${odoSlot(mt.value)}<span class="unit">${esc(mt.unit)}</span></span></div>
      <div class="mc base"><span class="lbl">${esc(T('mBaseline'))}</span><span class="n">${mt.baseline != null ? `${odoSlot(mt.baseline)}<span class="unit">${esc(mt.unit)}</span>` : '—'}</span></div>
      <div class="mc var ${v != null && v < 0 ? 'down' : ''}"><span class="lbl">${esc(T('mVariance'))}</span><span class="n">${v != null ? `${odoSlot(v, true)}<span class="unit">${esc(mt.unit)}</span>` : '—'}</span><small>${esc(T(dir))}</small></div>
    </div>
    <div class="chart">
      <div class="ch"><b>${esc(T('mChart'))}</b>
        <div class="legend"><span><i class="line" style="background:var(--up)"></i>${esc(T('mActual'))}</span><span><i class="dash"></i>${esc(T('mBaseline'))}</span></div></div>
      <div class="sub">${esc(pts.length > 1 ? T('mChartNote') : T('mSingle'))}</div>
      ${metricChart(pts, mt.unit)}
    </div>
    <div class="mgrid">
      <div class="mprov">${metricSource(it)}</div>
      ${side ? `<div class="mside">${side}</div>` : ''}
    </div>`;
}

/** "Where the figure came from": one card, the cited sentence, and why it is typed. */
function metricSource(it) {
  const src = it.src;
  const mt = it.metric;
  // The editorial line is a claim about THIS figure — three numbers pulled out
  // of one spoken sentence. It is only true when there is a cited sentence and
  // the metric really carries a baseline/variance, so a bare count (man-hours,
  // incidents) or an unsourced figure does not get told a story about itself.
  const typed = !!src && !!mt && (mt.baseline != null || mt.variance != null);
  return `<div class="pcard">
    <span class="lbl">${esc(T('mWhereFrom'))}</span>
    ${src ? `<div class="qh">
      <span class="tc" data-play="${esc(src.tc)}">${playIcon()}${esc(tcRange(src))}</span>
      ${src.speaker ? `<span class="sep">·</span><span class="spk">${esc(src.speaker)}</span>` : ''}
      ${segLabel(src) ? `<span class="sep">·</span><span class="mono">${esc(segLabel(src))}</span>` : ''}
      <span class="asr" style="color:${confColor(it.confidence)}">${esc(T('asr'))} ${pct(it.confidence)}%</span>
    </div>
    <blockquote>${esc(src.tr || src.orig)}</blockquote>`
      : `<p class="empty" style="padding:0;text-align:left">${esc(T('noSource'))}</p>`}
    ${typed ? `<p class="mnote">${esc(T('mTypedNote'))}</p>` : ''}
  </div>`;
}
function metricChart(pts, unit) {
  const W = 620; const H = 196; const L = 40; const R = 12; const TOP = 20; const BOT = 170;
  const vals = pts.flatMap((p) => [p.value, p.baseline]).filter((x) => x != null);
  const max = Math.max(...vals, 1) * 1.15;
  const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - R - L)) / (pts.length - 1));
  const y = (v) => BOT - ((v / max) * (BOT - TOP));
  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = (max / ticks) * i;
    const yy = y(v);
    return `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${W - R}" y2="${yy.toFixed(1)}" stroke="${i === 0 ? '#3a3a3a' : '#242424'}"/><text x="${L - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" fill="#8a8a8a" font-size="10" font-family="ui-monospace, Menlo, monospace">${fmtNum(v)}</text>`;
  }).join('');
  const line = (key, color, dash) => {
    const p = pts.map((pt, i) => (pt[key] == null ? null : `${x(i).toFixed(1)},${y(pt[key]).toFixed(1)}`)).filter(Boolean);
    if (!p.length) return '';
    return `<polyline fill="none" stroke="${color}" stroke-width="2" ${dash ? 'stroke-dasharray="5 4"' : ''} stroke-linecap="round" stroke-linejoin="round" points="${p.join(' ')}"/>`;
  };
  const last = pts[pts.length - 1];
  const li = pts.length - 1;
  const ends = last ? `
    ${last.baseline != null ? `<circle cx="${x(li).toFixed(1)}" cy="${y(last.baseline).toFixed(1)}" r="4" fill="#8a8a8a" stroke="#1f1f1f" stroke-width="2"/>` : ''}
    <circle cx="${x(li).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="5" fill="#199e70" stroke="#1f1f1f" stroke-width="2"/>
    <text x="${(x(li) - 10).toFixed(1)}" y="${(y(last.value) - 8).toFixed(1)}" text-anchor="end" fill="#199e70" font-size="11" font-weight="600" font-family="ui-monospace, Menlo, monospace">${fmtNum(last.value)}${esc(unit)}</text>
    ${last.baseline != null ? `<text x="${(x(li) - 10).toFixed(1)}" y="${(y(last.baseline) + 14).toFixed(1)}" text-anchor="end" fill="#b4b4b4" font-size="11" font-family="ui-monospace, Menlo, monospace">${fmtNum(last.baseline)}${esc(unit)}</text>` : ''}` : '';
  const xl = pts.map((p, i) => `<text x="${x(i).toFixed(1)}" y="190" text-anchor="middle" fill="${i === li ? '#e8e8e8' : '#8a8a8a'}" font-size="10" font-family="ui-monospace, Menlo, monospace">W${p.seq}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('mChart'))}">${grid}${line('baseline', '#8a8a8a', true)}${line('value', '#199e70', false)}${ends}${xl}</svg>`;
}

function paintDrawer() {
  const dr = $('#drawer');
  const m = activeMeeting();
  if (state.adding) return paintDrawerAdd();
  const it = m ? activeItem() : null;
  if (!it) { dr.hidden = true; return; }
  dr.hidden = false;
  const locked = !!m.issuedAt;
  const other = state.lang === 'en' ? 'ID' : 'EN';
  // A metric is a page, not a row: the Progress artboard gives it a wide
  // surface so the chart sits beside the sentence it was read out of.
  const isMetric = it.type === 'metric';
  dr.classList.toggle('wide', isMetric);
  const refChip = `<span class="mono">${esc(it.ref)}</span>${it.carriedFrom ? ` <span style="color:var(--warn-text)">↩ ${esc(it.carriedFrom)}</span>` : ''}`;
  const metaChips = `${cellType(it)}<span class="topic">${esc(topicLabel(it.topic))}</span>${it.agenda ? `<span class="mono muted2" style="font-size:10.5px">${esc(T('agendaRef', it.agenda))}</span>` : ''}${it.review !== 'ai' ? `<span class="rev" data-r="${it.review}" style="margin:0">${esc(T(it.review))}</span>` : ''}`;
  $('#d-id').innerHTML = isMetric ? '' : refChip;
  $('#d-type').innerHTML = isMetric
    ? `<span class="dref">${refChip}</span>${metaChips}<h1 class="dtitle">${esc(itemText(it))}</h1>`
    : metaChips;

  $('#d-body').innerHTML = `
    ${locked ? '' : correctionBanner(it)}
    ${it.type === 'metric' ? metricDetail(it, m) : ''}
    <div class="fld">
      <label>${esc(T('dText'))}</label>
      <textarea rows="4" id="f-text" ${locked ? 'disabled' : ''}>${esc(itemText(it))}</textarea>
      <div class="hint"><span class="ldot"><i></i>${esc(state.lang.toUpperCase())}</span><span style="color:#4a4a4a">·</span><span>${esc(T('translationHint', other))}</span></div>
    </div>
    <div class="two">
      <div class="fld"><label>${esc(T('dOwner'))}</label>
        <input id="f-owner" list="dl-owners" value="${esc(it.owner || '')}" ${locked ? 'disabled' : ''} /></div>
      <div class="fld"><label>${esc(T('dDue'))}</label>
        <input type="date" id="f-due" value="${esc(it.due || '')}" ${locked ? 'disabled' : ''} /></div>
      <div class="fld"><label>${esc(T('dStatus'))}</label>
        <select id="f-status" ${locked ? 'disabled' : ''}>
          ${['open', 'progress', 'closed', 'carried'].map((s) => `<option value="${s}" ${s === it.status ? 'selected' : ''}>${esc(T(s))}</option>`).join('')}
        </select></div>
      ${it.type === 'risk'
        ? `<div class="fld"><label>${esc(T('dSevLik'))}</label>
        <div class="sevlik">
          <select id="f-priority" ${locked ? 'disabled' : ''} aria-label="${esc(T('dPriority'))}">
            ${['high', 'med', 'low'].map((p) => `<option value="${p}" ${p === it.priority ? 'selected' : ''}>${esc(T(`pr${cap(p)}`))}</option>`).join('')}
          </select>
          <select id="f-likelihood" ${locked ? 'disabled' : ''} aria-label="${esc(T('dSevLik'))}">
            ${LIKELIHOODS.map((l) => `<option value="${l}" ${l === it.likelihood ? 'selected' : ''}>${esc(T(`lk${cap(l)}`))}</option>`).join('')}
          </select>
        </div></div>`
        : it.type === 'action'
        ? `<div class="fld"><label>${esc(T('dPriority'))}</label>
        <select id="f-priority" ${locked ? 'disabled' : ''}>
          ${['high', 'med', 'low'].map((p) => `<option value="${p}" ${p === it.priority ? 'selected' : ''}>${esc(T(`pr${cap(p)}`))}</option>`).join('')}
        </select></div>`
        : `<div class="fld"><label>${esc(T('dTopic'))}</label>
        <input id="f-topic" list="dl-topics" value="${esc(it.topic)}" ${locked ? 'disabled' : ''} /></div>`}
    </div>
    ${it.type === 'risk' || it.type === 'action' ? `<div class="fld"><label>${esc(T('dTopic'))}</label><input id="f-topic" list="dl-topics" value="${esc(it.topic)}" ${locked ? 'disabled' : ''} /></div>` : ''}
    ${isMetric ? '' : provenanceBlock(it, m)}
    ${isMetric ? '' : linkedBlock(it, m)}
    ${historyBlock(it)}
    <datalist id="dl-owners">${(m.attendees || []).map((a) => `<option value="${esc(a.name)}">`).join('')}</datalist>
    <datalist id="dl-topics">${[...new Set(m.items.map((i) => i.topic))].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
  `;

  $('#d-foot').innerHTML = locked
    ? `<span class="muted">${esc(T('msgIssuedFrozen'))}</span>`
    : `<button class="btn primary" id="d-save">${checkIcon(13)} ${esc(T(it.review === 'ai' ? 'accept' : 'saveEdit'))}</button>
       ${it.src ? `<button class="btn" id="d-play">${playIcon(12)} ${esc(T('playFrom'))}</button>` : ''}
       <span class="spacer"></span>
       <button class="btn danger" id="d-discard">${esc(T('discard'))}</button>`;

  mountMetricOdometers($('#d-body'));
}

function paintDrawerAdd() {
  const dr = $('#drawer');
  dr.hidden = false;
  dr.classList.remove('wide');
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
  $('#demo-sec').hidden = !state.meetings.some(isDemoMeeting);
  if (!m) return;

  paintHeader();
  paintChips();
  paintSwitcher();
  // The workspace was hidden until a meeting loaded, so nothing in the bar had
  // a width to measure yet. Re-place the pills now that it is laid out.
  resyncPills(false);

  const rows = sortedItems(filteredItems());
  visibleRefs = rows.map((r) => r.ref);
  // Kerangka workspace memakai #center sebagai wadah tengah; tata letak toolbar
  // lama memakai .main. Cari keduanya supaya render tidak batal di tengah jalan.
  ($('.main') || $('#center'))?.classList.toggle('overlay', state.view === 'series' || state.view === 'doc');
  const pane = $('#pane');
  // The boards own the whole centre: CSS hides the register's header strip and source panel for them.
  if (THREAD_VIEWS.has(state.view)) document.body.dataset.thv = state.view; else delete document.body.dataset.thv;
  pane.innerHTML = state.view === 'table' ? viewTable(rows)
    : state.view === 'topic' ? viewTopic(rows)
    : state.view === 'doc' ? viewDoc()
    : state.view === 'series' ? viewSeries()
    : THREAD_VIEWS.has(state.view) ? renderThreads(state.view)
    : viewCarry();
  if (state.view === 'table' || state.view === 'topic') pane.insertAdjacentHTML('beforeend', crossSearchHtml());

  $('#q').value = state.q;
  paintFooter(rows);
  paintDrawer();
  const selRow = state.sel ? pane.querySelector(`[data-ref="${cssEscape(state.sel)}"]`) : null;
  if (selRow && typeof selRow.scrollIntoView === 'function') selRow.scrollIntoView({ block: 'nearest' });
  dock?.paint();
}

/* ==========================================================================
   Actions
   ========================================================================== */
let toastTimer;
function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
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
    }, { by: state.me || 'local' });
    replaceActive(meeting);
    state.adding = false;
    state.sel = meeting.items[meeting.items.length - 1]?.ref || null;
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
    topic: $('#f-topic')?.value.trim() || it.topic,
  };
  if ($('#f-priority')) patch.priority = $('#f-priority').value;
  if ($('#f-likelihood')) patch.likelihood = $('#f-likelihood').value;
  const changed = Object.keys(patch).some((k) => JSON.stringify(patch[k]) !== JSON.stringify(it[k]));
  let meeting;
  if (!changed && it.review === 'ai') {
    meeting = await acceptWithXp(m, it);
  } else if (changed) {
    meeting = await editItemAndSave(m, it.ref, patch, { by: state.me || 'local' });
  } else {
    return;
  }
  replaceActive(meeting);
  toast(T('msgAccepted'));
  paint();
}

/** The MoM summary is prose a human owns — read it back off the page as typed. */
async function doSaveSummary() {
  const m = activeMeeting();
  const box = $('#doc-summary');
  if (!m || !box) return;
  try {
    replaceActive(await setSummaryAndSave(m, state.lang, box.textContent));
    toast(T('msgSummarySaved'));
    paint();
  } catch (e) {
    toast(e && e.message ? e.message : String(e), true);
  }
}

/** Terima butir lalu catat XP — satu jalur untuk tombol, drawer, dan tombol pintas `a`. */
async function acceptWithXp(m, it) {
  const meeting = await acceptItemAndSave(m, it.ref, { by: state.me || 'local' });
  globalThis.__learn?.award('item-accepted', `item-accepted:${m.id}:${it.ref}`);
  return meeting;
}

async function acceptSelected() {
  const m = activeMeeting();
  const it = activeItem();
  if (!m || !it || m.issuedAt || it.review !== 'ai') return;
  replaceActive(await acceptWithXp(m, it));
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

async function doApplyCorrection() {
  const m = activeMeeting();
  const it = activeItem();
  if (!m || !it?.correction) return;
  replaceActive(await applyCorrectionAndSave(m, it.ref, { by: state.me || 'local' }));
  toast(T('correctionApplied'));
  paint();
}
async function doKeepAsHeard() {
  const m = activeMeeting();
  const it = activeItem();
  if (!m || !it) return;
  replaceActive(await acceptWithXp(m, it));
  toast(T('keptAsHeard'));
  paint();
}
function doAddGlossary(term) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(LS_GLOSSARY) || '[]'); } catch { list = []; }
  if (!list.includes(term)) list.push(term);
  try { localStorage.setItem(LS_GLOSSARY, JSON.stringify(list)); } catch { /* quota */ }
  toast(T('glossaryAdded', term));
}

async function doIssue(force = false) {
  const m = activeMeeting();
  try {
    const meeting = await issueMeetingAndSave(m, { force, by: state.me || 'local' });
    replaceActive(meeting);
    globalThis.__learn?.award('mom-issued', `mom-issued:${meeting.id}`);
    toast(T('msgIssued'));
    state.view = 'doc';
    syncTabs();
    paint();
  } catch (e) {
    if (e instanceof RegisterError && e.code === 'unreviewed' && !force) {
      const blocked = blockingItems(m);
      if (confirm(T('msgBlocked', blocked.length))) await doIssue(true);
      return;
    }
    toast(e && e.message ? e.message : String(e), true);
  }
}

async function doAmend() {
  const m = activeMeeting();
  const amended = createAmendment(m, { by: state.me || 'local' });
  const saved = await saveMeeting(amended);
  await reloadAll(false);
  state.activeId = saved.id;
  state.lastSaved = new Date();
  toast(T('msgAmended', saved.id));
  paint();
}

async function doStartNext() {
  const m = activeMeeting();
  const series = seriesOf(m);
  const last = series[series.length - 1];
  const nextDate = prompt(T('date'), addDaysISO(last.date, 7));
  if (!nextDate) return;
  const next = startNextMeeting(last, { date: nextDate });
  const saved = await saveMeeting(next);
  await reloadAll(false);
  state.activeId = saved.id;
  state.lastSaved = new Date();
  state.view = 'table';
  syncTabs();
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
  if (format === 'print') {
    state.view = 'doc';
    syncTabs();
    paint();
    setTimeout(() => window.print(), 50);
    return;
  }
  if (format === 'json') downloadText(`${safe}.json`, JSON.stringify(m, null, 2));
  else if (format === 'csv') downloadText(`${safe}.csv`, serializeMeetingCsv(m, state.lang));
  else downloadText(`${safe}.md`, serializeMeetingMarkdown(m, state.lang, T));
}
function doExportStanding() {
  const m = activeMeeting();
  const series = seriesOf(m);
  const rows = seriesSummary(series, todayUTC()).rows;
  const escCsv = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [
    ['ref', 'meeting', 'type', 'text', 'owner', 'org', 'raised', 'age_days', 'due', 'status', 'consecutive_meetings'].join(','),
    ...rows.map((r) => [r.item.ref, r.meeting.id, r.item.type, pickText(r.item.text, state.lang), r.item.owner || '', r.item.org || '', r.item.openedAt || r.meeting.date, r.age ?? '', r.item.due || '', r.item.status, r.chain].map(escCsv).join(',')),
  ].join('\n');
  downloadText(`${m.seriesId.replace(/[^\w.-]+/g, '_')}-standing-register.csv`, csv);
}

/* --------------------------------------------------------------------------
   MP-04 — a spring pill travels behind the selected item, on the same terms as
   the side panel: each group keeps its own selection logic and the pill only
   follows. The register tabs use aria-selected, the language switch uses
   aria-pressed, and hl.sync() reads whichever the group declares.
   -------------------------------------------------------------------------- */
const pills = new Map();

function mountPill(sel, selectedAttr) {
  const host = document.querySelector(sel);
  if (!host || pills.has(sel)) return;
  const pill = document.createElement('span');
  pill.className = 'mo-pill';
  host.prepend(pill);
  host.classList.add('mo-has-pill');
  pills.set(sel, highlight(host, { pill, bind: false, selectedAttr }));
}

function mountPills() {
  mountPill('#tabs', 'aria-selected');
  mountPill('.langsw', 'aria-pressed');
}

function syncPill(sel, animated = true) {
  pills.get(sel)?.sync(animated);
}

function resyncPills(animated = false) {
  for (const sel of pills.keys()) syncPill(sel, animated);
}

function syncTabs() {
  // Query the buttons, not every child: the pill is a child too.
  $('#tabs').querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.view === state.view)));
  syncPill('#tabs');
}
function selectRef(ref, meetingId = null) {
  if (meetingId && meetingId !== state.activeId && state.meetings.some((m) => m.id === meetingId)) {
    state.activeId = meetingId;
    state.view = 'table';
    syncTabs();
  }
  state.adding = false;
  state.sel = ref;
  paint();
}
function moveSel(delta) {
  if (!visibleRefs.length) return;
  const i = visibleRefs.indexOf(state.sel);
  const next = i < 0 ? (delta > 0 ? 0 : visibleRefs.length - 1) : Math.min(visibleRefs.length - 1, Math.max(0, i + delta));
  state.adding = false;
  state.sel = visibleRefs[next];
  paint();
}

/* ==========================================================================
   Events
   ========================================================================== */
function wireEvents() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    syncTabs();
    paint();
  });

  $('#chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const t = c.dataset.type;
    if (state.types.has(t)) state.types.delete(t); else state.types.add(t);
    paint();
  });
  $('#btn-review-only').addEventListener('click', () => { state.reviewOnly = !state.reviewOnly; paint(); fadeRows(); });

  $('#q').addEventListener('input', (e) => { state.q = e.target.value; paint(); });
  $('#group-by').addEventListener('change', (e) => { state.group = e.target.value; paint(); });

  $('#owner-filter')?.addEventListener('change', (e) => { state.ownerFilter = e.target.value; paint(); });
  $('#pane').addEventListener('click', (e) => {
    const r = e.target.closest('[data-xs-meeting]');
    if (!r) return;
    state.activeId = r.dataset.xsMeeting;
    state.sel = r.dataset.xsRef;
    state.adding = false;
    paint();
  });
  $('#btn-mine').addEventListener('click', (e) => {
    if (!state.me) {
      const name = prompt(T('mine'));
      if (!name) return;
      state.me = name;
      localStorage.setItem(LS_NAME, name);
    }
    state.mine = !state.mine;
    e.currentTarget.setAttribute('aria-pressed', String(state.mine));
    paint();
  });
  $('#btn-dual').addEventListener('click', (e) => {
    state.dual = !state.dual;
    e.currentTarget.setAttribute('aria-pressed', String(state.dual));
    paint();
  });

  $('.langsw').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (!b) return;
    state.lang = b.dataset.lang;
    localStorage.setItem(LS_LANG, state.lang);
    T = makeT(state.lang);
    // Buttons only: the pill is a sibling in here too.
    b.parentNode.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    syncPill('.langsw');
    paintStaticStrings();
    document.dispatchEvent(new Event('ysm-lang'));
    // Every label just changed length, so the register tabs re-measure.
    resyncPills(false);
    paint();
  });

  mountExtras({
    lang: () => state.lang,
    meetings: () => state.meetings,
    activeMeeting,
    reload: () => reloadAll(true),
    setActive: (id) => { state.activeId = id; state.sel = null; },
    paint,
    toast,
  });

  mountThreads({
    pane: () => $('#pane'),
    lang: () => state.lang,
    meetings: () => state.meetings,
    activeMeeting,
    query: () => state.q,
    me: () => state.me,
    fmtDate,
    reload: () => reloadAll(true),
    paint,
    toast,
    openRef: (mid, ref) => { state.activeId = mid; state.view = 'table'; syncTabs(); selectRef(ref); },
  });

  mountDraftOptions({
    lang: () => state.lang,
    activeMeeting,
    replaceActive,
    save: saveMeeting,
    me: () => state.me,
    paint,
    toast,
  });

  dock = mountDock({
    state: () => state,
    T: () => T,
    paint,
    selectRef,
    activeMeeting,
    activeItem,
    toast,
    setView: (view) => { state.view = view; syncTabs(); paint(); },
    editItem: async (ref, patch) => {
      const meeting = await editItemAndSave(activeMeeting(), ref, patch, { by: state.me || 'local' });
      replaceActive(meeting);
    },
  });

  $('#m-switch').addEventListener('change', (e) => {
    state.activeId = e.target.value;
    state.sel = null;
    state.adding = false;
    paint();
  });
  $('#pt-filter')?.addEventListener('change', (e) => {
    state.ptFilter = e.target.value;
    const vis = visibleMeetings();
    if (!vis.some((m) => m.id === state.activeId)) state.activeId = vis[0]?.id || state.activeId;
    state.sel = null;
    paint();
  });

  $('#pane').addEventListener('click', (e) => {
    if (e.target.closest('#btn-save-summary')) { doSaveSummary(); return; }
    const play = e.target.closest('[data-play]');
    if (play) { e.stopPropagation(); toast(`${T('msgSeeking')} ${play.dataset.play}`); return; }

    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      editItemAndSave(activeMeeting(), closeBtn.dataset.close, { status: 'closed' }, { by: state.me || 'local' })
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
    if (e.target.closest('#btn-start-next')) { doStartNext(); return; }
    if (e.target.closest('#btn-export-standing')) { doExportStanding(); return; }
    if (e.target.closest('#btn-series-all')) { state.seriesAll = !state.seriesAll; paint(); return; }

    const mcard = e.target.closest('.mcard[data-meeting]');
    if (mcard) { state.activeId = mcard.dataset.meeting; state.sel = null; paint(); return; }

    const row = e.target.closest('[data-ref]');
    if (row) selectRef(row.dataset.ref, row.dataset.meeting || null);
  });

  $('#d-close').addEventListener('click', () => { state.sel = null; state.adding = false; $('#drawer').hidden = true; paint(); });
  $('#drawer').addEventListener('click', (e) => {
    if (e.target.closest('#d-save')) { saveDrawer(); return; }
    if (e.target.closest('#d-discard')) { discardDrawer(); return; }
    if (e.target.closest('#d-apply')) { doApplyCorrection(); return; }
    if (e.target.closest('#d-keep')) { doKeepAsHeard(); return; }
    const gl = e.target.closest('#d-glossary');
    if (gl) { doAddGlossary(gl.dataset.term); return; }
    const link = e.target.closest('[data-link]');
    if (link) { selectRef(link.dataset.link, link.dataset.meeting); return; }
    const play = e.target.closest('[data-play]');
    if (play) { toast(`${T('msgSeeking')} ${play.dataset.play}`); return; }
    if (e.target.closest('#d-play')) {
      const it = activeItem();
      if (it?.src) toast(`${T('msgSeeking')} ${it.src.tc}`);
    }
  });

  $('#btn-add-item').addEventListener('click', () => {
    state.sel = null;
    state.adding = true;
    paint();
    $('#f-text')?.focus();
  });

  $('#btn-issue').addEventListener('click', () => doIssue(false));
  $('#btn-amend').addEventListener('click', () => doAmend());

  $('#btn-export').addEventListener('click', () => {
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
    state.lastSaved = new Date();
    toast(T('msgMigrated', 2));
    paint();
  });

  $('#btn-remove-demo').addEventListener('click', async () => {
    const demo = state.meetings.filter(isDemoMeeting);
    if (!demo.length || !confirm(T('confirmRemoveDemo'))) return;
    for (const m of demo) await deleteMeeting(m.id);
    await reloadAll(false);
    toast(T('msgDemoRemoved', demo.length));
    paint();
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target?.isContentEditable;
    if (e.key === 'Escape') {
      if (typing && e.target !== $('#q')) { e.target.blur(); return; }
      if (state.sel || state.adding) { state.sel = null; state.adding = false; $('#drawer').hidden = true; paint(); }
      return;
    }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); return; }
    if (!activeMeeting()) return;
    if (e.key === 'j') { e.preventDefault(); moveSel(1); return; }
    if (e.key === 'k') { e.preventDefault(); moveSel(-1); return; }
    if (e.key === 'a') { e.preventDefault(); acceptSelected(); return; }
    if (e.key === 'o') { e.preventDefault(); $('#f-owner')?.focus(); return; }
    if (e.key === 'd') { e.preventDefault(); $('#f-due')?.focus(); }
  });
}

function paintStaticStrings() {
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = T(el.dataset.t); });
  // Tombol yang labelnya dilipat jadi ikon di layar sempit hanya menyisakan
  // tooltip, jadi tooltipnya harus ikut diterjemahkan.
  // aria-label too: below 1100 px these buttons keep only their icon, and a title alone is not a reliable name.
  document.querySelectorAll('[data-t-title]').forEach((el) => { el.title = T(el.dataset.tTitle); el.setAttribute('aria-label', el.title); });
  // Halaman utama: di lab itu /app.html di root server; di ekstensi app.html
  // tidak ikut dipaket, jadi jalan pulangnya panel sisi.
  const home = $('#crumb-home');
  if (home) home.href = location.protocol === 'chrome-extension:' ? 'sidepanel.html' : engineOrigin() ? 'app.html' : '/app.html';
  $('#q').placeholder = T('search');
}

/* ==========================================================================
   Boot
   ========================================================================== */
async function boot() {
  document.querySelector(`.langsw button[data-lang="${state.lang}"]`)?.setAttribute('aria-pressed', 'true');
  document.querySelector(`.langsw button[data-lang="${state.lang === 'en' ? 'id' : 'en'}"]`)?.setAttribute('aria-pressed', 'false');
  mountPills();
  wireEvents();
  paintStaticStrings();
  // Tab labels change width with the language and with the window.
  resyncPills(false);
  window.addEventListener('resize', () => resyncPills(false));
  await reloadAll(false);
  paint();
  // Engine-hosted app window: mirror the register to the engine so island pages see it.
  startEngineSync({ lang: () => state.lang, onError: () => toast(T('engineSyncFail'), true) });
}

boot();
