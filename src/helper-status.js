/**
 * Kartu status helper lintas platform + indikator mode + berkas besar (stub UI).
 */
import {
  detectOs,
  OS_GUIDES,
  exportBasename,
  STUB_LARGE_FILE,
  formatBytes,
} from './lib/helper-status.js';
import { formatSrt, formatVtt, formatTxt } from './lib/transcript-cache.js';
import { STUB_TRANSCRIPT } from './lib/notes-stub.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} opts
 * @param {boolean} opts.online
 * @param {object | null} opts.health
 * @param {string} opts.engine  browser|native
 * @param {string} opts.task    transcribe|translate
 * @param {string} opts.mode    realtime|offline
 */
export function renderHelperStatusCard(root, opts) {
  const os = detectOs();
  const guide = OS_GUIDES[os] || OS_GUIDES.unknown;
  const online = !!opts.online;
  const health = opts.health || null;
  const engine = opts.engine || 'browser';
  const task = opts.task || 'transcribe';
  const mode = opts.mode || 'realtime';

  const lf = opts.largeFile || STUB_LARGE_FILE;
  const pct = Math.round((lf.progress || 0) * 100);

  root.innerHTML = `
    <div class="helper-status" data-os="${escapeHtml(os)}">
      <div class="notes-status-row">
        <span class="notes-pill ${online ? 'ready' : 'error'}" id="helper-conn-pill">
          ${online ? 'Helper terhubung' : 'Helper terputus'}
        </span>
        <span class="notes-meta">${escapeHtml(guide.label)} · ${escapeHtml(guide.engine)}</span>
      </div>

      <div class="helper-indicators" id="helper-mode-indicators">
        <span class="notes-pill idle">Mode: <strong>${escapeHtml(mode)}</strong></span>
        <span class="notes-pill idle">Tugas: <strong>${escapeHtml(task)}</strong></span>
        <span class="notes-pill idle">Mesin: <strong>${escapeHtml(engine)}</strong></span>
        ${
          health
            ? `<span class="notes-pill ready">${escapeHtml(health.engine || 'asr')} · ${escapeHtml((health.model || '').split('/').pop() || '')}</span>`
            : ''
        }
      </div>

      <div id="helper-disconnect-banner" class="helper-banner ${online || engine !== 'native' ? 'hidden' : ''}">
        <strong>Helper terputus</strong> — subtitel tab lewat mesin native tidak bisa berjalan.
        Beralih ke Browser di Settings, atau ikuti panduan ${escapeHtml(guide.label)} di bawah.
      </div>

      <div class="notes-block">
        <h3>Panduan ${escapeHtml(guide.label)}</h3>
        <ol class="helper-steps">
          ${guide.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
        </ol>
      </div>

      <div class="notes-block" id="helper-large-file">
        <h3>Berkas besar (contoh UI)</h3>
        <p class="notes-meta">${escapeHtml(lf.name)} · ${formatBytes(lf.sizeBytes)}</p>
        <div class="helper-progress-track" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="helper-progress-bar" style="width:${pct}%"></div>
        </div>
        <div class="notes-status-row" style="margin-top:8px">
          <span class="notes-meta" id="helper-lf-pct">${pct}% · ${escapeHtml(lf.status)}</span>
          <button type="button" class="mini-btn" id="btn-helper-lf-cancel" ${lf.cancellable && lf.status === 'running' ? '' : 'disabled'}>
            Batalkan
          </button>
        </div>
      </div>

      <div class="notes-block">
        <h3>Ekspor transkrip tiruan</h3>
        <p class="notes-meta">Nama berkas seragam di Windows / Linux / macOS.</p>
        <div class="notes-toolbar">
          <button type="button" class="mini-btn" data-export-kind="srt">SRT</button>
          <button type="button" class="mini-btn" data-export-kind="vtt">VTT</button>
          <button type="button" class="mini-btn" data-export-kind="txt">TXT</button>
        </div>
        <p class="notes-meta" id="helper-export-name-hint"></p>
      </div>
    </div>
  `;

  const cues = STUB_TRANSCRIPT.map((l, i) => ({
    t0: l.t0,
    t1: l.t1,
    src: `${l.speaker}: ${l.text}`,
    tgt: `${l.speaker}: ${l.text}`,
  }));

  const hint = root.querySelector('#helper-export-name-hint');
  const title = 'meeting_notes_demo';
  if (hint) {
    hint.textContent = `Contoh: ${exportBasename(title, 'srt')} · ${exportBasename(title, 'vtt')} · ${exportBasename(title, 'txt')}`;
  }

  root.querySelectorAll('[data-export-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.getAttribute('data-export-kind');
      let body = '';
      if (kind === 'srt') body = formatSrt(cues, { dualLine: false, title });
      else if (kind === 'vtt') body = formatVtt(cues, { dualLine: false, title });
      else body = formatTxt(cues, { title });
      const name = exportBasename(title, kind);
      const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      if (hint) hint.textContent = `Diunduh: ${name}`;
    });
  });

  root.querySelector('#btn-helper-lf-cancel')?.addEventListener('click', () => {
    const pctEl = root.querySelector('#helper-lf-pct');
    if (pctEl) pctEl.textContent = `${pct}% · cancelled`;
    const bar = root.querySelector('.helper-progress-bar');
    if (bar) bar.style.opacity = '0.4';
    btnDisabled(root.querySelector('#btn-helper-lf-cancel'));
  });
}

function btnDisabled(el) {
  if (el) el.disabled = true;
}

export function mountHelperStatusCard(root, getOpts) {
  const draw = () => renderHelperStatusCard(root, getOpts());
  draw();
  return draw;
}
