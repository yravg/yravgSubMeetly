/**
 * Papan A02 "Live captions" (TIDE-006) — tata letak halaman shell.
 *
 * Dipanggil sidepanel.js hanya saat panel dipasang shell (?view=captions&shell=1).
 * Kendali lama TIDAK ditulis ulang: simpul aslinya (Start/End, mode, bahasa, mesin,
 * pratinjau, galat) dipindah ke tiga kartu papan, jadi id dan handler-nya tetap dan
 * Start/Stop berjalan lewat kode panel yang sama. Yang baru dibangun di sini hanya
 * apa yang digambar papan tapi belum ada: pemilih Source (Tab / File / Mikrofon),
 * kepala pratinjau dengan status + jam, dan tiga ubin "Captions show on" — ubin ini
 * mewakili #surface-toggle di Pengaturan (klik diteruskan ke tombol aslinya).
 *
 *   api = { lang(): 'en'|'id', env: 'ext'|'web'|'lab', running(): { on, startedAt }, setMic(on) }
 */
const STR = {
  en: {
    capture: 'Capture', source: 'Source', tab: 'Tab audio', file: 'File', mic: 'Microphone', mode: 'Mode',
    needsTitle: 'Needs input.', needsBody: 'Choose which tab to capture. Chrome asks you once per session.', chooseTab: 'Choose tab', useFile: 'Use a file instead', needs: 'Needs input',
    livePreview: 'Live preview', idle: 'Idle', starting: 'Starting…', listening: 'Listening', stopped: 'Stopped',
    nothingYet: 'Nothing yet', nothingBody: 'Start a task and the speech appears here, with its translation under it.',
    waiting: 'Listening…', waitingBody: 'Speak or play audio; the first line appears in a moment.',
    showOn: 'Captions show on', showOnInfo: 'Where captions appear. The choice applies at once and is kept per profile.',
    overlay: 'Page overlay', overlayD: 'Over the tab you capture', island: 'Island', islandD: 'Pill under the notch', both: 'Both', bothD: 'Page and island',
    needsHelper: 'Island captions need the Native Helper engine.', useHelper: 'Use Native Helper',
    envLabTitle: 'Needs the extension', envLab: 'Tab capture and the page overlay only run inside the Chrome extension. In the lab the panel plays a CC0 sample instead.',
    envWebTitle: 'No page overlay in this window', envWeb: 'Press Start and share a tab, window or screen with audio. Captions appear here and in the island pill; the overlay on a web page needs the Chrome extension.',
  },
  id: {
    capture: 'Tangkap', source: 'Sumber', tab: 'Audio tab', file: 'Berkas', mic: 'Mikrofon', mode: 'Mode',
    needsTitle: 'Perlu masukan.', needsBody: 'Pilih tab yang ditangkap. Chrome menanyakannya sekali per sesi.', chooseTab: 'Pilih tab', useFile: 'Pakai berkas saja', needs: 'Perlu masukan',
    livePreview: 'Pratinjau langsung', idle: 'Siaga', starting: 'Memulai…', listening: 'Mendengarkan', stopped: 'Berhenti',
    nothingYet: 'Belum ada', nothingBody: 'Mulai tugas dan ucapan muncul di sini, terjemahannya di bawahnya.',
    waiting: 'Mendengarkan…', waitingBody: 'Bicara atau putar audio; baris pertama muncul sebentar lagi.',
    showOn: 'Teks tampil di', showOnInfo: 'Tempat teks muncul. Pilihan berlaku seketika dan disimpan per profil.',
    overlay: 'Overlay halaman', overlayD: 'Di atas tab yang ditangkap', island: 'Island', islandD: 'Pil di bawah notch', both: 'Keduanya', bothD: 'Halaman dan island',
    needsHelper: 'Teks island butuh mesin Native Helper.', useHelper: 'Pakai Native Helper',
    envLabTitle: 'Perlu ekstensi', envLab: 'Tangkap tab dan overlay halaman hanya berjalan di ekstensi Chrome. Di lab panel memutar sampel CC0.',
    envWebTitle: 'Tidak ada overlay halaman di jendela ini', envWeb: 'Tekan Mulai lalu bagikan tab, jendela, atau layar beserta audionya. Teks muncul di sini dan di pil island; overlay di halaman web butuh ekstensi Chrome.',
  },
};

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const ICON = {
  tab: '<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 17v3"/>',
  island: '<rect x="3" y="8.5" width="18" height="7" rx="3.5"/><circle cx="8" cy="12" r="1.2"/>',
  both: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
};
const svg = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

