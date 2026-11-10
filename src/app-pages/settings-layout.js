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
  en: { helper: 'Helper', developer: 'Developer', developerHint: 'Lab tools in the sidebar', back: 'Back' },
  id: { helper: 'Helper', developer: 'Developer', developerHint: 'Alat lab di sidebar', back: 'Kembali' },
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
  for (const id of ['helper-status-card', 'helper-compute-card']) if ($(id)) pane.append($(id));
  modal.querySelector('[data-pane="about"]').before(pane);
  tab.addEventListener('click', () => api.setTab('helper')); // the panel's own tab click handlers cover the others

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
    const dev = el('div', 'setting-row set-dev', `<label for="set-dev-switch"><b data-set="developer"></b><small data-set="developerHint"></small></label><input type="checkbox" role="switch" id="set-dev-switch" class="switch" />`);
    modal.querySelector('[data-pane="general"]').append(dev);
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
