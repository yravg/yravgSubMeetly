/**
 * Add-ins UI — Settings › Add-ins (board T05) and the chip strip in the Notes panel.
 * The rules live in lib/addins.js; this file only reads/writes the trust store and draws.
 * Storage: chrome.storage.local `ysmAddinTrust` {id: hash}, `ysmAddinRemoved` [id], `ysmAddinRuns` {id: [{at, text}]}.
 */
import { tile } from './lib/colour-icons.js';
import { listMeetings } from './lib/notes-store.js';
import {
  TRUST_KEY, REMOVED_KEY, listAddins, mayCall, visibleActions, visiblePanels, panelRows,
} from './lib/addins.js';
import { BUNDLED } from './addins/index.js';

const RUNS_KEY = 'ysmAddinRuns';
const STORE_KEYS = [TRUST_KEY, REMOVED_KEY, RUNS_KEY];
const MAX_RUNS = 5;
const TOAST_MS = 8000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- storage ---------- */
export async function loadStore() {
  const got = await chrome.storage.local.get(STORE_KEYS);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { trusted: obj(got[TRUST_KEY]), removed: Array.isArray(got[REMOVED_KEY]) ? got[REMOVED_KEY] : [], runs: obj(got[RUNS_KEY]) };
}
const saveTrustState = (trusted, removed) => chrome.storage.local.set({ [TRUST_KEY]: trusted, [REMOVED_KEY]: removed });

export async function recordRun(addinId, text) {
  const { runs } = await loadStore();
  const list = [{ at: new Date().toISOString(), text }, ...(runs[addinId] || [])].slice(0, MAX_RUNS);
  await chrome.storage.local.set({ [RUNS_KEY]: { ...runs, [addinId]: list } });
}

/** Enabled manifests only: needs-trust, changed, broken and removed add-ins never reach the Notes panel. */
export async function loadRuntime(bundled = BUNDLED) {
  const { trusted, removed } = await loadStore();
  return listAddins(bundled, trusted, removed).filter((e) => e.state === 'enabled').map((e) => e.manifest);
}

/* ---------- Notes panel strip ---------- */
export function stripHtml(enabled, active, meetings, { lang = 'en', now } = {}) {
  if (!active || !enabled.length) return '';
  const chips = visibleActions(enabled, active);
  const panels = visiblePanels(enabled, active);
  if (!chips.length && !panels.length) return '';
  const series = meetings.filter((m) => m.seriesId === active.seriesId);
  return `<div class="ai-strip" data-addins-strip>
    ${chips.length ? `<div class="ai-chips">${chips.map((c) => `<button type="button" class="ai-chb" data-addin="${esc(c.addinId)}:${esc(c.actionId)}"${active.issuedAt ? ' disabled' : ''}>${tile('bolt', 20)}<span>${esc(c.label)}</span>${c.badge != null ? `<i>${c.badge}</i>` : ''}</button>`).join('')}</div>` : ''}
    ${panels.map((p) => {
      const rows = panelRows(enabled.find((m) => m.id === p.addinId), p.panelId, series, { lang, now });
      return `<details class="ai-panel" open><summary>${tile('pages', 20)}<b>${esc(p.title)}</b>${p.badge != null ? `<i class="ai-count">${p.badge}</i>` : ''}</summary>
        <ul>${rows.map((r) => `<li><span class="ai-ref">${esc(r.ref)}</span><span>${esc(r.text)}</span>${r.owner ? `<span class="ai-dim">${esc(r.owner)}</span>` : ''}</li>`).join('')}</ul></details>`;
    }).join('')}
  </div>`;
}

/* ---------- Settings › Add-ins ---------- */
const STATE_LABEL = { 'needs-trust': 'Needs trust', enabled: 'Enabled', changed: 'Changed', broken: 'Broken', removed: 'Removed' };
const SECTIONS = [
  ['Needs trust', (e) => ['needs-trust', 'changed', 'broken'].includes(e.state)],
  ['Enabled', (e) => e.state === 'enabled'],
  ['Removed', (e) => e.state === 'removed'],
];

function scopeText(a) {
  if (a === 'always') return 'always';
  return [a.projectType && `projectType ${a.projectType.join(', ')}`, a.seriesId && `seriesId ${a.seriesId.join(', ')}`].filter(Boolean).join(' · ');
}
const doText = (d) => (d.call === 'addItem' ? `Register addItem (${d.type})` : `open ${d.url}`);

