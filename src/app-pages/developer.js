/**
 * Area Developer asli di app shell (papan A08, TIDE-013) — hanya di lab (bukan ekstensi).
 * Menggantikan bingkai /app.html: tab Panel / Test pages / Mock helper / Guides and docs,
 * segmen lebar, "How the lab works", menu "All test pages", sampel CC0, Helper mock,
 * log permintaan, status lab dan log overlay.
 *
 * Memakai ulang modul lab: daftar halaman, teks dan pembantu mock dari lab-pages.js / lab-mock.js
 * (dipakai juga test/app.html) dan window.__labMock MILIK PANEL yang dipasang di tab Panel
 * (bingkai /panel-test.html memuat chrome-mock.js sendiri, jadi fetch-nya yang dikendalikan).
 * Teks tautan dijaga persis seperti di lab: label kendali dicatat di controls.json.
 *
 * Kontrak: developerHtml() → string; wireDeveloper(root) memasang perilaku dan mengembalikan
 * fungsi pembersih (pewaktu, pendengar dokumen) yang dipanggil saat halaman diganti.
 */
import { tile } from '../lib/colour-icons.js';
import { PAGES, DEV, MODE_NOTE } from './lab-pages.js';
import { esc, logTableHtml, parseFixture, overlayLogHtml } from './lab-mock.js';

const WIDTH_KEY = 'ysmAppWidth';
const WIDTHS = ['auto', 'compact', 'wide', 'full'];
const TABS = ['panel', 'pages', 'mock', 'guides'];
const safeTile = (name, size = 22) => { try { return tile(name, size); } catch { return ''; } };

const pageRow = ([n, href, d, pri]) => `<a class="pgr${pri ? ' pri' : ''}" href="${esc(href)}"><b>${esc(n)}</b>${d ? `<span class="pd">${esc(d)}</span>` : ''}<span class="href">${esc(href)}</span></a>`;

