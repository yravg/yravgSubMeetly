/**
 * Papan A05 "History and Files" (TIDE-009) — tata letak halaman shell.
 *
 * Dipanggil sidepanel.js saat panel dipasang shell (?view=history|files&shell=1).
 * Seperti live-layout.js: simpul panel yang sudah ada dipindah, bukan ditulis ulang.
 *
 * History: pencarian + daftar (renderHistory membangun barisnya: Open, TXT, SRT, VTT,
 *   hapus), kartu "Export formats" (#export-mount), dan transkrip yang dibuka.
 * Files: zona tarik-lepas (#off-drop, input berkas aslinya), kartu pekerjaan dengan
 *   empat keadaan — drop, siap (bahasa + Start), berjalan (kemajuan jendela + Cancel =
 *   #btn-stop), selesai (ekspor TXT SRT VTT MD CSV JSON). Keadaan dibaca dari state
 *   panel lewat api; tidak ada logika mesin di sini.
 *
 *   api = { view, lang(), running(), file(), staging(), lines(), progress(), exportKind(kind) }
 */
const STR = {
  en: {
    history: 'History', files: 'Files', sections: 'Pages',
    dropTitle: 'Drop an audio or video file', dropBody: 'Transcribed on this machine. Files up to 2 GiB stream in pieces.', choose: 'Choose…',
    staging: 'Reading the file…', ready: 'Ready', readyBody: 'Pick the languages, then start.',
    transcribing: 'Transcribing', windowOf: (i, n) => `window ${i} of ${n}`, minLeft: (m) => (m < 1 ? 'under 1 min left' : `${m} min left`),
    to: 'to', done: 'Done', doneMeta: (dur, n) => `Done · ${dur} of audio${n ? ` · ${n} windows` : ''}`, exportAs: 'Export as',
    opened: 'Opened transcript', noFile: 'No file yet', lines: 'Transcript',
  },
  id: {
    history: 'Riwayat', files: 'Berkas', sections: 'Halaman',
    dropTitle: 'Jatuhkan berkas audio atau video', dropBody: 'Ditranskripsi di mesin ini. Berkas hingga 2 GiB diproses per potongan.', choose: 'Pilih…',
    staging: 'Membaca berkas…', ready: 'Siap', readyBody: 'Pilih bahasa, lalu mulai.',
    transcribing: 'Mentranskripsi', windowOf: (i, n) => `jendela ${i} dari ${n}`, minLeft: (m) => (m < 1 ? 'kurang dari 1 mnt lagi' : `${m} mnt lagi`),
    to: 'ke', done: 'Selesai', doneMeta: (dur, n) => `Selesai · ${dur} audio${n ? ` · ${n} jendela` : ''}`, exportAs: 'Ekspor sebagai',
    opened: 'Transkrip dibuka', noFile: 'Belum ada berkas', lines: 'Transkrip',
  },
};
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const ICON = {
  doc: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M9.5 12.5h6M9.5 16h6"/>',
  up: '<path d="M12 15V4M8 8l4-4 4 4M5 14v5.5h14V14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  down: '<path d="M12 4v11M8 11l4 4 4-4M5 19.5h14"/>',
};
const svg = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const hms = (sec) => { const s = Math.max(0, Math.round(sec)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; };

export function mountFilesLayout(api) {
  const $ = (id) => document.getElementById(id);
  const T = (k, ...a) => { const v = STR[api.lang() === 'id' ? 'id' : 'en'][k] ?? STR.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
  document.documentElement.dataset.reskin = 'tide';
  const isFiles = api.view === 'files';
  const host = $(isFiles ? 'view-captions' : 'view-history');
  if (!host || $('fh-shell')) return;

  const shell = el('div', 'fh');
  shell.id = 'fh-shell';
  shell.dataset.page = api.view;

  /* ---- History | Files page switch (the shell's own routes) ---- */
  const tabs = el('div', 'ls-seg fh-tabs', '');
  tabs.setAttribute('role', 'tablist');
  for (const r of ['history', 'files']) {
    const b = el('button', r === api.view ? 'on' : '', ''); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(r === api.view)); b.dataset.go = r; b.dataset.fh = r; tabs.append(b);
  }
  tabs.addEventListener('click', (e) => {
    const r = e.target.closest('[data-go]')?.dataset.go;
    if (!r || r === api.view) return;
    if (window.self !== window.top) window.parent.location.hash = `#${r}`; else location.search = location.search.replace(/view=\w+/, `view=${r}`);
  });
  shell.append(tabs);

  if (!isFiles) {
    /* ================= History ================= */
    const list = el('section', 'fh-card fh-list');
    for (const id of ['history-search', 'history-list', 'export-mount']) if ($(id)) list.append($(id));
    const opened = el('section', 'fh-card fh-opened');
    opened.hidden = true;
    opened.innerHTML = '<h2 data-fh="opened"></h2>';
    for (const id of ['status-line', 'error-box', 'off-results']) if ($(id)) opened.append($(id));
    shell.append(list, opened);
    host.prepend(shell);
    for (const s of host.querySelectorAll(':scope > section.card')) s.classList.add('ls-gone');
    // "Open" in a row fills #off-results: reveal the card only when a transcript is loaded.
    const sync = () => { opened.hidden = !(api.lines().length > 0); };
    setInterval(sync, 500);
  } else {
    /* ================= Files ================= */
    const drop = el('section', 'fh-card fh-drop-card');
    const dz = $('off-drop');
    if (dz) {
      for (const n of [...dz.children]) if (n.id !== 'off-filename' && n.id !== 'off-file') n.classList.add('ls-gone');
      const art = el('div', 'fh-up', svg('up', 20));
      const title = el('b', 'fh-drop-t'); title.dataset.fh = 'dropTitle';
      const body = el('p', 'fh-drop-b'); body.dataset.fh = 'dropBody';
      const choose = el('button', 'fh-choose'); choose.type = 'button'; choose.dataset.fh = 'choose';
      dz.prepend(art, title, body, choose);
      drop.append(dz);
    }
    for (const id of ['qa-sample-wrap']) if ($(id)) drop.append($(id));

    const job = el('section', 'fh-card fh-job');
    job.innerHTML = `<div class="fh-jhead"><span class="fh-tile" id="fh-tile"></span><span class="fh-jname"><b id="fh-name"></b><small id="fh-meta"></small></span><span class="fh-jact" id="fh-act"></span><span class="fh-chip" id="fh-chip"></span></div>
      <div class="fh-run" id="fh-run"><div class="fh-rl"><span><b data-fh="transcribing"></b><small id="fh-win"></small></span><b id="fh-pct"></b></div><div class="fh-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" id="fh-bar"><i id="fh-fill"></i></div></div>
      <div class="fh-ready" id="fh-ready"></div>
      <div class="fh-export" id="fh-export" role="group"></div>`;
    const act = job.querySelector('#fh-act');
    if ($('btn-stop')) act.append($('btn-stop'));
    const ready = job.querySelector('#fh-ready');
    for (const sel of ['task-toggle', 'lang-row', 'engine-line']) if ($(sel)) ready.append($(sel));
    if ($('btn-start')) ready.append($('btn-start'));
    // Exports: the three the panel always had keep their ids; MD, CSV, JSON go through the same exportLines().
    const exp = job.querySelector('#fh-export');
    const kinds = [['txt', 'btn-txt'], ['srt', 'btn-srt'], ['vtt', 'btn-vtt'], ['md'], ['csv'], ['json']];
    for (const [k, id] of kinds) {
      let b = id && $(id);
      if (!b) { b = el('button', 'mini-btn'); b.type = 'button'; b.addEventListener('click', () => api.exportKind(k)); }
      b.classList.add('fh-fmt'); b.dataset.kind = k; b.textContent = k.toUpperCase(); exp.append(b);
    }
    const results = el('section', 'fh-card fh-lines');
    results.innerHTML = '<h2 data-fh="lines"></h2>';
    for (const id of ['status-line', 'error-box', 'off-results']) if ($(id)) results.append($(id));
    shell.append(drop, job, results);
    host.prepend(shell);
    for (const s of host.querySelectorAll(':scope > section.card')) s.classList.add('ls-gone');
    $('captions-subtabs')?.classList.add('ls-gone');
    // The transcript list and its old header are only the container for the export buttons now moved out.
    $('off-results')?.querySelector('.results-head')?.classList.add('ls-gone');

    /* ---- job card states: drop | ready | running | done, read from the panel ---- */
    const paintJob = () => {
      const running = api.running(); const file = api.file(); const lines = api.lines(); const pr = api.progress();
      const staging = api.staging();
      const done = !running && lines.length > 0;
      const state = running ? 'running' : done ? 'done' : file || staging ? 'ready' : 'drop';
      shell.dataset.state = state;
      drop.hidden = state !== 'drop' && state !== 'ready' ? true : false;
      job.hidden = state === 'drop';
      results.hidden = !(lines.length > 0);
      const name = file?.name || '';
      $('fh-name').textContent = name || T('noFile');
      $('fh-tile').innerHTML = svg(state === 'done' ? 'check' : 'folder', 18);
      const sizeMb = file?.size ? `${(file.size > 1073741824 ? `${(file.size / 1073741824).toFixed(1)} GB` : `${(file.size / 1048576).toFixed(1)} MB`)}` : '';
      const optText = (id) => { const sel = $(id); return sel?.selectedOptions?.[0]?.textContent?.trim() || ''; };
      const pair = `${optText('src-lang')} ${T('to')} ${optText('tgt-lang')}`;
      const engine = $('engine-line-text')?.textContent?.trim() || '';
      const detail = [sizeMb, optText('src-lang') && optText('tgt-lang') ? pair : '', engine].filter(Boolean).join(' · ');
      const dur = lines.length ? lines[lines.length - 1].t1 || 0 : 0;
      $('fh-meta').textContent = state === 'done' ? T('doneMeta', hms(dur), pr?.total) : `${detail}${state === 'ready' && staging ? ` · ${T('staging')}` : ''}`;
      $('fh-chip').textContent = state === 'done' ? T('done') : '';
      $('fh-chip').hidden = state !== 'done';
      if (state === 'running') {
        const pct = Math.max(0, Math.min(100, pr?.pct || 0));
        $('fh-pct').textContent = `${pct}%`;
        $('fh-fill').style.width = `${pct}%`;
        $('fh-bar').setAttribute('aria-valuenow', String(pct));
        const left = pr?.idx && pr.total && pr.startedAt ? Math.round(((Date.now() - pr.startedAt) / pr.idx) * (pr.total - pr.idx) / 60000) : null;
        $('fh-win').textContent = pr?.total ? `${T('windowOf', pr.idx || 0, pr.total)}${left != null ? ` · ${T('minLeft', left)}` : ''}` : '';
      }
    };
    setInterval(paintJob, 400);
    paintJob();
    window.__ysmFilesRepaint = paintJob;
  }

  const paint = () => {
    for (const n of shell.querySelectorAll('[data-fh]')) {
      const k = n.dataset.fh;
      if (n.dataset.go) n.textContent = T(k);
      else n.textContent = T(k);
    }
    tabs.setAttribute('aria-label', T('sections'));
  };
  paint();
  window.__ysmLiveRepaint = paint; // applyI18n() calls this hook on a language change
}
