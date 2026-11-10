/**
 * Halaman Minutes di kerangka (papan A04), digambar langsung — tanpa iframe register.
 *
 * Isi: remah + "Open register: Classic | Modern", Collapse header, Layout & appearance,
 * bilah rapat (pilih rapat, Draft options, Library, Training, Add item, Export,
 * Apply correction, Issue MoM), garis ringkasan + chip tipe, Needs review only / Group / Mine,
 * tab, daftar butir, baris sumber.
 *
 * Yang dikerjakan di sini: memilih rapat, memfilter, mengelompokkan, Register dan By topic,
 * kepadatan baris, tata letak register tersimpan, demo. Yang hanya masuk akal di register
 * penuh (menulis butir, ekspor, terbitkan, tab lain) membuka register dengan `?do=` / `?view=`;
 * minutes.js menjalankannya saat dimuat.
 *
 * Bagian atas berkas ini murni (tanpa DOM) dan diuji di test/minutes-page.test.mjs.
 */
import { ITEM_TYPES, LOW_CONFIDENCE, pickText } from '../lib/notes-schema.js';
import { makeT } from '../lib/notes-i18n.js';
import { seedSampleData } from '../lib/notes-fixture.js';

/* ---------------------------------------------------------------- murni */

export const needsReview = (it) => it.review === 'ai' || it.confidence < LOW_CONFIDENCE;

/** Jumlah per tipe untuk seluruh daftar (chip tidak berubah saat memfilter). */
export function typeCounts(items) {
  const out = { all: items.length };
  for (const t of ITEM_TYPES) out[t] = items.filter((i) => i.type === t).length;
  return out;
}

export function visibleItems(items, { types = new Set(), reviewOnly = false, mine = false, me = '' } = {}) {
  return items.filter((it) => {
    if (types.size && !types.has(it.type)) return false;
    if (reviewOnly && !needsReview(it)) return false;
    if (mine && me && it.owner !== me) return false;
    return true;
  });
}

/** Satu run per kelompok, urutan pertama-muncul; 'none' = satu run tanpa judul. */
export function groupItems(items, group, { topicLabel = (k) => k, noOwner = '—', statusLabel = (s) => s } = {}) {
  if (group === 'none' || !group) return [{ label: null, count: items.length, items }];
  const key = (it) => (group === 'owner' ? it.owner || noOwner : group === 'status' ? statusLabel(it.status) : topicLabel(it.topic));
  const out = []; const by = new Map();
  for (const it of items) {
    const label = key(it);
    if (!by.has(label)) { const g = { label, count: 0, items: [] }; by.set(label, g); out.push(g); }
    by.get(label).items.push(it); by.get(label).count += 1;
  }
  return out;
}

/** Rapat terbaru dari seri (atau dari semuanya). */
export function defaultMeetingId(meetings, series = '') {
  const list = (series ? meetings.filter((m) => m.seriesId === series) : meetings).slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.start || '').localeCompare(String(a.start || '')));
  return list[0]?.id ?? null;
}

/**
 * Tata letak register tersimpan (`ysmMinutesLayout`) setelah satu perintah dari menu Layout.
 * Mengembalikan salinan; 'reset' → null (hapus kunci, register memakai bawaan).
 */
export function patchLayout(layout, action) {
  if (action === 'reset') return null;
  const l = JSON.parse(JSON.stringify(layout || {}));
  for (const k of ['left', 'right', 'bottom']) l[k] = { ...(l[k] || {}) };
  l.dock = { ...(l.dock || {}) };
  if (action === 'rail') { l.left.mode = 'rail'; l.right.mode = 'rail'; l.bottom.mode = 'rail'; }
  else if (action === 'float') l.bottom.mode = 'float';
  else if (action === 'expand-dock') l.dock.mini = false;
  else if (action === 'hide') l.top = false;
  return l;
}

/* ---------------------------------------------------------------- teks */