export function developerHtml() {
  const tabBtn = (id, label, icon) => `<button type="button" role="tab" data-dtab="${id}" aria-selected="${id === 'panel'}">${safeTile(icon)}${label}</button>`;
  return `<div class="dev-area">
  <div class="dv-bar">
    <div class="dv-seg" role="group" aria-label="Page width" id="dv-width">
      <button type="button" data-width="auto" aria-pressed="true" title="Compact for Captions, wide for Notes">Auto</button>
      <button type="button" data-width="compact" aria-pressed="false" title="Side-panel width (480px)">Compact</button>
      <button type="button" data-width="wide" aria-pressed="false" title="880px">Wide</button>
      <button type="button" data-width="full" aria-pressed="false" title="Whole window">Full</button>
    </div>
    <button type="button" class="btn sm" id="dv-how-btn">How the lab works</button>
    <a class="btn sm" href="/src/minutes.html">Minutes register</a>
    <details class="dv-menu" id="dv-pages-menu"><summary class="btn sm">All test pages ▾</summary>
      <div class="dv-list" id="dv-pages-list">${PAGES.map(([t, , rows]) => `<div class="sec">${esc(t)}</div>${rows.map(([n, href, d, pri]) => `<a${pri ? ' class="primary"' : ''} href="${esc(href)}"><b>${esc(n)}</b>${d ? `<span>${esc(d)}</span>` : ''}</a>`).join('')}`).join('')}</div>
    </details>
  </div>
  <nav class="dv-tabs" role="tablist" aria-label="Lab sections" id="dv-tabs">${tabBtn('panel', 'Panel', 'captions')}${tabBtn('pages', 'Test pages', 'pages')}${tabBtn('mock', 'Mock helper', 'mock')}${tabBtn('guides', 'Guides and docs', 'docs')}</nav>

  <section class="dv-pane" id="dtab-panel" role="tabpanel">
    <div class="dv-note" id="dv-loading">${safeTile('engine')}<span><b>Loading the panel.</b> Fetching /panel-test.html …</span></div>
    <div class="dv-note">${safeTile('lock')}<span><b>Needs the Chrome extension.</b> Tab capture (<code>tabCapture</code>) and overlay injection do not run in a plain tab. Realtime loops a CC0 clip instead; Pick uses <code>getDisplayMedia</code>.</span></div>
    <div class="dv-note">${safeTile('sample')}<span><b>Choose an input.</b> Pick a CC0 sample in Test pages, or press Pick and share a tab with audio.</span></div>
    <div class="dv-wrap" id="dv-wrap" data-width="auto"><iframe class="dv-frame" id="dv-frame" title="Panel" src="/panel-test.html"></iframe></div>
    <p class="dv-mini">helper.mode <b class="mono" id="dv-r-mode"></b> · latencyMs <b class="mono" id="dv-r-latency"></b> · failNext <b class="mono" id="dv-r-failnext"></b> · <a href="#dev" id="dv-open-mock">Open mock controls</a></p>
  </section>

  <section class="dv-pane" id="dtab-pages" role="tabpanel" hidden>
    <div class="dv-card"><h3>${safeTile('sample')}CC0 samples<span class="grow"></span><span class="dv-chip">lab only</span></h3>
      <div class="dv-row"><select class="dv-sel" id="dv-sample" aria-label="CC0 sample"></select><button type="button" class="pill-b sm" id="dv-sample-run">Run sample</button></div>
      <p class="mut">10–30 s public-domain clips per language. Plays the chosen clip through the real pipeline.</p></div>
    <div class="dv-grid" id="dv-grid">${PAGES.map(([t, i, rows]) => `<div class="dv-card"><h3>${safeTile(i)}${esc(t)}<span class="grow"></span><span class="dv-chip mono">${rows.length}</span></h3>${rows.map(pageRow).join('')}</div>`).join('')}</div>
  </section>

  <section class="dv-pane" id="dtab-mock" role="tabpanel" hidden>
    <div class="dv-card"><h3>${safeTile('mock')}Helper mock (window.__labMock)</h3>
      <div class="dv-row"><span class="lbl">helper.mode</span>
        <div class="dv-seg" role="group" aria-label="helper.mode" id="dv-mode"><button type="button" data-mode="passthrough" aria-pressed="true">passthrough</button><button type="button" data-mode="offline" aria-pressed="false">offline</button><button type="button" data-mode="fixture" aria-pressed="false">fixture</button></div></div>
      <p class="mut" id="dv-mode-note"></p>
      <div class="dv-row"><span class="lbl">latencyMs</span><input class="dv-num" id="dv-latency" type="number" min="0" step="50" value="0" aria-label="latencyMs" /><span class="mut">delay on every answer</span></div>
      <div class="dv-row"><span class="lbl">failNext</span><label><input type="checkbox" id="dv-failnext" /> fail next request</label><span class="mut">then back to normal</span></div>
      <div class="dv-row"><button type="button" class="btn sm" id="dv-reset">Reset</button><span class="dv-chip">reset() restores passthrough, 0, 0 and clears both logs</span></div>
      <p class="mut">The mock intercepts <code>fetch</code> to 127.0.0.1:17865 (<code>/health</code>, <code>/engine/device</code> GET and POST). Chrome APIs are mocked by chrome-mock.js.</p>
    </div>
    <div class="dv-three">
      <div class="dv-card"><h3>${safeTile('check')}health fixture</h3><textarea class="dv-ta" id="dv-health" spellcheck="false" aria-label="health fixture JSON"></textarea><div class="dv-err" id="dv-health-err"></div></div>
      <div class="dv-card"><h3>${safeTile('engine')}device fixture</h3><textarea class="dv-ta" id="dv-device" spellcheck="false" aria-label="device fixture JSON"></textarea><div class="dv-err" id="dv-device-err"></div></div>
      <div class="dv-card"><h3>${safeTile('history')}Request log<span class="grow"></span><button type="button" class="btn sm" id="dv-log-clear">Clear</button></h3><div id="dv-log"></div></div>
    </div>
    <div class="dv-card" id="dv-status"><h3>${safeTile('check')}Lab status and overlay log</h3>
      <div class="dv-kv"><span>Lab status</span><b>Serving :${esc(location.port || '80')}</b></div>
      <div class="dv-kv"><span>chrome-mock.js</span><span class="dv-chip ok">loaded</span></div>
      <div class="dv-kv"><span>Panel</span> <span class="dv-chip warn" id="dv-st-panel">loading</span></div>
      <div class="dv-kv"><span>Overlay log</span><b id="dv-overlay-n">0 lines</b></div>
      <div class="dv-olog mono" id="dv-overlay"><span>No overlay messages yet.</span></div>
    </div>
  </section>

  <section class="dv-pane" id="dtab-guides" role="tabpanel" hidden>
    <div class="dv-cols">
      <div>
        <div class="dv-card"><h3>${safeTile('docs')}User guides</h3>
          <a class="pgr pri" href="/guide.html"><b>Extension (Bahasa Indonesia)</b><span class="href">/guide.html</span></a>
          <a class="pgr pri" href="/guide.html?doc=USER-GUIDE-MACOS.md"><b>macOS</b><span class="href">/guide.html?doc=USER-GUIDE-MACOS.md</span></a>
          <a class="pgr pri" href="/guide.html?doc=USER-GUIDE-WINLINUX.md"><b>Windows and Linux</b><span class="href">/guide.html?doc=USER-GUIDE-WINLINUX.md</span></a></div>
        <div class="dv-card"><h3>${safeTile('register')}Project docs</h3>
          <a class="pgr" href="/docs/DEVELOPMENT.md"><b>DEVELOPMENT.md</b><span class="pd">Build, test, run the lab</span></a>
          <a class="pgr" href="/docs/QA.md"><b>QA.md</b><span class="pd">Smoke, E2E, release gate</span></a>
          <a class="pgr" href="/docs/RELEASE-CHECKLIST.md"><b>RELEASE-CHECKLIST.md</b><span class="pd">Before a store upload</span></a></div>
      </div>
      <div class="dv-card"><h3>${safeTile('notes')}How the lab works</h3><p class="dv-dev">${DEV}</p></div>
    </div>
  </section>

  <div class="dv-ov" id="dv-how" role="dialog" aria-modal="true" aria-label="How the lab works" hidden>
    <div class="dv-scrim" data-close></div>
    <div class="dv-pop"><div class="dv-lh"><b>How the lab works</b><button type="button" class="dv-x" data-close aria-label="Close">×</button></div><p class="dv-dev">${DEV}</p></div>
  </div>
</div>`;
}