export function mountLiveLayout(api) {
  const $ = (id) => document.getElementById(id);
  const T = (k) => STR[api.lang() === 'id' ? 'id' : 'en'][k] ?? STR.en[k] ?? k;
  document.documentElement.dataset.reskin = 'tide';
  document.documentElement.dataset.shell = 'live';
  const host = $('view-captions');
  if (!host || $('live-shell')) return;

  const shell = el('div', 'ls');
  shell.id = 'live-shell';

  /* ---- Capture card ---- */
  const cap = el('section', 'ls-capture');
  cap.innerHTML = `<h2 data-ls="capture"></h2><div class="ls-lbl" data-ls="source"></div>
    <div class="ls-seg" id="ls-source" role="radiogroup"><button type="button" role="radio" data-src="tab" data-ls="tab"></button><button type="button" role="radio" data-src="file" data-ls="file"></button><button type="button" role="radio" data-src="mic" data-ls="mic"></button></div>`;
  const modeLbl = el('div', 'ls-lbl'); modeLbl.dataset.ls = 'mode';
  const modeRow = el('div', 'ls-modes');
  for (const id of ['mode-toggle', 'task-toggle', 'density-toggle']) if ($(id)) modeRow.append($(id));
  cap.append(...['rt-target', 'session-tab-hint', 'off-drop', 'qa-sample-wrap'].map($).filter(Boolean));
  cap.append(modeLbl, modeRow);
  for (const sel of ['.task-row', 'interpreter-row', 'lang-row', 'engine-line', 'model-warning-wrap', 'dl-list', 'status-line', 'start-steps']) {
    const n = sel.startsWith('.') ? document.querySelector(sel) : $(sel);
    if (n) cap.append(n);
  }
  const btns = document.querySelector('#action-card .btn-row');
  if (btns) cap.append(btns);
  cap.append(...['btn-pick', 'pick-hint'].map($).filter(Boolean));

  /* ---- Live preview card ---- */
  const pre = el('section', 'ls-preview');
  pre.innerHTML = `<div class="ls-phead"><span class="ls-eyebrow" data-ls="livePreview"></span><span class="ls-state" id="ls-live-state" aria-live="polite"></span></div>
    <div class="ls-needs" id="ls-needs" role="status" hidden><span class="ls-nic" aria-hidden="true">!</span><div><p><b data-ls="needsTitle"></b> <span data-ls="needsBody"></span></p><div class="ls-nact"><button type="button" class="ls-ink" data-needs="tab" data-ls="chooseTab"></button><button type="button" class="ls-soft" data-needs="file" data-ls="useFile"></button></div></div></div>
    <div class="ls-empty" id="ls-preview-empty"><b></b><p></p></div>`;
  for (const id of ['error-box', 'live-preview', 'off-results']) if ($(id)) pre.append($(id));

  /* ---- Captions show on card ---- */
  const sur = el('section', 'ls-surface');
  sur.innerHTML = `<h2><span data-ls="showOn"></span> <span class="ls-info" id="ls-info" tabindex="0" role="img">${svg('info', 16)}</span></h2>
    <div class="ls-tiles" id="ls-surface-tiles" role="radiogroup"></div>
    <div class="ls-env" id="ls-env-note"${api.env === 'ext' ? ' hidden' : ''}><b data-ls="${api.env === 'web' ? 'envWebTitle' : 'envLabTitle'}"></b><p data-ls="${api.env === 'web' ? 'envWeb' : 'envLab'}"></p></div>
    <div class="ls-hint" id="ls-surface-hint" hidden><span data-ls="needsHelper"></span> <button type="button" class="link-btn" id="ls-use-helper" data-ls="useHelper"></button></div>`;
  const kinds = [['overlay', 'tab', 'overlayD'], ['island', 'island', 'islandD'], ['both', 'both', 'bothD']];
  // One control for "Captions show on": the three described tiles (a pill strip with the same three options sat above them).
  const tiles = sur.querySelector('#ls-surface-tiles');
  for (const [k, ic, d] of kinds) {
    const tl = el('button', 'ls-tile', `<span class="ls-tic">${svg(ic)}</span><span><b data-ls="${k}"></b><small data-ls="${d}"></small></span>`); tl.type = 'button'; tl.setAttribute('role', 'radio'); tl.dataset.surface = k; tiles.append(tl);
  }

  const col = el('div', 'ls-col'); col.append(pre, sur);
  shell.append(cap, col);
  host.prepend(shell);
  // The old section cards only held the nodes moved above; hide their empty shells.
  for (const s of host.querySelectorAll(':scope > section.card')) s.classList.add('ls-gone');
  $('captions-subtabs')?.classList.add('ls-gone');

  /* ---- text (re-run when the language changes) ---- */
  const paint = () => {
    for (const n of shell.querySelectorAll('[data-ls]')) n.textContent = T(n.dataset.ls);
    $('ls-info')?.setAttribute('title', T('showOnInfo'));
    $('ls-info')?.setAttribute('aria-label', T('showOnInfo'));
    $('ls-surface-tiles')?.setAttribute('aria-label', T('showOn'));
    $('ls-surface-tiles')?.setAttribute('aria-label', T('showOn'));
    $('ls-source')?.setAttribute('aria-label', T('source'));
    paintPreview();
  };

  /* ---- Source: Tab audio / File / Microphone drive the panel's own Mode toggle ---- */
  const modeBtn = (m) => document.querySelector(`#mode-toggle button[data-mode="${m}"]`);
  const isOffline = () => modeBtn('offline')?.classList.contains('active');
  let src = 'tab';
  const paintSource = () => {
    if (isOffline()) src = 'file'; else if (src === 'file') src = 'tab';
    for (const b of document.querySelectorAll('#ls-source button')) { const on = b.dataset.src === src; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    shell.dataset.src = src;
  };
  $('ls-source').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-src]'); if (!b) return;
    src = b.dataset.src;
    api.setMic(src === 'mic');
    if (src === 'file') { if (!isOffline()) modeBtn('offline')?.click(); } else if (isOffline()) modeBtn('realtime')?.click();
    paintSource();
  });
  new MutationObserver(paintSource).observe($('mode-toggle'), { attributes: true, subtree: true, attributeFilter: ['class'] });

  /* ---- Captions show on: tiles + seg forward to #surface-toggle ---- */
  const origSurface = (k) => document.querySelector(`#surface-toggle button[data-surface="${k}"]`);
  const paintSurface = () => {
    const cur = [...document.querySelectorAll('#surface-toggle button')].find((b) => b.classList.contains('active'))?.dataset.surface || 'overlay';
    for (const b of sur.querySelectorAll('[data-surface]')) { const on = b.dataset.surface === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    $('ls-surface-hint').hidden = !($('surface-engine-hint') && !$('surface-engine-hint').classList.contains('hidden'));
  };
  sur.addEventListener('click', (e) => { const b = e.target.closest('[data-surface]'); if (b) origSurface(b.dataset.surface)?.click(); });
  $('ls-use-helper').addEventListener('click', () => $('btn-surface-native')?.click());
  const so = new MutationObserver(paintSurface);
  for (const n of [$('surface-toggle'), $('surface-engine-hint')]) if (n) so.observe(n, { attributes: true, subtree: true, attributeFilter: ['class'] });

  /* ---- Needs input: Chrome wants the user to pick a tab (the panel shows #pick-hint); the buttons drive the panel's own controls ---- */
  $('ls-needs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-needs]'); if (!b) return;
    if (b.dataset.needs === 'tab') $('btn-pick')?.click();
    else { src = 'file'; if (!isOffline()) modeBtn('offline')?.click(); $('pick-hint')?.classList.add('hidden'); paintSource(); paintPreview(); }
  });

  /* ---- Preview: empty / waiting / state pill with clock ---- */
  function paintPreview() {
    const r = api.running();
    // Only the visible preview counts: the hidden boxes can hold placeholder lines (lab) until a session clears them.
    const lines = $('live-preview')?.classList.contains('hidden') ? 0 : document.querySelectorAll('#live-tgt-lines .line, #live-src-lines .line').length;
    const needs = !r.on && !!$('pick-hint') && !$('pick-hint').classList.contains('hidden') && !isOffline();
    $('ls-needs').hidden = !needs;
    shell.dataset.needs = String(needs);
    const failed = !needs && $('error-box') && !$('error-box').classList.contains('hidden');
    const startingNow = $('start-steps') && !$('start-steps').classList.contains('hidden') && !r.on;
    const st = $('ls-live-state');
    st.dataset.state = needs ? 'needs' : failed ? 'error' : r.on ? 'listening' : startingNow ? 'starting' : 'idle';
    st.textContent = r.on ? `${T('listening')} · ${clock(Date.now() - (r.startedAt || Date.now()))}` : needs ? T('needs') : startingNow ? T('starting') : failed ? '' : lines ? T('stopped') : T('idle');
    const empty = $('ls-preview-empty');
    empty.hidden = failed || needs || lines > 0;
    empty.querySelector('b').textContent = r.on ? T('waiting') : T('nothingYet');
    empty.querySelector('p').textContent = r.on ? T('waitingBody') : T('nothingBody');
  }
  setInterval(paintPreview, 500);
  // Class changes only (error box shown/hidden, start steps): paintPreview writes text and `hidden`,
  // never classes, so this cannot re-trigger itself. New lines are picked up by the 500 ms tick.
  new MutationObserver(paintPreview).observe(pre, { attributes: true, subtree: true, attributeFilter: ['class'] });

  paint();
  paintSource();
  paintSurface();
  window.__ysmLiveRepaint = paint;
}
