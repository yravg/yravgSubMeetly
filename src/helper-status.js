/**
 * Kartu status helper lintas platform + indikator mode + berkas besar (stub UI).
 */
import { detectOs, guideFor, STUB_LARGE_FILE, formatBytes } from './lib/helper-status.js';
import { formatSrt, formatVtt, formatTxt } from './lib/transcript-cache.js';
import { STUB_TRANSCRIPT } from './lib/notes-stub.js';
import { I18N } from './lib/i18n.js';
import {
  EXPORT_FORMATS,
  normalizeExportOptions,
  applyExportOptions,
  exportFilename,
  exportMime,
  describeExportOptions,
} from './lib/export-options.js';

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
 * @param {string} [opts.os]    override OS guide (macos|windows|linux) for previews
 * @param {string} [opts.lang]  UI language for the large-file block (en|zh|id…)
 * @param {object|null} [opts.largeFile]  real helper job: { name, sizeBytes, progress 0–1, status, stage, loaded, total, idx, elapsedS, error, cancellable }
 * @param {() => void} [opts.onCancelLargeFile]  cancel handler (falls back to a local UI-only cancel for previews)
 * @param {object} [opts.exportOptions]   { crlf, bom, langSuffix } (normalised against the OS default)
 * @param {(patch: object) => void} [opts.onExportOptionChange]
 * @param {(kind: 'srt'|'vtt'|'txt') => void} [opts.onExport]   real export; absent → demo download of STUB_TRANSCRIPT
 * @param {{ title?: string, count?: number, srcLang?: string, tgtLang?: string }} [opts.exportSource]
 * @param {string|null} [opts.exportFolder]  chosen export folder label (null = Downloads)
 */
