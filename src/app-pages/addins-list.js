/**
 * "Installed add-ins" sebagai baris kartu asli di halaman All features (papan A06) — tanpa bingkai panel.
 *
 * Aturan tetap di lib/addins.js (validasi, hash manifes, trustState, mayCall); penyimpanan kepercayaan memakai
 * kunci yang sama dengan Settings › Add-ins (ysmAddinTrust, ysmAddinRemoved) lewat addins-ui.js, jadi
 * kedua permukaan selalu sepakat. Add-in tak berjalan sebelum manifesnya ditinjau dan dipercaya;
 * rapat terbuka yang sudah terbit mengunci Trust (Disable dan Remove tetap bisa).
 *
 * Kontrak: mountInstalled(root, { getMeetings, lang }) → { refresh, dispose }.
 *   Aksi (data-ia): review, trust, disable, remove, restore, toggle-removed, archive-all, undo, retry.
 *   Kelas: .ia-row[data-id] > .ia-pill (teks status), .ia-btns, .ia-json (tinjauan), .ia-toast.
 */
import { tile } from '../lib/colour-icons.js';
import { listMeetings } from '../lib/notes-store.js';
import { listAddins, mayCall } from '../lib/addins.js';
import { BUNDLED } from '../addins/index.js';
import { loadStore, saveTrustState, tr, STATE_KEY, kindText } from '../addins-ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ID_ICON = { 'recap-email': 'mail', 'due-to-calendar': 'calendar', glossary: 'book' };
const iconOf = (e) => (e.state === 'broken' ? 'warn' : e.state === 'changed' ? 'diff' : ID_ICON[e.id] || (e.manifest?.panels?.length && !e.manifest?.actions?.length ? 'pages' : 'bolt'));
const TOAST_MS = 8000;

function rowHtml(e, ui, locked, T) {
  const name = e.manifest?.name || String(e.raw?.name || e.id);
  const b = (act, label, cls = '', dis = false) => `<button type="button" class="${cls || 'btn sm'}" data-ia="${act}" data-id="${esc(e.id)}"${dis ? ' disabled' : ''}>${esc(label)}</button>`;
  const review = b('review', e.state === 'broken' ? T('aiOpenError') : T('aiReview'), 'btn sm').replace('<button', `<button aria-expanded="${ui.review === e.id}"`);
  const remove = b('remove', T('aiRemove'), 'btn sm danger');
  const buttons = {
    'needs-trust': [b('trust', T('aiTrustEnable'), 'pill-b sm', locked), review, remove],
    changed: [b('trust', T('aiTrustChange'), 'pill-b sm', locked), review, remove],
    broken: [review, remove],
    enabled: [b('disable', T('aiDisable'), 'btn sm'), review, remove],
    removed: [b('restore', T('aiRestore'), 'btn sm', locked)],
  }[e.state];
  const may = e.manifest ? mayCall(e.manifest).filter((r) => r.ok).map((r) => r.label).join(' · ') : '';
  const sub = e.state === 'broken' ? esc(e.error) : esc(e.manifest?.description || kindText(e, T));
  const json = ui.review === e.id ? `<pre class="ia-json">${esc(JSON.stringify(e.raw, null, 2))}</pre><p class="mut small">${e.hash ? T('aiHashNote', esc(e.hash)) : T('aiInvalidNote')}</p>` : '';
  return `<div class="ia-row" data-id="${esc(e.id)}" data-state="${e.state}">
    <span class="ia-top">${tile(iconOf(e), 30)}<span class="ia-tt"><b>${esc(name)}</b> <span class="ia-pill ${e.state}">${esc(T(STATE_KEY[e.state]))}</span><small>${sub}</small>${may ? `<small class="ia-may">${esc(T('aiMayCall'))}: ${esc(may)}</small>` : ''}</span><span class="ia-btns">${buttons.join('')}</span></span>${json}</div>`;
}