const S = {
  en: {
    back: 'Back to the main page', crumb: 'Minutes', openRegister: 'Open register', classic: 'Classic ↗', modern: 'Modern ↗',
    collapse: 'Collapse header', expand: 'Expand header', layout: 'Layout & appearance', density: 'Density',
    review: 'Review', reading: 'Reading', compact: 'Compact', float: 'Float this panel', rail: 'Collapse to rail', dock: 'Expand view dock', hide: 'Hide', reset: 'Reset layout',
    layoutNote: 'Saved for the register window.', meeting: 'Meeting', draft: 'Draft options', library: 'Library', training: 'Training', add: 'Add item', exportB: 'Export', amend: 'Apply correction', issue: 'Issue MoM',
    items: (n) => `${n} item${n === 1 ? '' : 's'}`, decision: (n) => `${n} decision${n === 1 ? '' : 's'}`, action: (n) => `${n} action${n === 1 ? '' : 's'}`, question: (n) => `${n} question${n === 1 ? '' : 's'}`,
    risk: (n) => `${n} risk${n === 1 ? '' : 's'}`, metric: (n) => `${n} metric${n === 1 ? '' : 's'}`, info: (n) => `${n} note${n === 1 ? '' : 's'}`, all: 'All',
    needsReview: 'Needs review only', group: 'Group', none: 'none', topic: 'Topic', owner: 'Owner', status: 'Status', mine: 'Mine',
    tabs: ['Register', 'By topic', 'Minutes', 'Carry-forward', 'Series', 'Inbox', 'Projects', 'Highlights'],
    cRef: 'Ref', cType: 'Type', cItem: 'Item', cOwner: 'Owner', cStatus: 'Status', cTime: 'Time', cConf: 'Conf.', unassigned: 'Unassigned',
    reviewFlag: 'Review', source: 'Source:', lowN: (n) => `Review ${n} low-confidence item${n === 1 ? '' : 's'}`, srcLine: (tr, n) => `transcript of ${tr}. ${n} low-confidence item${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a look.`, srcClean: (tr) => `transcript of ${tr}. Nothing needs a second look.`,
    noItemsFilter: 'No items match the filters.', whoName: 'Your name for “Mine”',
    emptyTitle: 'No minutes yet', emptyBody: 'Start captions in a meeting and the register fills itself, or load a few demo meetings to look around.', loadDemo: 'Load demo meetings (removable)', loading: 'Reading your register…',
  },
  id: {
    back: 'Kembali ke halaman utama', crumb: 'Notulen', openRegister: 'Buka register', classic: 'Klasik ↗', modern: 'Modern ↗',
    collapse: 'Ciutkan kepala', expand: 'Buka kepala', layout: 'Tata letak & tampilan', density: 'Kepadatan',
    review: 'Tinjau', reading: 'Baca', compact: 'Ringkas', float: 'Mengambangkan panel', rail: 'Ciutkan ke rel', dock: 'Buka dok tampilan', hide: 'Sembunyikan', reset: 'Atur ulang tata letak',
    layoutNote: 'Tersimpan untuk jendela register.', meeting: 'Rapat', draft: 'Opsi draf', library: 'Pustaka', training: 'Pelatihan', add: 'Tambah butir', exportB: 'Ekspor', amend: 'Terapkan koreksi', issue: 'Terbitkan notulen',
    items: (n) => `${n} butir`, decision: (n) => `${n} keputusan`, action: (n) => `${n} tindakan`, question: (n) => `${n} pertanyaan`, risk: (n) => `${n} risiko`, metric: (n) => `${n} metrik`, info: (n) => `${n} catatan`, all: 'Semua',
    needsReview: 'Perlu ditinjau saja', group: 'Kelompok', none: 'tidak ada', topic: 'Topik', owner: 'Pemilik', status: 'Status', mine: 'Milik saya',
    tabs: ['Register', 'Per topik', 'Notulen', 'Bawa-maju', 'Seri', 'Kotak masuk', 'Proyek', 'Sorotan'],
    cRef: 'Ref', cType: 'Tipe', cItem: 'Butir', cOwner: 'Pemilik', cStatus: 'Status', cTime: 'Waktu', cConf: 'Yakin', unassigned: 'Belum ada pemilik',
    reviewFlag: 'Tinjau', source: 'Sumber:', lowN: (n) => `Tinjau ${n} butir berkeyakinan rendah`, srcLine: (tr, n) => `transkrip ${tr}. ${n} butir berkeyakinan rendah perlu dilihat.`, srcClean: (tr) => `transkrip ${tr}. Tidak ada yang perlu dilihat ulang.`,
    noItemsFilter: 'Tidak ada butir yang cocok dengan filter.', whoName: 'Nama Anda untuk “Milik saya”',
    emptyTitle: 'Belum ada notulen', emptyBody: 'Mulai teks langsung di rapat dan register terisi sendiri, atau muat beberapa rapat contoh untuk melihat-lihat.', loadDemo: 'Muat rapat contoh (bisa dihapus)', loading: 'Membaca register Anda…',
  },
};
const LAYOUT_KEY = 'ysmMinutesLayout';
const DENSITY_KEY = 'ysmRowDensity';
const TAB_VIEW = ['register', 'topic', 'doc', 'carry', 'series', 'inbox', 'projects', 'highlights'];
const DO = { draft: 'draft', library: 'library', training: 'training', add: 'add', export: 'export', amend: 'amend', issue: 'issue' };