export function renderHelperStatusCard(root, opts) {
  const os = opts.os || detectOs();
  const guide = guideFor(os, opts.lang || 'en');
  const online = !!opts.online;
  const health = opts.health || null;
  const engine = opts.engine || 'browser';
  const task = opts.task || 'transcribe';
  const mode = opts.mode || 'realtime';

  const dict = I18N[opts.lang] || I18N.en;
  const tt = (k, ...a) => {
    const v = dict[k] ?? I18N.en[k] ?? k;
    return typeof v === 'function' ? v(...a) : v;
  };
  // Real job from the side panel; previews may pass STUB_LARGE_FILE explicitly.
  const lf = opts.largeFile === undefined ? STUB_LARGE_FILE : opts.largeFile;
  const pct = lf ? Math.round((lf.progress || 0) * 100) : 0;
  const lfStage = lf ? tt(`lfStage_${lf.stage || lf.status}`, lf.stage || lf.status) : '';
  const lfDetail = lf
    ? [
        lf.stage === 'upload' && lf.total ? `${formatBytes(lf.loaded || 0)} / ${formatBytes(lf.total)}` : '',
        lf.idx != null && lf.total && lf.stage !== 'upload' ? `${lf.idx} / ${lf.total}` : '',
        lf.elapsedS ? tt('lfElapsed', lf.elapsedS) : '',
        lf.status === 'error' && lf.error ? lf.error : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const lfState = lf ? lf.status : 'idle';
  const lang = opts.lang || 'en';
  const xo = normalizeExportOptions(opts.exportOptions, os);
  const src = opts.exportSource || null;
  const hasSource = !!(src && src.count > 0);
  const exportTitle = (src && src.title) || (typeof opts.onExport === 'function' ? 'subtitles' : 'meeting_notes_demo');

  root.innerHTML = `
    <div class="helper-status" data-os="${escapeHtml(os)}">
      <div class="notes-status-row">
        <span class="notes-pill ${online ? 'ready' : 'error'}" id="helper-conn-pill">
          ${escapeHtml(tt(online ? 'hsConnected' : 'hsDisconnected'))}
        </span>
        <span class="notes-meta">${escapeHtml(guide.label)} · ${escapeHtml(guide.engine)}</span>
      </div>

      <div class="helper-indicators" id="helper-mode-indicators">
        <span class="notes-pill idle">${escapeHtml(tt('hsMode'))}: <strong>${escapeHtml(mode)}</strong></span>
        <span class="notes-pill idle">${escapeHtml(tt('hsTask'))}: <strong>${escapeHtml(task)}</strong></span>
        <span class="notes-pill idle">${escapeHtml(tt('hsEngine'))}: <strong>${escapeHtml(engine)}</strong></span>
        ${
          health
            ? `<span class="notes-pill ready">${escapeHtml(health.engine || 'asr')} · ${escapeHtml((health.model || '').split('/').pop() || '')}</span>`
            : ''
        }
        ${
          health && health.device
            ? `<span class="notes-pill ${String(health.device).toLowerCase() === 'cpu' ? 'idle' : 'ready'}" id="helper-device-pill" title="${escapeHtml(health.compute || '')}">${
                String(health.device).toLowerCase() === 'apple-silicon' ? 'Apple Silicon · MLX' : String(health.device).toLowerCase() === 'cuda' ? 'GPU · CUDA' : 'CPU'
              }${health.compute && String(health.device).toLowerCase() !== 'apple-silicon' ? ` · ${escapeHtml(health.compute)}` : ''}</span>`
            : ''
        }
      </div>

      <div id="helper-disconnect-banner" class="helper-banner ${online || engine !== 'native' ? 'hidden' : ''}">
        <strong>${escapeHtml(tt('hsDisconnected'))}</strong> — ${escapeHtml(tt('hsDisconnectedBody', guide.label))}
      </div>

      <div class="notes-block">
        <h3>${escapeHtml(tt('hsGuideTitle', guide.label))}</h3>
        <ol class="helper-steps">
          ${guide.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
        </ol>
      </div>

      <div class="notes-block helper-lf ${escapeHtml(lfState)}" id="helper-large-file" data-state="${escapeHtml(lfState)}">
        <div class="notes-block-head">
          <h3>${escapeHtml(tt('lfTitle'))}</h3>
          ${lf ? `<span class="notes-pill ${lfState === 'running' ? 'generating' : lfState === 'done' ? 'ready' : lfState === 'error' ? 'error' : 'idle'}" id="helper-lf-state">${escapeHtml(lfStage)}</span>` : ''}
        </div>
        ${
          lf
            ? `
        <p class="notes-meta helper-lf-name" title="${escapeHtml(lf.name)}">${escapeHtml(lf.name)} · ${formatBytes(lf.sizeBytes || 0)}</p>
        <div class="helper-progress-track" role="progressbar" aria-label="${escapeHtml(lfStage)}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="helper-progress-bar ${lfState === 'running' && lf.stage !== 'upload' ? 'indeterminate' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="notes-status-row" style="margin-top:8px">
          <span class="notes-meta" id="helper-lf-pct">${pct}%${lfDetail ? ` · ${escapeHtml(lfDetail)}` : ''}</span>
          <button type="button" class="mini-btn" id="btn-helper-lf-cancel" ${lf.cancellable && lfState === 'running' ? '' : 'disabled'}>
            ${escapeHtml(tt('lfCancel'))}
          </button>
        </div>`
            : `<p class="notes-meta">${escapeHtml(tt('lfIdle'))}</p>`
        }
      </div>

      <div class="notes-block helper-export" id="helper-export">
        <div class="notes-block-head">
          <h3>${escapeHtml(tt('exportTitle'))}</h3>
          <span class="notes-pill ${hasSource ? 'ready' : 'idle'}" id="helper-export-source">${
            hasSource ? escapeHtml(tt('exportSource', src.count)) : escapeHtml(guide.label)
          }</span>
        </div>
        ${hasSource ? '' : `<p class="notes-meta">${escapeHtml(tt('exportNoSource'))}</p>`}
        <div class="helper-export-formats" role="group" aria-label="${escapeHtml(tt('exportTitle'))}">
          ${EXPORT_FORMATS.map(
            (f) => `
          <button type="button" class="helper-export-btn" data-export-kind="${f.kind}" ${hasSource || !opts.onExport ? '' : 'disabled'}>
            <span class="helper-export-kind">${f.label}</span>
            <span class="helper-export-desc">${escapeHtml(f.desc[lang] || f.desc.en)}</span>
          </button>`,
          ).join('')}
        </div>
        <div class="helper-export-opts">
          <label class="dual-inline"><span>${escapeHtml(tt('exportCrlf'))}</span><input type="checkbox" class="switch" data-export-opt="crlf" ${xo.crlf ? 'checked' : ''} /></label>
          <label class="dual-inline"><span>${escapeHtml(tt('exportBom'))}</span><input type="checkbox" class="switch" data-export-opt="bom" ${xo.bom ? 'checked' : ''} /></label>
          <label class="dual-inline"><span>${escapeHtml(tt('exportLangSuffix'))}</span><input type="checkbox" class="switch" data-export-opt="langSuffix" ${xo.langSuffix ? 'checked' : ''} /></label>
        </div>
        <div class="notes-status-row helper-export-foot">
          <span class="notes-meta" id="helper-export-name-hint"></span>
          <button type="button" class="mini-btn" id="btn-export-os-default" title="${escapeHtml(tt('exportOsDefault', guide.label))}">${escapeHtml(tt('exportReset'))}</button>
        </div>
        <p class="notes-meta helper-export-target">${escapeHtml(tt('exportTarget', opts.exportFolder || ''))} · ${escapeHtml(describeExportOptions(xo))}</p>
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
  const title = exportTitle;
  const nameFor = (kind) => exportFilename(title, kind, { srcLang: src?.srcLang, tgtLang: src?.tgtLang, langSuffix: xo.langSuffix });
  if (hint) {
    hint.textContent = `${tt('exportPreview')}: ${nameFor('srt')}`;
  }

  root.querySelectorAll('[data-export-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.getAttribute('data-export-kind');
      if (typeof opts.onExport === 'function') {
        opts.onExport(kind);
        if (hint) hint.textContent = `${tt('exportPreview')}: ${nameFor(kind)}`;
        return;
      }
      // Harness / preview: download the demo transcript with the chosen options.
      let body = '';
      if (kind === 'srt') body = formatSrt(cues, { dualLine: false, title });
      else if (kind === 'vtt') body = formatVtt(cues, { dualLine: false, title });
      else body = formatTxt(cues, { title });
      body = applyExportOptions(body, xo);
      const name = nameFor(kind);
      const url = URL.createObjectURL(new Blob([body], { type: `${exportMime(kind)};charset=utf-8` }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      if (hint) hint.textContent = `${tt('exportPreview')}: ${name}`;
    });
  });

  root.querySelectorAll('[data-export-opt]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const patch = { [cb.getAttribute('data-export-opt')]: cb.checked };
      if (typeof opts.onExportOptionChange === 'function') opts.onExportOptionChange(patch);
      else renderHelperStatusCard(root, { ...opts, exportOptions: { ...xo, ...patch } });
    });
  });
  root.querySelector('#btn-export-os-default')?.addEventListener('click', () => {
    const d = normalizeExportOptions(null, os);
    if (typeof opts.onExportOptionChange === 'function') opts.onExportOptionChange(d);
    else renderHelperStatusCard(root, { ...opts, exportOptions: d });
  });

  root.querySelector('#btn-helper-lf-cancel')?.addEventListener('click', () => {
    btnDisabled(root.querySelector('#btn-helper-lf-cancel'));
    if (typeof opts.onCancelLargeFile === 'function') {
      opts.onCancelLargeFile();
      return;
    }
    // Preview / harness: local UI-only cancel.
    const pctEl = root.querySelector('#helper-lf-pct');
    if (pctEl) pctEl.textContent = `${pct}% · ${tt('lfStage_cancelled')}`;
    const stateEl = root.querySelector('#helper-lf-state');
    if (stateEl) stateEl.textContent = tt('lfStage_cancelled');
    const bar = root.querySelector('.helper-progress-bar');
    if (bar) bar.style.opacity = '0.4';
  });
}

function btnDisabled(el) {
  if (el) el.disabled = true;
}

export function mountHelperStatusCard(root, getOpts) {
  const draw = () => {
    renderHelperStatusCard(root, getOpts());
    // Ekspor milik riwayat/sesi, bukan helper: pindahkan bloknya ke bawah History
    // bila halaman menyediakan tempatnya (side panel produksi & app.html).
    const exp = root.querySelector('#helper-export');
    const mount = document.getElementById('export-mount');
    if (exp && mount) { mount.replaceChildren(exp); }
  };
  draw();
  return draw;
}