/** Murni: model + keadaan UI → HTML. model = { entries, meeting, error }. */
export function installedHtml(model, ui, T) {
  const { entries, error } = model;
  const locked = !!model.meeting?.issuedAt;
  if (error) return `<div class="callout danger" role="alert"><div><b>${esc(T('aiListError', error))}</b><p><button type="button" class="btn sm" data-ia="retry">${esc(T('aiRetry'))}</button></p></div></div>`;
  if (!entries.length) return `<div class="ia-zero"><b>${esc(T('aiNone'))}</b><span class="mut">${esc(T('aiNoneHint'))}</span></div>`;
  const waiting = entries.filter((e) => ['needs-trust', 'changed', 'broken'].includes(e.state)).length;
  const live = entries.filter((e) => e.state !== 'removed');
  const removed = entries.filter((e) => e.state === 'removed');
  const enabled = entries.filter((e) => e.state === 'enabled').length;
  const banner = locked ? `<div class="callout warn" role="status"><div>${esc(T('aiLocked'))}</div></div>` : waiting ? `<div class="callout locked" role="status"><div>${esc(T('aiWaiting', waiting))}</div></div>` : '';
  const head = `<div class="ia-head">${enabled ? `<button type="button" class="ia-lnk" data-ia="archive-all">${esc(T('aiArchiveAll'))}</button>` : ''}</div>`;
  const removedBlock = removed.length ? `<div class="ia-rm"><button type="button" class="ia-lnk" data-ia="toggle-removed" aria-expanded="${ui.showRemoved}">${esc(T('aiStRemoved'))} · ${removed.length}</button>${ui.showRemoved ? removed.map((e) => rowHtml(e, ui, locked, T)).join('') : ''}</div>` : '';
  const toast = ui.toast ? `<div class="ia-toast" role="status"><span>${esc(ui.toast.text)}</span><button type="button" class="ia-lnk" data-ia="undo">${esc(T('aiUndo'))}</button></div>` : '';
  return `${banner}${head}${live.map((e) => rowHtml(e, ui, locked, T)).join('')}${removedBlock}${toast}`;
}

export function mountInstalled(root, { getMeetings = listMeetings, lang = () => 'en', bundled = BUNDLED } = {}) {
  const ui = { review: '', showRemoved: false, toast: null };
  const T = (key, ...args) => tr(lang(), key, ...args);
  let model = { entries: [], meeting: null, error: null };
  let store = { trusted: {}, removed: [] };
  let timer = null; let alive = true;
  const draw = () => { if (alive) root.innerHTML = installedHtml(model, ui, T); };

  async function refresh() {
    try {
      store = await loadStore();
      const meetings = await getMeetings();
      model = { entries: listAddins(bundled, store.trusted, store.removed), meeting: meetings[0] || null, error: null };
    } catch (e) {
      model = { entries: [], meeting: null, error: String(e?.message || e) };
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
    timer = setTimeout(() => { ui.toast = null; draw(); }, TOAST_MS);
    await refresh();
  }

  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-ia]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.ia;
    const e = model.entries.find((x) => x.id === btn.dataset.id);
    const locked = !!model.meeting?.issuedAt;
    const name = e?.manifest?.name || e?.id;
    if (act === 'review' && e) { ui.review = ui.review === e.id ? '' : e.id; draw(); }
    else if (act === 'toggle-removed') { ui.showRemoved = !ui.showRemoved; draw(); }
    else if (act === 'retry') await refresh();
    else if (act === 'trust' && e?.hash && !locked) await change(T('aiToastEnabled', name), (s) => { s.trusted[e.id] = e.hash; s.removed = s.removed.filter((x) => x !== e.id); });
    else if (act === 'disable' && e) await change(T('aiToastDisabled', name), (s) => { delete s.trusted[e.id]; });
    else if (act === 'remove' && e) await change(T('aiToastRemoved', name), (s) => { delete s.trusted[e.id]; s.removed = [...new Set([...s.removed, e.id])]; });
    else if (act === 'restore' && e && !locked) await change(T('aiToastRestored', name), (s) => { s.removed = s.removed.filter((x) => x !== e.id); });
    else if (act === 'archive-all') {
      const ids = model.entries.filter((x) => x.state === 'enabled').map((x) => x.id);
      await change(T('aiToastArchived', ids.length), (s) => { for (const id of ids) delete s.trusted[id]; s.removed = [...new Set([...s.removed, ...ids])]; });
    } else if (act === 'undo' && ui.toast) {
      const { prev } = ui.toast;
      ui.toast = null;
      await saveTrustState(prev.trusted, prev.removed);
      await refresh();
    }
  });

  // Another surface (Settings › Add-ins, a tile switch) changed the trust store.
  const onChanged = (ch) => { if ('ysmAddinTrust' in ch || 'ysmAddinRemoved' in ch) refresh(); };
  try { globalThis.chrome?.storage?.onChanged?.addListener(onChanged); } catch { /* no storage events */ }
  refresh();
  return { refresh, dispose() { alive = false; clearTimeout(timer); try { globalThis.chrome?.storage?.onChanged?.removeListener?.(onChanged); } catch { /* ignore */ } } };
}