/* ---------------------------------------------------------------- tampilan */

/** Keadaan tampilan halaman ini (satu salinan per muat, bukan disimpan). */
export const ui = { meetingId: null, types: new Set(), reviewOnly: false, group: 'none', mine: false, tab: 'register', collapsed: false, layoutOpen: false };

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } };
export const density = () => { const d = read(DENSITY_KEY); return d === 'review' || d === 'compact' ? d : 'reading'; };

/**
 * @param c { lang, esc, ic, tide, meetings, series, register ('classic'|'modern'), me, meetingParam, registerSrc(kind, extra) }
 */
export function minutesHtml(c) {
  const { lang, esc, ic, tide, meetings } = c;
  const t = S[lang] || S.en;
  const NT = makeT(lang);
  if (!meetings) return `<div class="mn"><div class="st loading">${tide('compass', 'st-art')}<h3>${esc(t.loading)}</h3></div></div>`;
  if (!meetings.length) {
    return `<div class="mn"><nav class="mn-crumb"><a href="#today">${esc(t.back)}</a></nav><div class="st mn-empty">${tide('sleep', 'st-art')}<h3>${esc(t.emptyTitle)}</h3><p>${esc(t.emptyBody)}</p><div class="st-act"><button type="button" class="pill-b" data-mn="demo">${esc(t.loadDemo)}</button></div></div></div>`;
  }
  const meeting = meetings.find((m) => m.id === ui.meetingId)
    || meetings.find((m) => m.id === c.meetingParam)
    || meetings.find((m) => m.id === defaultMeetingId(meetings, c.series)) || meetings[0];
  ui.meetingId = meeting.id;
  const all = meeting.items || [];
  const counts = typeCounts(all);
  const shown = visibleItems(all, { types: ui.types, reviewOnly: ui.reviewOnly, mine: ui.mine, me: c.me });
  const low = all.filter((i) => i.confidence < LOW_CONFIDENCE).length;
  const topicLabel = (k) => { const x = meeting.topics?.[k]; return x ? pickText(x, lang) : k; };
  const kinds = c.register === 'modern' ? ['modern', 'classic'] : ['classic', 'modern'];
  const openLinks = kinds.map((k) => `<a href="${esc(c.registerSrc(k, { meeting: meeting.id }))}" target="_blank" rel="noopener" data-register="${k}" class="${k === c.register ? 'on' : ''}">${esc(t[k])}</a>`).join('');
  const list = [...meetings].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.start || '').localeCompare(String(a.start || '')));
  const sel = `<select data-mn="meeting" aria-label="${esc(t.meeting)}" title="${esc(t.meeting)}">${list.map((m) => `<option value="${esc(m.id)}"${m.id === meeting.id ? ' selected' : ''}>${esc(`${m.title} · ${m.date}${m.start ? ` ${m.start}` : ''}`)}</option>`).join('')}</select>`;
  const doBtn = (k, label, icon, cls = 'btn') => `<button type="button" class="${cls}" data-do="${DO[k]}">${icon ? ic(icon, 16) : ''}${esc(label)}</button>`;
  const bar = `<div class="mn-bar">${sel}${doBtn('draft', t.draft, '')}${doBtn('library', t.library, 'book')}${doBtn('training', t.training, '')}<span class="grow"></span>${doBtn('add', t.add, '')}${doBtn('export', t.exportB, 'export')}${doBtn('amend', t.amend, '')}${doBtn('issue', t.issue, '', 'pill-b')}</div>`;
  const d = density();
  const pop = ui.layoutOpen ? `<div class="mn-pop" role="dialog" aria-label="${esc(t.layout)}"><b>${esc(t.layout)}</b><span class="mn-k">${esc(t.density)}</span><div class="mn-seg" role="group">${['review', 'reading', 'compact'].map((k) => `<button type="button" data-density="${k}" aria-pressed="${k === d}">${esc(t[k])}</button>`).join('')}</div><div class="mn-pops"><button type="button" class="btn sm" data-layout="float">${esc(t.float)}</button><button type="button" class="btn sm" data-layout="rail">${esc(t.rail)}</button><button type="button" class="btn sm" data-layout="expand-dock">${esc(t.dock)}</button><button type="button" class="btn sm" data-layout="hide">${esc(t.hide)}</button></div><button type="button" class="btn sm full" data-layout="reset">${esc(t.reset)}</button><small class="mut">${esc(t.layoutNote)}</small></div>` : '';
  const tools = `<div class="mn-tools"><div class="mn-open"><span>${esc(t.openRegister)}</span>${openLinks}</div><button type="button" class="btn sm" data-mn="collapse" aria-pressed="${ui.collapsed}">${esc(ui.collapsed ? t.expand : t.collapse)}</button><div class="mn-lay"><button type="button" class="btn sm" data-mn="layout" aria-expanded="${ui.layoutOpen}">${esc(t.layout)}</button>${pop}</div></div>`;

  const parts = [['items', counts.all], ...['decision', 'action', 'question', 'risk', 'metric', 'info'].filter((k) => counts[k]).map((k) => [k, counts[k]])];
  const sum = `<div class="mn-sum">${parts.map(([k, n]) => esc(t[k](n))).join(' · ')}</div>`;
  const chip = (k, label, n) => `<button type="button" class="mn-chip" data-type="${k}" aria-pressed="${k === 'all' ? ui.types.size === 0 : ui.types.has(k)}">${esc(label)}<b>${n}</b></button>`;
  const chips = `<div class="mn-chips">${chip('all', t.all, counts.all)}${['decision', 'action', 'question', 'risk', 'metric', 'info'].filter((k) => counts[k]).map((k) => chip(k, NT(k), counts[k])).join('')}</div>`;
  const filters = `<div class="mn-filters"><button type="button" class="chip sm warn" data-mn="review-only" aria-pressed="${ui.reviewOnly}">${esc(t.needsReview)}</button><label class="mn-grp">${esc(t.group)}: <select data-mn="group">${['none', 'topic', 'owner', 'status'].map((g) => `<option value="${g}"${g === ui.group ? ' selected' : ''}>${esc(t[g])}</option>`).join(' ')}</select></label><button type="button" class="chip sm" data-mn="mine" aria-pressed="${ui.mine}">◑ ${esc(t.mine)}</button></div>`;
  const tabs = `<div class="mn-tabs" role="tablist">${t.tabs.map((label, i) => `<button type="button" role="tab" data-tab="${TAB_VIEW[i]}" aria-selected="${TAB_VIEW[i] === ui.tab}">${esc(label)}</button>`).join('')}</div>`;

  const hue = (type) => `var(--mn-ty-${type})`;
  const row = (it) => `<tr class="mn-row" data-ref="${esc(it.ref)}"><td class="ref">${esc(it.ref)}${it.carriedFrom ? ' <span class="carry" title="Carried forward">↺</span>' : ''}</td><td><span class="mn-ty"><i style="background:${hue(it.type)}"></i>${esc(NT(it.type))}</span></td><td class="mn-it">${esc(pickText(it.text, lang))}${needsReview(it) ? ` <span class="mn-flag">${ic('info', 12)}${esc(t.reviewFlag)}</span>` : ''}</td><td>${it.owner ? esc(it.owner) : `<span class="mut">${esc(t.unassigned)}</span>`}</td><td>${esc(NT(it.status))}</td><td class="mono">${esc(it.src?.tc || '')}</td><td class="mono">${it.confidence != null ? `${Math.round(it.confidence * 100)}%` : ''}</td></tr>`;
  const head = `<thead><tr><th>${esc(t.cRef)}</th><th>${esc(t.cType)}</th><th>${esc(t.cItem)}</th><th>${esc(t.cOwner)}</th><th>${esc(t.cStatus)}</th><th>${esc(t.cTime)}</th><th>${esc(t.cConf)}</th></tr></thead>`;
  let body;
  if (ui.tab === 'topic') {
    const g = groupItems(shown, 'topic', { topicLabel });
    body = shown.length ? `<div class="mn-topics">${g.map((x) => `<section class="mn-topic"><h3>${esc(x.label)}<span class="mn-n">${x.count}</span></h3><table class="mn-t">${head}<tbody>${x.items.map(row).join('')}</tbody></table></section>`).join('')}</div>` : `<p class="mn-none">${esc(t.noItemsFilter)}</p>`;
  } else {
    const groups = groupItems(shown, ui.group, { topicLabel, noOwner: t.unassigned, statusLabel: (s) => NT(s) });
    body = shown.length ? `<table class="mn-t">${head}<tbody>${groups.map((x) => `${x.label == null ? '' : `<tr class="mn-ghead"><td colspan="7">${esc(x.label)}<span class="mn-n">${x.count}</span></td></tr>`}${x.items.map(row).join('')}`).join('')}</tbody></table>` : `<p class="mn-none">${esc(t.noItemsFilter)}</p>`;
  }
  const srcName = meeting.title || '';
  const srcLine = `<div class="mn-src">${ic('info', 16)}<b>${esc(t.source)}</b><span>${esc(low ? t.srcLine(srcName, low) : t.srcClean(srcName))}</span><span class="grow"></span>${low ? `<button type="button" class="pill-b sm" data-mn="review-low">${esc(t.lowN(low))}</button>` : ''}</div>`;
  const head2 = ui.collapsed ? '' : sum;
  return `<div class="mn" data-dens="${d}"><div class="mn-top"><nav class="mn-crumb"><a href="#today">${esc(t.back)}</a><span aria-hidden="true">›</span><span>${esc(t.crumb)}</span></nav>${tools}</div>${bar}<section class="mn-card">${head2}${ui.collapsed ? `<div class="mn-crow">${filters}</div>` : `<div class="mn-crow">${chips}${filters}</div>`}${tabs}${body}${srcLine}</section></div>`;
}