function kindText(e) {
  if (e.state === 'broken') return 'manifest error · never run';
  if (e.state === 'changed') return 'changed since you trusted it';
  const m = e.manifest;
  return `${[m.actions?.length && 'action chip', m.panels?.length && 'panel', m.hooks?.length && 'hook'].filter(Boolean).join(' + ') || 'empty'} · appliesTo ${scopeText(m.appliesTo)}`;
}
const iconOf = (e) => (e.state === 'broken' ? 'warn' : e.state === 'changed' ? 'diff' : e.manifest?.panels?.length && !e.manifest?.actions?.length ? 'pages' : 'bolt');

function rowHtml(e, ui) {
  const name = e.manifest?.name || String(e.raw?.name || e.id);
  return `<button type="button" class="ai-row" data-ai="open" data-id="${esc(e.id)}" aria-pressed="${ui.sel === e.id}">
    <i class="ai-un${e.state === 'needs-trust' || e.state === 'changed' || e.state === 'broken' ? '' : ' off'}"></i>${tile(iconOf(e), 30)}
    <span class="ai-tt"><b>${esc(name)}</b><span>${esc(kindText(e))}</span></span><span class="ai-ver">v${esc(e.manifest?.version || e.raw?.version || '?')}</span></button>`;
}

function quoteHtml(e) {
  const m = e.manifest;
  const line = (k, v) => `<p><span class="ai-k">${esc(k)}</span> ${v}</p>`;
  const lines = [];
  if (!m) {
    lines.push(line('error', `<span class="ai-low">${esc(e.error)}</span>`));
    for (const k of ['appliesTo', 'actions', 'panels', 'hooks']) if (e.raw && e.raw[k] !== undefined) lines.push(line(k, esc(JSON.stringify(e.raw[k]))));
  } else {
    lines.push(line('appliesTo', esc(scopeText(m.appliesTo))));
    for (const a of m.actions || []) lines.push(line('actions', esc(`${a.label} → ${doText(a.do)}`)), ...(a.badge ? [line('badge', esc(`count of ${a.badge}`))] : []));
    for (const p of m.panels || []) lines.push(line('panels', esc(`page “${p.title}”, items from ${p.source}`)), ...(p.when ? [line('when', esc(p.when))] : []));
    for (const h of m.hooks || []) lines.push(line('hooks', esc(`on ${h.on} → ${doText(h.do)} (declared, not fired in v0)`)));
  }
  const chips = (m?.actions || []).map((a) => `<span class="ai-chb ai-chb-demo">${tile('bolt', 20)}<span>${esc(a.label)}</span></span>`)
    .concat((m?.panels || []).map((p) => `<span class="ai-chb ai-chb-demo">${tile('pages', 20)}<span>${esc(p.title)}</span></span>`));
  return `<div class="ai-quote"><div class="ai-qh">${tile('bolt', 20)}<b>${esc(m?.name || e.raw?.name || e.id)}</b><span class="ai-grow"></span><span class="ai-mono">manifest v0</span></div>${lines.join('')}</div>${chips.length ? `<div class="ai-chips">${chips.join('')}</div>` : ''}`;
}

function gateHtml(e, ui, locked) {
  const b = (act, label, cls = '', extra = '') => `<button type="button" class="mini-btn ${cls}" data-ai="${act}" data-id="${esc(e.id)}"${extra}>${label}</button>`;
  const lk = locked ? ' disabled' : '';
  const review = b('review', e.state === 'broken' ? 'Open error' : 'Review manifest', '', ` aria-expanded="${ui.review === e.id}"`);
  const json = ui.review === e.id ? `<pre class="ai-json">${esc(JSON.stringify(e.raw, null, 2))}</pre><p class="ai-dim">${e.hash ? `hash ${esc(e.hash)}. Nothing has run from this manifest.` : 'Never run: this manifest is invalid.'}</p>` : '';
  const cards = {
    'needs-trust': ['Trust this add-in to make only the calls listed under May call? Nothing has run yet.', [b('trust', 'Trust and enable', 'ai-primary', lk), review, b('remove', 'Remove')]],
    changed: ['The file changed after you trusted it. It is disabled until you review it.', [b('trust', 'Trust the change', 'ai-primary', lk), review, b('remove', 'Remove')]],
    broken: [`${esc(e.error)} It is listed but never executed.`, [review, b('remove', 'Remove')]],
    enabled: ['Enabled. Disable or remove it any time.', [b('disable', 'Disable'), review, b('remove', 'Remove')]],
    removed: ['Removed. It never runs.', [b('restore', 'Restore', '', lk)]],
  }[e.state];
  return `<div class="ai-gate ai-gate-${e.state}"><div class="ai-gh">${tile('lock', 20)}<b>${e.state === 'enabled' || e.state === 'removed' ? STATE_LABEL[e.state] : 'Trust gate'}</b></div><p>${cards[0]}</p><div class="ai-btns">${cards[1].join('')}</div>${json}</div>`;
}

