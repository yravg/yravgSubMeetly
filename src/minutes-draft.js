/**
 * "End & draft" dengan pilihan (board T03): tiga draf dari baris transkrip yang
 * sama — Short, Full, Bilingual — dibandingkan, dipilih, di-Diff terhadap
 * register, lalu ditulis lewat addItem/editItem (src/lib/draft-options.js).
 *
 * Panel overlay seperti Library/Training: dipasang sekali dari minutes.js dan
 * menggambar dirinya sendiri. Semua lokal — tanpa jaringan, tanpa model.
 * Sumber baris: transkrip pustaka rapat itu bila ada, kalau tidak dirangkai
 * dari kutipan sumber (src.orig) butir yang sudah ada.
 */
import { buildTranscript } from './lib/sample-library.js';
import { buildDraftVariants, diffDraft, applyChanges } from './lib/draft-options.js';
import { tile, TILE_CSS } from '../docs/design/submeetly-canvas/icons/colour-icons.mjs';

const STR = {
  btn: { en: 'Draft options', id: 'Opsi draf' },
  title: { en: 'Draft options', id: 'Opsi draf' },
  close: { en: 'Close', id: 'Tutup' },
  compare: { en: 'Compare', id: 'Bandingkan' },
  diff: { en: 'Diff', id: 'Diff' },
  draft: { en: (k) => `Draft ${k}`, id: (k) => `Draf ${k}` },
  suggested: { en: 'Suggested', id: 'Disarankan' },
  pick: { en: 'Pick', id: 'Pilih' },
  picked: { en: 'Picked', id: 'Dipilih' },
  note: { en: 'Note for this draft', id: 'Catatan untuk draf ini' },
  none: { en: 'None of these', id: 'Tidak satu pun' },
  noneHint: { en: 'Tell me what is missing, e.g. "shorter, owners first".', id: 'Tulis kekurangannya, mis. "lebih pendek, pemilik dulu".' },
  regenAll: { en: 'Regenerate all', id: 'Buat ulang semua' },
  regenWith: { en: 'Regenerate with my note', id: 'Buat ulang dengan catatan' },
  regen: { en: 'Regenerate', id: 'Buat ulang' },
  use: { en: 'Use picked draft', id: 'Pakai draf terpilih' },
  usePick: { en: (k) => `Use draft ${k}`, id: (k) => `Pakai draf ${k}` },
  discard: { en: 'Discard drafts', id: 'Buang draf' },
  read: { en: 'Read', id: 'Baca' },
  edit: { en: 'Edit', id: 'Ubah' },
  accept: { en: 'Accept', id: 'Terima' },
  reject: { en: 'Reject', id: 'Tolak' },
  retry: { en: 'Retry', id: 'Coba lagi' },
  add: { en: 'New', id: 'Baru' },
  change: { en: 'Changed', id: 'Berubah' },
  dup: { en: 'Duplicate', id: 'Duplikat' },
  dupNote: { en: (r) => `Already in register as ${r} — skipped`, id: (r) => `Sudah ada di register sebagai ${r} — dilewati` },
  empty: { en: 'No transcript for this meeting. Record or import a session, then draft.', id: 'Rapat ini belum punya transkrip. Rekam atau impor sesi dulu, lalu buat draf.' },
  locked: { en: 'Issued — read-only. Create an amendment to change it.', id: 'Sudah diterbitkan — hanya baca. Buat amandemen untuk mengubahnya.' },
  needPair: { en: 'Bilingual needs a language pair.', id: 'Bilingual butuh pasangan bahasa.' },
  needTr: { en: 'This transcript has no translated lines.', id: 'Transkrip ini tidak punya baris terjemahan.' },
  pair: { en: 'Language pair', id: 'Pasangan bahasa' },
  apply: { en: 'Apply', id: 'Terapkan' },
  failed: { en: (e) => `Could not build this draft: ${e}`, id: (e) => `Draf ini gagal dibuat: ${e}` },
  noEffect: { en: 'Offline drafts only understand "shorter" and "owners first". Nothing changed.', id: 'Draf offline hanya paham "shorter" dan "owners first". Tidak ada yang berubah.' },
  nothing: { en: 'Nothing to write.', id: 'Tidak ada yang ditulis.' },
  wrote: { en: (a, e, s) => `Wrote ${a} new, ${e} changed · ${s} duplicate${s === 1 ? '' : 's'} skipped`, id: (a, e, s) => `Ditulis ${a} baru, ${e} diubah · ${s} duplikat dilewati` },
  onDevice: { en: 'On-device', id: 'Di perangkat' },
  noItems: { en: 'No items detected.', id: 'Tidak ada butir terdeteksi.' },
  include: { en: 'Include', id: 'Ikutkan' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (s) => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
const PAIRS = [{ src: 'en', tgt: 'id' }, { src: 'id', tgt: 'en' }];
const pairKey = (p) => (p ? `${p.src}-${p.tgt}` : '');
const ORIGIN_LABEL = { 'this meeting': "Source: this meeting's transcript", 'sample-library': 'Source: sample library', register: 'Source: register quotes' };
const TYPE_LABEL = { decision: 'Decision', action: 'Action', risk: 'Risk', question: 'Question', info: 'Info', metric: 'Metric' };

/** Baris sesi untuk satu rapat + pasangan bahasa bawaan (hanya bila baris memuat terjemahan). */
export function linesForMeeting(m) {
  // The meeting's own spoken lines (written by End & draft) come first.
  if (m.transcript?.length) {
    const lines = m.transcript.map((l) => ({ ...l, text: l.source }));
    const other = m.locale === 'en' ? 'id' : m.locale === 'id' ? 'en' : null;
    const withTr = other && lines.some((l) => l.translation);
    return { lines, pair: withTr ? { src: m.locale, tgt: other } : null, origin: 'this meeting' };
  }
  try {
    const tr = buildTranscript(m.id);
    if (tr?.lines?.length) {
      const other = tr.locale === 'en' ? 'id' : 'en';
      const withTr = tr.lines.some((l) => l.translation);
      return { lines: tr.lines, pair: withTr ? { src: tr.locale, tgt: other } : null, origin: 'sample-library' };
    }
  } catch { /* bukan transkrip pustaka */ }
  const seen = new Set();
  const lines = [];
  for (const it of m.items || []) {
    const s = it.src;
    if (!s?.orig || seen.has(`${s.t0}|${s.orig}`)) continue;
    seen.add(`${s.t0}|${s.orig}`);
    lines.push({ t0: s.t0 || 0, t1: s.t1 || (s.t0 || 0) + 5, speaker: s.speaker || '', source: s.orig, text: s.orig });
  }
  lines.sort((a, b) => a.t0 - b.t0);
  return { lines, pair: null, origin: m.engine?.asr || 'register' };
}

/**
 * @param {object} ctx
 * @param {() => string} ctx.lang
 * @param {() => any} ctx.activeMeeting
 * @param {(m:any) => void} ctx.replaceActive
 * @param {(m:any) => Promise<any>} ctx.save
 * @param {() => string} ctx.me
 * @param {() => void} ctx.paint
 * @param {(msg:string, bad?:boolean) => void} ctx.toast
 */
export function mountDraftOptions(ctx) {
  const tx = (k, ...a) => { const e = STR[k]; const v = e[ctx.lang()] ?? e.en; return typeof v === 'function' ? v(...a) : v; };

  if (!document.getElementById('do-tile-css')) {
    const st = document.createElement('style');
    st.id = 'do-tile-css';
    st.textContent = TILE_CSS;
    document.head.appendChild(st);
  }

  const appbar = document.querySelector('.appbar');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn sm collapsible';
  btn.id = 'btn-draft';
  btn.setAttribute('data-tour', 'btn-draft');
  (appbar?.querySelector('.lt-appbar-btns') || appbar?.querySelector('#m-switch'))?.insertAdjacentElement(appbar.querySelector('.lt-appbar-btns') ? 'afterbegin' : 'beforebegin', btn);

  const ov = document.createElement('div');
  ov.className = 'lt-overlay do-ov';
  ov.hidden = true;
  ov.innerHTML = '<div class="lt-panel do-panel" role="dialog" aria-modal="true" aria-labelledby="do-title"></div>';
  (document.querySelector('.app') || document.body).appendChild(ov);
  const panel = ov.firstElementChild;

  /** @type {null|object} */
  let S = null;

  function open() {
    const m = ctx.activeMeeting();
    if (!m) { ctx.toast(tx('empty'), true); return; }
    const src = linesForMeeting(m);
    S = {
      id: m.id, src, pair: src.pair, tab: 'compare', pick: null, notes: {}, none: false, reply: '',
      include: {}, mode: {}, edits: {}, decisions: {}, msg: '', set: null,
    };
    build();
    ov.hidden = false;
    paint();
    panel.querySelector('[data-act="close"]')?.focus();
  }
  function close() { ov.hidden = true; S = null; }

  function build(only, hint) {
    const m = ctx.activeMeeting();
    const r = buildDraftVariants(S.src.lines, { locale: m.locale || 'en', title: m.title, pair: S.pair, hint: hint ?? S.set?.hint?.text }, only ? { only } : {});
    if (only && S.set) {
      const next = r.drafts[0];
      S.set.drafts = S.set.drafts.map((d) => (d.key === only ? next : d));
      resetDraftState(only);
    } else {
      S.set = r;
      ['a', 'b', 'c'].forEach(resetDraftState);
      if (!S.pick || !r.drafts.some((d) => d.key === S.pick && d.status === 'ready')) S.pick = null;
    }
  }
  function resetDraftState(k) {
    const d = S.set.drafts.find((x) => x.key === k);
    S.include[k] = new Set((d?.items || []).map((i) => i.id));
    S.edits[k] = {};
    S.decisions = {};
  }

  const draftOf = (k) => S.set.drafts.find((d) => d.key === k);
  /** Draf dengan ubahan manual diterapkan. */
  const effective = (d) => ({ ...d, items: d.items.map((i) => (S.edits[d.key]?.[i.id] != null ? { ...i, text: S.edits[d.key][i.id] } : i)) });
  const diffFor = (k) => {
    const m = ctx.activeMeeting();
    return diffDraft(m, effective(draftOf(k)), S.include[k]);
  };

  /* ------------------------------------------------------------- paint */

  function paint() {
    if (!S) return;
    const m = ctx.activeMeeting();
    const locked = !!m?.issuedAt;
    const ready = (S.set?.drafts || []).filter((d) => d.status === 'ready');
    const target = S.pick || null;
    let primary = '';
    if (S.none) primary = `<button type="button" class="btn primary" data-act="regen-all" ${S.reply.trim() ? '' : 'disabled'}>${esc(tx('regenWith'))}</button>`;
    else primary = `<button type="button" class="btn primary" data-act="use" ${(!target || locked) ? 'disabled' : ''}>${esc(target ? tx('usePick', target.toUpperCase()) : tx('use'))}</button>`;

    const tabs = [['compare', tx('compare'), 'compare']];
    if (!S.set.empty) {
      S.set.drafts.forEach((d) => tabs.push([d.key, tx('draft', d.key.toUpperCase()), 'draft']));
      tabs.push(['diff', tx('diff'), 'diff']);
    }
    panel.innerHTML = `
      <div class="lt-head do-head">
        ${tile('draft', 28)}
        <h2 id="do-title">${esc(tx('title'))}</h2>
        <span class="pill ondevice">${esc(tx('onDevice'))}</span>
        <span class="spacer"></span>
        ${S.set.empty ? '' : primary}
        <button type="button" class="btn sm" data-act="close">✕ ${esc(tx('close'))}</button>
      </div>
      ${S.set.empty ? '' : `<div class="do-src">${sourceStrip()}</div>`}
      ${locked ? `<div class="do-bar lock" role="status">${tile('lock', 22)}<span>${esc(tx('locked'))}</span></div>` : ''}
      <div class="do-tabs" role="tablist">${tabs.map(([k, label, ic]) => `<button type="button" role="tab" data-act="tab" data-tab="${k}" aria-selected="${S.tab === k}">${tile(ic, 20)}<span>${esc(label)}</span></button>`).join('')}</div>
      <div class="lt-body do-body" id="do-body">${S.set.empty ? emptyBox() : body(m, locked)}</div>
      ${S.set.empty ? '' : `<div class="do-foot">
        <button type="button" class="btn sm" data-act="discard">${esc(tx('discard'))}</button>
        <span class="muted2 do-msg" role="status">${esc(S.msg)}</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm" data-act="regen-all" ${ready.length || S.set.drafts.length ? '' : 'disabled'}>${tile('captions', 18, 'n')} ${esc(tx('regenAll'))}</button>
      </div>`}`;
  }

  function emptyBox() {
    return `<div class="do-emp">${tile('captions', 36, 'n')}<p>${esc(tx('empty'))}</p></div>`;
  }

  function sourceStrip() {
    const ls = S.src.lines;
    const p = S.pair;
    return `<span class="do-chip">${ls.length} ${ls.length === 1 ? 'segment' : 'segments'}</span><span class="do-chip">${mmss(ls[0]?.t0)}–${mmss(ls[ls.length - 1]?.t1)}</span>${p ? `<span class="do-chip">${esc(p.src)} to ${esc(p.tgt)}</span>` : ''}<span class="do-chip" title="Where the draft lines come from">${esc(ORIGIN_LABEL[S.src.origin] || S.src.origin)}</span>`;
  }

  function body(m, locked) {
    if (S.tab === 'compare') return compare(locked);
    if (S.tab === 'diff') return diffView(m, locked);
    return draftTab(S.tab, locked);
  }

  function typeDot(t) { return `<i class="do-dot t-${esc(t)}" title="${esc(TYPE_LABEL[t] || t)}"></i>`; }

  function lane(d) {
    const sug = S.set.suggested?.key === d.key;
    const picked = S.pick === d.key;
    let inner;
    if (d.status === 'need') {
      inner = `<div class="do-bar need" role="status">${tile('languages', 22)}<div><b>${esc(d.need === 'pair' ? tx('needPair') : tx('needTr'))}</b>${d.need === 'pair' ? `<div class="do-pairrow"><label class="muted2" for="do-pair">${esc(tx('pair'))}</label><select id="do-pair" data-act="pair">${PAIRS.map((p) => `<option value="${pairKey(p)}" ${pairKey(S.pair) === pairKey(p) ? 'selected' : ''}>${p.src} → ${p.tgt}</option>`).join('')}</select><button type="button" class="btn sm" data-act="apply-pair">${esc(tx('apply'))}</button></div>` : ''}</div></div>`;
    } else if (d.status === 'error') {
      inner = `<div class="do-bar err" role="alert">${tile('warn', 22)}<div><b>${esc(tx('failed', d.error))}</b><div><button type="button" class="btn sm" data-act="retry" data-key="${d.key}">${esc(tx('retry'))}</button></div></div></div>`;
    } else {
      const items = d.items.slice(0, 5);
      inner = `<ul class="do-items">${items.map((i) => `<li>${typeDot(i.type)}<span>${esc(i.text)}</span></li>`).join('') || `<li class="muted2">${esc(tx('noItems'))}</li>`}</ul>${d.items.length > 5 ? `<div class="muted2 do-more">+${d.items.length - 5}</div>` : ''}`;
    }
    const usable = d.status === 'ready';
    return `<section class="do-lane${picked ? ' picked' : ''}${sug ? ' best' : ''}" data-key="${d.key}">
      <header>${tile(d.key === 'c' ? 'languages' : d.key === 'a' ? 'pick' : 'draft', 28)}<div><b>${esc(tx('draft', d.key.toUpperCase()))} · ${esc(d.name)}</b><div class="muted2">${esc(d.sub)}</div></div>${sug && usable ? `<span class="do-sug">${esc(tx('suggested'))}</span>` : ''}</header>
      ${sug && usable ? `<p class="do-why">${esc(S.set.suggested.reason)}</p>` : ''}
      <div class="muted2 do-meta">${esc(d.meta || '')}</div>
      ${inner}
      <footer>
        <button type="button" class="btn sm${picked ? ' primary' : ''}" data-act="pick" data-key="${d.key}" aria-pressed="${picked}" ${usable ? '' : 'disabled'}>${esc(picked ? tx('picked') : tx('pick'))}</button>
        <input type="text" class="do-note" data-act="note" data-key="${d.key}" placeholder="${esc(tx('note'))}" value="${esc(S.notes[d.key] || '')}" aria-label="${esc(tx('note'))} ${d.key.toUpperCase()}" ${usable ? '' : 'disabled'}>
      </footer>
    </section>`;
  }

  function compare() {
    return `<div class="do-lanes">${S.set.drafts.map(lane).join('')}</div>
      <div class="do-none${S.none ? ' on' : ''}">
        <button type="button" class="btn sm" data-act="none" aria-pressed="${S.none}">${esc(tx('none'))}</button>
        ${S.none ? `<input type="text" class="do-note wide" data-act="reply" placeholder="${esc(tx('noneHint'))}" value="${esc(S.reply)}" aria-label="${esc(tx('none'))}">` : ''}
      </div>`;
  }

  function draftTab(k, locked) {
    const d = draftOf(k);
    if (!d) return '';
    if (d.status !== 'ready') return `<div class="do-lanes one">${lane(d)}</div>`;
    const edit = S.mode[k] === 'edit';
    const sel = S.include[k];
    return `<div class="do-dtools">
        <div class="lt-tabs" role="group"><button type="button" data-act="mode" data-mode="read" aria-selected="${!edit}">${esc(tx('read'))}</button><button type="button" data-act="mode" data-mode="edit" aria-selected="${edit}" ${locked ? 'disabled' : ''}>${esc(tx('edit'))}</button></div>
        <span class="muted2">${esc(d.meta)}</span><span class="spacer"></span>
        <button type="button" class="btn sm" data-act="retry" data-key="${k}">${esc(tx('regen'))}</button>
      </div>
      <ul class="do-dlist">${effective(d).items.map((i) => `<li>
        <input type="checkbox" class="cbx" data-act="inc" data-id="${i.id}" ${sel.has(i.id) ? 'checked' : ''} aria-label="${esc(tx('include'))} ${esc(i.text)}">
        <span class="do-type">${typeDot(i.type)}${esc(TYPE_LABEL[i.type] || i.type)}</span>
        ${edit ? `<textarea class="do-edt" rows="2" data-act="edit" data-id="${i.id}">${esc(i.text)}</textarea>` : `<span class="do-txt">${esc(i.text)}</span>`}
        ${i.owner ? `<span class="muted2">${esc(i.owner)}</span>` : ''}
      </li>`).join('')}</ul>`;
  }

  function diffView(m, locked) {
    const k = S.pick || S.set.suggested?.key;
    const d = k && draftOf(k);
    if (!d || d.status !== 'ready') return `<div class="do-emp">${tile('diff', 36, 'n')}<p>${esc(tx('pick'))}</p></div>`;
    const df = diffFor(k);
    const rows = df.changes.map((c) => {
      const dec = S.decisions[c.id] || '';
      const acts = c.kind === 'dup' ? '' : `<span class="do-acts"><button type="button" class="btn sm${dec === 'accept' ? ' primary' : ''}" data-act="decide" data-id="${c.id}" data-d="accept" aria-pressed="${dec === 'accept'}" ${locked ? 'disabled' : ''}>${esc(tx('accept'))}</button><button type="button" class="btn sm${dec === 'reject' ? ' danger' : ''}" data-act="decide" data-id="${c.id}" data-d="reject" aria-pressed="${dec === 'reject'}" ${locked ? 'disabled' : ''}>${esc(tx('reject'))}</button></span>`;
      const txt = c.kind === 'change'
        ? c.parts.map((p) => (p.t === 'del' ? `<del>${esc(p.s)}</del>` : p.t === 'ins' ? `<ins>${esc(p.s)}</ins>` : esc(p.s))).join('')
        : esc(c.text);
      const lab = c.kind === 'add' ? tx('add') : c.kind === 'change' ? `${tx('change')} ${c.ref}` : tx('dup');
      return `<li class="do-drow k-${c.kind}">${typeDot(c.type)}<span class="do-klabel">${esc(lab)}</span><span class="do-txt">${txt}${c.kind === 'dup' ? `<span class="muted2"> — ${esc(tx('dupNote', c.ref))}</span>` : ''}</span>${acts}</li>`;
    }).join('');
    return `<div class="do-dtools"><span class="do-chip">${df.counts.add} ${esc(tx('add'))}</span><span class="do-chip">${df.counts.change} ${esc(tx('change'))}</span><span class="do-chip">${df.counts.dup} ${esc(tx('dup'))}</span><span class="spacer"></span><span class="muted2">${esc(tx('draft', k.toUpperCase()))} · ${esc(d.name)}</span></div>
      <ul class="do-dlist diff">${rows || `<li class="muted2">${esc(tx('noItems'))}</li>`}</ul>`;
  }

  /* ----------------------------------------------------------- actions */

  async function commit(undecided) {
    const k = S.pick || (S.tab !== 'compare' && S.tab !== 'diff' ? S.tab : null);
    if (!k) return;
    const m = ctx.activeMeeting();
    if (m.issuedAt) { S.msg = tx('locked'); paint(); return; }
    const df = diffFor(k);
    let out;
    try {
      out = applyChanges(m, df.changes, S.decisions, { note: S.notes[k] || '', by: ctx.me() || 'local', undecided });
    } catch (e) { S.msg = e.message; paint(); return; }
    if (!out.added && !out.edited) { S.msg = out.skipped ? tx('wrote', 0, 0, out.skipped) : tx('nothing'); paint(); return; }
    const saved = (await ctx.save(out.meeting)) || out.meeting;
    ctx.replaceActive(saved && typeof saved === 'object' ? saved : out.meeting);
    ctx.paint();
    ctx.toast(tx('wrote', out.added, out.edited, out.skipped));
    close();
  }

  function regenAll() {
    const hint = S.none ? S.reply : S.set?.hint?.text;
    build(null, hint);
    if (hint && !S.set.hint?.applied.length) S.msg = tx('noEffect');
    else S.msg = '';
    paint();
  }

  btn.addEventListener('click', open);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) close(); });

  panel.addEventListener('click', (e) => {
    if (!S) return;
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const a = el.dataset.act;
    if (a === 'close' || a === 'discard') return close();
    if (a === 'tab') { S.tab = el.dataset.tab; S.msg = ''; return paint(); }
    if (a === 'pick') { S.pick = S.pick === el.dataset.key ? null : el.dataset.key; S.none = false; S.decisions = {}; return paint(); }
    if (a === 'none') { S.none = !S.none; if (S.none) S.pick = null; return paint(); }
    if (a === 'use') return commit('accept');
    if (a === 'regen-all') return regenAll();
    if (a === 'retry') { build(el.dataset.key, S.set?.hint?.text); return paint(); }
    if (a === 'mode') { S.mode[S.tab] = el.dataset.mode; return paint(); }
    if (a === 'decide') { const id = el.dataset.id; S.decisions[id] = S.decisions[id] === el.dataset.d ? '' : el.dataset.d; return paint(); }
    if (a === 'apply-pair') {
      const v = panel.querySelector('#do-pair')?.value;
      S.pair = PAIRS.find((p) => pairKey(p) === v) || S.pair;
      build();
      return paint();
    }
  });
  panel.addEventListener('change', (e) => {
    if (!S) return;
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'inc') {
      const set = S.include[S.tab];
      if (el.checked) set.add(el.dataset.id); else set.delete(el.dataset.id);
    }
  });
  // Ketikan ditangkap tanpa menggambar ulang, supaya fokus kolom tidak hilang.
  panel.addEventListener('input', (e) => {
    if (!S) return;
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'note') S.notes[el.dataset.key] = el.value;
    if (el.dataset.act === 'reply') {
      S.reply = el.value;
      const b = panel.querySelector('.do-head [data-act="regen-all"]');
      if (b) b.disabled = !el.value.trim();
    }
    if (el.dataset.act === 'edit') S.edits[S.tab][el.dataset.id] = el.value;
  });

  const label = () => { btn.innerHTML = `${tile('draft', 18)} <span>${esc(tx('btn'))}</span>`; btn.title = tx('btn'); };
  label();
  document.addEventListener('ysm-lang', () => { label(); if (S) paint(); });
  return { open, close, relabel: label, isOpen: () => !ov.hidden };
}