export function wireDeveloper(root) {
  const $ = (id) => root.querySelector(`#${id}`);
  const frame = $('dv-frame');
  const cleanups = [];
  const M = () => { try { return frame.contentWindow?.__labMock || null; } catch { return null; } };
  let tabNow = 'panel';

  /* ---- tab ---- */
  const setTab = (t) => {
    tabNow = TABS.includes(t) ? t : 'panel';
    root.querySelectorAll('#dv-tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.dtab === tabNow)));
    for (const k of TABS) $(`dtab-${k}`).hidden = k !== tabNow;
    if (tabNow === 'mock') renderMock();
  };
  $('dv-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-dtab]'); if (b) setTab(b.dataset.dtab); });
  $('dv-open-mock').addEventListener('click', (e) => { e.preventDefault(); setTab('mock'); });

  /* ---- lebar (diingat per browser, kunci yang sama dengan lab) ---- */
  const setWidth = (w, persist = true) => {
    $('dv-wrap').dataset.width = w;
    $('dv-width').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.width === w)));
    if (persist) { try { localStorage.setItem(WIDTH_KEY, w); } catch { /* privat */ } }
  };
  let saved = 'auto';
  try { saved = localStorage.getItem(WIDTH_KEY) || 'auto'; } catch { /* abaikan */ }
  setWidth(WIDTHS.includes(saved) ? saved : 'auto', false);
  $('dv-width').addEventListener('click', (e) => { const b = e.target.closest('[data-width]'); if (b) setWidth(b.dataset.width); });
  $('dv-pages-menu').addEventListener('click', (e) => { if (e.target.closest('a')) e.currentTarget.removeAttribute('open'); });

  /* ---- "How the lab works" ---- */
  const how = $('dv-how');
  const openHow = (on) => { how.hidden = !on; if (on) how.querySelector('.dv-x').focus(); else $('dv-how-btn').focus(); };
  $('dv-how-btn').addEventListener('click', () => openHow(true));
  how.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) openHow(false); });
  const onKey = (e) => { if (e.key === 'Escape' && !how.hidden) openHow(false); };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  /* ---- Helper mock ---- */
  const renderRails = () => {
    const m = M(); if (!m) return;
    const h = m.helper;
    $('dv-r-mode').textContent = h.mode; $('dv-r-latency').textContent = h.latencyMs; $('dv-r-failnext').textContent = h.failNext;
  };
  const renderLog = () => { const m = M(); if (m) $('dv-log').innerHTML = logTableHtml(m.helper.log, esc); };
  const renderOverlay = () => {
    const m = M(); if (!m) return;
    $('dv-overlay').innerHTML = overlayLogHtml(m.content.log, esc);
    $('dv-overlay-n').textContent = `${m.content.log.length} line${m.content.log.length === 1 ? '' : 's'}`;
  };
  function renderMock() {
    const m = M(); if (!m) return;
    const h = m.helper;
    root.querySelectorAll('#dv-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === h.mode)));
    $('dv-mode-note').textContent = MODE_NOTE[h.mode] || '';
    $('dv-latency').value = h.latencyMs;
    $('dv-failnext').checked = h.failNext > 0;
    if (document.activeElement !== $('dv-health')) $('dv-health').value = JSON.stringify(h.health, null, 2);
    if (document.activeElement !== $('dv-device')) $('dv-device').value = JSON.stringify(h.device, null, 2);
    renderLog(); renderRails(); renderOverlay();
  }
  $('dv-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && M()) { M().helper.mode = b.dataset.mode; renderMock(); } });
  $('dv-latency').addEventListener('input', (e) => { if (M()) { M().helper.latencyMs = Math.max(0, Number(e.target.value) || 0); renderRails(); } });
  $('dv-failnext').addEventListener('change', (e) => { if (M()) { M().helper.failNext = e.target.checked ? 1 : 0; renderRails(); } });
  $('dv-reset').addEventListener('click', () => { M()?.reset(); renderMock(); });
  $('dv-log-clear').addEventListener('click', () => { if (M()) { M().helper.log.length = 0; renderLog(); } });
  for (const [key, id] of [['health', 'dv-health'], ['device', 'dv-device']]) {
    $(id).addEventListener('input', (e) => {
      const r = parseFixture(e.target.value);
      if (r.ok && M()) M().helper[key] = r.value;
      e.target.classList.toggle('bad', !r.ok);
      $(`${id}-err`).textContent = r.ok ? '' : `Not applied: ${r.error}`;
    });
  }

  /* ---- panel: status, log mock, lebar Auto ---- */
  let attachedTo = null;
  const onLog = () => { renderOverlay(); if (tabNow === 'mock') renderLog(); renderRails(); };
  const attach = () => {
    const w = frame.contentWindow;
    if (!w || attachedTo === w || !w.__labMock) return;
    attachedTo = w;
    w.addEventListener('labmock:log', onLog);
    $('dv-loading').hidden = true;
    const chip = $('dv-st-panel'); chip.textContent = 'mounted'; chip.className = 'dv-chip ok';
    renderRails(); if (tabNow === 'mock') renderMock();
  };
  frame.addEventListener('load', attach);
  attach();
  const syncSamples = () => {
    let doc; try { doc = frame.contentDocument; } catch { return; }
    const src = doc?.getElementById('qa-sample-select'); const dst = $('dv-sample');
    if (!src) return;
    if (dst.options.length !== src.options.length) dst.innerHTML = src.innerHTML;
    dst.value = src.value;
    // Auto: lebar panel samping untuk Captions, lebar Notes bila tampilan Notes terbuka.
    const notes = doc.getElementById('view-notes');
    $('dv-wrap').dataset.notes = String(!!notes && !notes.classList.contains('hidden'));
  };
  const timer = setInterval(() => { attach(); syncSamples(); }, 600);
  cleanups.push(() => clearInterval(timer));
  $('dv-sample').addEventListener('change', (e) => {
    const src = frame.contentDocument?.getElementById('qa-sample-select');
    if (src) { src.value = e.target.value; src.dispatchEvent(new Event('change')); }
  });
  $('dv-sample-run').addEventListener('click', () => frame.contentDocument?.getElementById('btn-qa-run')?.click());

  setTab('panel');
  return () => { for (const f of cleanups) f(); };
}