function sideHtml(e, runs) {
  const rows = e.manifest ? mayCall(e.manifest) : [{ ok: false, label: 'Everything (invalid manifest)' }];
  const log = runs[e.id] || [];
  const never = e.state === 'broken' ? 'Never run: manifest invalid' : e.state === 'needs-trust' ? 'Never run: not trusted yet' : e.state === 'changed' ? 'Disabled: file hash changed' : e.state === 'removed' ? 'Removed: it never runs' : 'No runs yet';
  return `<div class="ai-blk"><div class="ai-sl">May call</div>${rows.map((r) => `<div class="ai-li"><i class="ai-yn ${r.ok ? 'y' : 'n'}" aria-hidden="true">${r.ok ? '✓' : '✕'}</i><span><span class="ai-sr">${r.ok ? 'Allowed: ' : 'Refused: '}</span>${esc(r.label)}</span></div>`).join('')}</div>
    <div class="ai-blk"><div class="ai-sl">Last runs</div>${log.length ? log.map((r) => `<div class="ai-li"><span class="ai-dim">${esc(r.at.slice(11, 16))}</span><span>${esc(r.text)}</span></div>`).join('') : `<div class="ai-li ai-dim">${never}</div>`}</div>`;
}

/** Pure: model + ui state -> HTML. model = { entries, runs, meeting, error }. */
export function paneHtml(model, ui) {
  const { entries, runs, error } = model;
  const locked = !!model.meeting?.issuedAt;
  const waiting = entries.filter((e) => ['needs-trust', 'changed', 'broken'].includes(e.state)).length;
  const state = error ? 'error' : locked ? 'locked' : waiting ? 'needs' : entries.length ? 'normal' : 'empty';
  const sel = entries.find((e) => e.id === ui.sel);
  const banner = {
    error: `<div class="ai-banner ai-er" role="alert"><span>Could not list add-ins (${esc(error)}). Nothing was run.</span><button type="button" class="mini-btn" data-ai="retry">Retry</button></div>`,
    locked: '<div class="ai-banner ai-lk" role="status"><span>Locked: the open meeting is issued. Trusting is off; Disable and Remove still work.</span></div>',
    needs: `<div class="ai-banner ai-nd" role="status"><span>${waiting} add-in${waiting > 1 ? 's wait' : ' waits'} for trust and ${waiting > 1 ? 'have' : 'has'} not run.</span></div>`,
  }[state] || '';
  const list = SECTIONS.map(([title, pick], i) => {
    const rows = entries.filter(pick);
    if (i === 2 && !rows.length) return '';
    const head = `<div class="ai-sh"><b>${title}</b><span class="ai-count">${rows.length}</span>${i === 1 && rows.length ? '<span class="ai-grow"></span><button type="button" class="ai-lnk" data-ai="archive-all">Archive all</button>' : ''}${i === 2 ? `<span class="ai-grow"></span><button type="button" class="ai-lnk" data-ai="toggle-removed" aria-expanded="${ui.showRemoved}">${ui.showRemoved ? 'Hide' : 'Show'}</button>` : ''}</div>`;
    if (i === 2 && !ui.showRemoved) return head;
    const zero = i === 0 && !rows.length && entries.length ? '<div class="ai-zero"><b>All add-ins reviewed</b><span>Nothing waits on trust. v0 add-ins ship inside the extension.</span></div>' : '';
    return head + rows.map((e) => rowHtml(e, ui)).join('') + zero;
  }).join('');
  const empty = '<div class="ai-zero"><b>No add-ins</b><span>None ships with this build. v0 add-ins are bundled with the extension.</span></div>';
  const detail = sel
    ? `<div class="ai-main"><div class="ai-mh"><h4>${esc(sel.manifest?.name || sel.raw?.name || sel.id)}</h4><span class="ai-pill ai-pill-${sel.state}">${STATE_LABEL[sel.state]}</span></div>${quoteHtml(sel)}${gateHtml(sel, ui, locked)}</div><div class="ai-side">${sideHtml(sel, runs)}</div>`
    : '<div class="ai-main ai-hint">Pick an add-in to see exactly what it may call, and its last runs.</div>';
  const toast = ui.toast ? `<div class="ai-toast" role="status"><span>${esc(ui.toast.text)}</span><button type="button" class="ai-lnk" data-ai="undo">Undo</button></div>` : '';
  return `<div class="ai-wrap" data-state="${state}">${banner}<div class="ai-list">${entries.length ? list : empty}</div>${entries.length ? detail : ''}${toast}</div>`;
}

