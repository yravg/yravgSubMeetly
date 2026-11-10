/**
 * Papan A07 "Settings and Helper" (TIDE-011) — tata letak halaman shell.
 *
 * Dipanggil sidepanel.js saat panel dipasang shell (?view=settings&shell=1).
 * Pengaturan memakai tampilan Settings panel yang sudah ada (tab General, Engine,
 * Models, Output, Add-ins, About; setiap kendali dan penyimpanannya tetap kode panel).
 * Yang ditambahkan papan: tab Helper — kartu status Native Helper, panduan pasang +
 * pemecahan masalah, dan perangkat komputasi dipindah dari tampilan Helper panel —
 * serta Back di samping pencarian, tab bergaris-bawah, dan (di ekstensi) baris
 * Developer yang dulu berupa kartu di luar bingkai.
 *
 *   api = { lang(): 'en'|'id', hosted: bool, setTab(tab) }
 */
const STR = {
  en: {
    helper: 'Helper', developer: 'Developer', developerHint: 'Lab tools in the sidebar', back: 'Back',
    language: 'Language', languageHint: 'Interface language', appearance: 'Appearance', theme: 'Theme', accent: 'Accent', accentHint: 'Translation colour',
    fontSize: 'Font size', density: 'Density and dock motion', densityHint: 'Review, Reading, Compact',
    review: 'Review', reading: 'Reading', compact: 'Compact',
    engine: 'Engine', engineHint: 'Where captions are made', device: 'Device', deviceHint: 'Helper compute',
    browserEngine: 'Browser engine', browserEngineHint: 'Used when the helper is off', modelSource: 'Model source', quality: 'Quality',
    exportFolder: 'Export folder', exportFolderHint: 'Where files are saved', showOn: 'Captions show on', showOnHint: 'Page overlay, Island or Both',
    computeLink: 'Helper status and install steps live on the Helper tab',
  },
  id: {
    helper: 'Helper', developer: 'Developer', developerHint: 'Alat lab di sidebar', back: 'Kembali',
    language: 'Bahasa', languageHint: 'Bahasa antarmuka', appearance: 'Tampilan', theme: 'Tema', accent: 'Aksen', accentHint: 'Warna terjemahan',
    fontSize: 'Ukuran huruf', density: 'Kepadatan dan gerak dok', densityHint: 'Review, Reading, Compact',
    review: 'Review', reading: 'Reading', compact: 'Compact',
    engine: 'Mesin', engineHint: 'Tempat teks dibuat', device: 'Perangkat', deviceHint: 'Komputasi helper',
    browserEngine: 'Mesin peramban', browserEngineHint: 'Dipakai saat helper mati', modelSource: 'Sumber model', quality: 'Kualitas',
    exportFolder: 'Folder ekspor', exportFolderHint: 'Tempat berkas disimpan', showOn: 'Teks tampil di', showOnHint: 'Overlay halaman, Island atau Keduanya',
    computeLink: 'Status helper dan langkah pasang ada di tab Helper',
  },
};
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function mountSettingsLayout(api) {
  const $ = (id) => document.getElementById(id);
  const T = (k) => STR[api.lang() === 'id' ? 'id' : 'en'][k] ?? STR.en[k] ?? k;
  document.documentElement.dataset.reskin = 'tide';
  const modal = $('settings-modal');
  if (!modal || $('set-shell')) return;
  modal.id === 'settings-modal' && modal.classList.add('set-shell');
  const marker = el('i'); marker.id = 'set-shell'; marker.hidden = true; modal.append(marker);

  /* ---- Helper tab + pane: the old Helper view's cards move in ---- */
  const tabs = $('settings-tabs');
  const about = tabs.querySelector('[data-stab="about"]');
  const tab = el('button'); tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.dataset.stab = 'helper'; tab.setAttribute('aria-selected', 'false');
  tabs.insertBefore(tab, about);
  const pane = el('section', 'set-card'); pane.dataset.pane = 'helper';
  if ($('helper-status-card')) pane.append($('helper-status-card'));
  modal.querySelector('[data-pane="about"]').before(pane);
  tab.addEventListener('click', () => api.setTab('helper')); // the panel's own tab click handlers cover the others


  /* ---- Rows as drawn on A07: label + hint left, control right; existing rows and controls move, none are removed ---- */
  const rowOf = (node) => node?.closest('.setting-row');
  // Relabel a row and give it a hint; keys come from STR so a language change repaints them.
  const decorate = (rowEl, lbl, hint) => {
    if (!rowEl) return;
    const lab = rowEl.querySelector(':scope > label');
    if (lab) { if (lbl) { lab.removeAttribute('data-i18n'); lab.dataset.set = lbl; } lab.classList.add('set-lbl'); }
    if (hint) { rowEl.querySelector(':scope > .set-hint')?.remove(); const h = el('small', 'set-hint'); h.dataset.set = hint; (lab || rowEl).after(h); }
  };
  const newRow = (lbl, hint, control) => { const r = el('div', 'setting-row'); r.append(el('label', 'set-lbl'), ...(hint ? [el('small', 'set-hint')] : []), ...(control ? [control] : [])); r.querySelector('label').dataset.set = lbl; if (hint) r.querySelector('.set-hint').dataset.set = hint; return r; };
  const gen = modal.querySelector('[data-pane="general"]'); const eng = modal.querySelector('[data-pane="engine"]');
  const langRow = rowOf($('ui-lang-toggle')); decorate(langRow, 'language', 'languageHint');
  const themeRow = rowOf($('theme-toggle')); decorate(themeRow, 'appearance');
  const reskinCol = $('reskin-toggle')?.closest('.setting-col');
  const reskinRow = newRow('theme', null, $('reskin-toggle'));
  const tcolorRow = rowOf($('tcolor-toggle')); decorate(tcolorRow, 'accent', 'accentHint');
  for (const b of document.querySelectorAll('#tcolor-toggle button')) b.insertAdjacentText('beforeend', b.getAttribute('aria-label') || '');
  const fontRow = rowOf($('font-size')); decorate(fontRow, 'fontSize');
  const fontVal = el('small', 'set-hint set-font-val'); fontRow?.querySelector('label').after(fontVal);
  const paintFont = () => { fontVal.textContent = `${$('font-size').value} px`; };
  $('font-size')?.addEventListener('input', paintFont); paintFont();
  // Density: the Minutes Modern row density (same localStorage key minutes.js reads).
  const dens = el('div', 'seg'); dens.id = 'set-density'; dens.setAttribute('role', 'group');
  const curDens = () => { try { const v = localStorage.getItem('ysmRowDensity'); return ['review', 'reading', 'compact'].includes(v) ? v : 'reading'; } catch { return 'reading'; } };
  for (const d of ['review', 'reading', 'compact']) { const b = el('button'); b.type = 'button'; b.dataset.rowDensity = d; b.dataset.set = d; dens.append(b); }
  const paintDens = () => { for (const b of dens.children) b.setAttribute('aria-pressed', String(b.dataset.rowDensity === curDens())); };
  dens.addEventListener('click', (e) => { const b = e.target.closest('[data-row-density]'); if (!b) return; try { localStorage.setItem('ysmRowDensity', b.dataset.rowDensity); } catch { /* storage blocked */ } paintDens(); });
  const densRow = newRow('density', 'densityHint', dens); paintDens();
  const tabRowsRow = rowOf($('tabrows-toggle')); decorate(tabRowsRow, null);
  const tabHint = modal.querySelector('[data-i18n="tabRowsHint"]');
  const reset = modal.querySelector('.reskin-foot');
  gen.querySelector('.setting-col')?.replaceWith(reskinRow); // the old "Reskin pattern" block becomes the Theme row
  for (const n of [langRow, themeRow, reskinRow, tcolorRow, modal.querySelector('.tcolor-preview'), tabRowsRow, tabHint, fontRow, densRow]) if (n) gen.append(n);
  if (reset) gen.append(reset);


  // Engine: Engine, Device (helper compute), Browser engine, Model source, Quality (+ model files), Export folder, Captions show on.
  const engRow = rowOf($('engine-toggle')); decorate(engRow, 'engine', 'engineHint');
  const devRow = newRow('device', 'deviceHint', $('native-device-row'));
  const browserRow = rowOf($('device-toggle')); decorate(browserRow, 'browserEngine', 'browserEngineHint');
  const srcRow = rowOf($('mirror-toggle')); decorate(srcRow, 'modelSource');
  const qualRow = rowOf($('asr-preset-toggle')); decorate(qualRow, 'quality');
  const expRow = rowOf($('btn-pick-export-folder')); decorate(expRow, 'exportFolder', 'exportFolderHint');
  const surfRow = rowOf($('surface-toggle')); decorate(surfRow, 'showOn', 'showOnHint');
  const link = modal.querySelector('[data-open-view="helper"]');
  if (link) { link.removeAttribute('data-open-view'); link.removeAttribute('data-i18n'); link.dataset.set = 'computeLink'; link.addEventListener('click', () => api.setTab('helper')); }
  const native = $('native-block');
  for (const n of [engRow, native, devRow, link?.closest('.hint'), browserRow, srcRow, qualRow, $('asr-preset-hint'), $('asr-models'), expRow, surfRow, $('surface-hint'), $('surface-engine-hint')]) if (n) eng.append(n);
  $('helper-compute-card')?.remove();

  /* ---- Helper tab: the board shows Install expanded, with the Windows / Linux / macOS picker on its header ---- */
  const guideMount = $('helper-guide-mount');
  let opened = false;
  const openInstall = () => {
    const head = guideMount?.querySelector('.hg-install.collapsed > .hg-sec-head');
    if (head && !opened) { opened = true; head.click(); }
  };
  if (guideMount) { new MutationObserver(openInstall).observe(guideMount, { childList: true, subtree: true }); openInstall(); }

  /* ---- Back beside the search; the panel's ✕ closes the panel view, here it goes to the previous page ---- */
  const back = $('btn-close-settings');
  const row = modal.querySelector('.settings-search-row');
  if (back && row) {
    row.prepend(back);
    back.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      if (window.self !== window.top) { if (window.parent.history.length > 1) window.parent.history.back(); else window.parent.location.hash = '#live'; }
    }, true);
  }

  /* ---- Developer row (extension only: the lab always shows the Developer area) ---- */
  if (api.hosted) {
    const dev = el('div', 'setting-row set-dev', `<label class="set-lbl" for="set-dev-switch" data-set="developer"></label><small class="set-hint" data-set="developerHint"></small><input type="checkbox" role="switch" id="set-dev-switch" class="switch" />`);
    gen.insertBefore(dev, modal.querySelector('.reskin-foot'));
    const sw = dev.querySelector('input');
    globalThis.chrome?.storage?.local.get('ysmDeveloper').then((v) => { sw.checked = !!v?.ysmDeveloper; });
    sw.addEventListener('change', () => globalThis.chrome?.storage?.local.set({ ysmDeveloper: sw.checked }));
  }

  const paint = () => {
    tab.textContent = T('helper');
    for (const n of modal.querySelectorAll('[data-set]')) n.textContent = T(n.dataset.set);
    if (back) { back.setAttribute('aria-label', T('back')); back.title = T('back'); }
  };
  paint();
  window.__ysmLiveRepaint = paint;
}