/* ---------------------------------------------------------------- perilaku */

/**
 * Pasang pendengar sekali pada `page`. c: { lang, getMe(), setMe(name), rerender(), reload(),
 * registerSrc(kind, extra), getRegister(), openRegister(url) }
 */
export function mountMinutes(page, c) {
  const t = () => S[c.lang] || S.en;
  const openReg = (extra) => c.openRegister(c.registerSrc(c.getRegister(), { meeting: ui.meetingId, ...extra }));
  page.addEventListener('click', async (e) => {
    if (page.dataset.route !== 'minutes') return;
    const q = (s) => e.target.closest(s);
    const ch = q('.mn-chip');
    if (ch) { const k = ch.dataset.type; if (k === 'all') ui.types.clear(); else if (ui.types.has(k)) ui.types.delete(k); else ui.types.add(k); return c.rerender(); }
    const tab = q('.mn-tabs [data-tab]');
    if (tab) { const v = tab.dataset.tab; if (v === 'register' || v === 'topic') { ui.tab = v; return c.rerender(); } return openReg({ view: v }); }
    const act = q('[data-mn]')?.dataset.mn;
    if (act === 'review-only') { ui.reviewOnly = !ui.reviewOnly; return c.rerender(); }
    if (act === 'review-low') { ui.reviewOnly = true; ui.types.clear(); ui.tab = 'register'; return c.rerender(); }
    if (act === 'collapse') { ui.collapsed = !ui.collapsed; return c.rerender(); }
    if (act === 'layout') { ui.layoutOpen = !ui.layoutOpen; return c.rerender(); }
    if (act === 'mine') {
      if (!ui.mine && !c.getMe()) { const n = globalThis.prompt?.(t().whoName); if (!n) return; c.setMe(n.trim()); }
      ui.mine = !ui.mine; return c.rerender();
    }
    if (act === 'demo') { await seedSampleData(); return c.reload(); }
    const dn = q('[data-density]');
    if (dn) { write(DENSITY_KEY, dn.dataset.density); return c.rerender(); }
    const ly = q('[data-layout]');
    if (ly) {
      const next = patchLayout(JSON.parse(read(LAYOUT_KEY) || 'null'), ly.dataset.layout);
      write(LAYOUT_KEY, next ? JSON.stringify(next) : null);
      return;
    }
    const d = q('[data-do]');
    if (d) return openReg({ do: d.dataset.do });
    if (ui.layoutOpen && !q('.mn-lay')) { ui.layoutOpen = false; c.rerender(); }
  });
  page.addEventListener('change', (e) => {
    if (page.dataset.route !== 'minutes') return;
    if (e.target.matches('[data-mn="meeting"]')) { ui.meetingId = e.target.value; ui.types.clear(); ui.reviewOnly = false; c.rerender(); }
    else if (e.target.matches('[data-mn="group"]')) { ui.group = e.target.value; c.rerender(); }
  });
}