export function mountAddinsPane(root, { bundled = BUNDLED, getMeetings = listMeetings } = {}) {
  const ui = { sel: '', review: '', showRemoved: false, toast: null };
  let model = { entries: [], runs: {}, meeting: null, error: null };
  let store = { trusted: {}, removed: [] };
  let timer = null;
  const draw = () => {
    root.innerHTML = paneHtml(model, ui);
  };

  async function refresh() {
    try {
      store = await loadStore();
      const meetings = await getMeetings();
      const entries = listAddins(bundled, store.trusted, store.removed);
      model = { entries, runs: store.runs, meeting: meetings[0] || null, error: null };
      if (!entries.some((e) => e.id === ui.sel)) ui.sel = (entries.find((e) => e.state === 'needs-trust') || entries[0])?.id || '';
    } catch (e) {
      model = { entries: [], runs: {}, meeting: null, error: String(e?.message || e) };
    }
    draw();
  }

  async function change(label, mutate) {
    const prev = { trusted: { ...store.trusted }, removed: [...store.removed] };
    const next = { trusted: { ...store.trusted }, removed: [...store.removed] };
    mutate(next);
    await saveTrustState(next.trusted, next.removed);
    ui.toast = { text: label, prev };
    clearTimeout(timer);
    timer = setTimeout(() => {
      ui.toast = null;
      draw();
    }, TOAST_MS);
    await refresh();
  }

  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-ai]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.ai;
    const e = model.entries.find((x) => x.id === btn.dataset.id);
    const locked = !!model.meeting?.issuedAt;
    if (act === 'open') {
      ui.sel = btn.dataset.id;
      ui.review = '';
      draw();
    } else if (act === 'review') {
      ui.review = ui.review === e.id ? '' : e.id;
      draw();
    } else if (act === 'toggle-removed') {
      ui.showRemoved = !ui.showRemoved;
      draw();
    } else if (act === 'retry') {
      await refresh();
    } else if (act === 'trust' && e?.hash && !locked) {
      await change(`“${e.manifest.name}” enabled`, (s) => {
        s.trusted[e.id] = e.hash;
        s.removed = s.removed.filter((x) => x !== e.id);
      });
    } else if (act === 'disable' && e) {
      await change(`“${e.manifest.name}” disabled`, (s) => delete s.trusted[e.id]);
    } else if (act === 'remove' && e) {
      await change(`“${e.manifest?.name || e.id}” removed`, (s) => {
        delete s.trusted[e.id];
        s.removed = [...new Set([...s.removed, e.id])];
      });
    } else if (act === 'restore' && e && !locked) {
      await change(`“${e.manifest?.name || e.id}” restored`, (s) => {
        s.removed = s.removed.filter((x) => x !== e.id);
      });
    } else if (act === 'archive-all') {
      const ids = model.entries.filter((x) => x.state === 'enabled').map((x) => x.id);
      await change(`${ids.length} add-in${ids.length === 1 ? '' : 's'} removed`, (s) => {
        for (const id of ids) delete s.trusted[id];
        s.removed = [...new Set([...s.removed, ...ids])];
      });
    } else if (act === 'undo' && ui.toast) {
      const { prev } = ui.toast;
      ui.toast = null;
      await saveTrustState(prev.trusted, prev.removed);
      await refresh();
    }
  });

  // Another page (or the Notes panel's Settings link) changed the trust store.
  try {
    chrome.storage.onChanged?.addListener((ch) => {
      if (STORE_KEYS.some((k) => k in ch)) refresh();
    });
  } catch {
    /* no storage events in this context: refresh() on tab open still runs */
  }
  return { refresh };
}
