/**
 * Panel "Panduan pemasangan & pemecahan masalah" Native Helper (Windows / Linux / macOS).
 * Renderer DOM di atas src/lib/helper-guide.js (data + diagnostik).
 *
 * Dipasang di kartu Native Helper Side Panel (sidepanel.js) dan di harness
 * test/helper-guide.html. Redraw mempertahankan tab OS dan <details> yang terbuka.
 */
import {
  GUIDE_OS_ORDER,
  INSTALL_GUIDES,
  guideOsFor,
  makeGuideT,
  runDiagnostics,
  summarizeDiagnostics,
  relevantTroubleshooting,
  pickLang,
  cmdFor,
} from './lib/helper-guide.js';
import { detectOs } from './lib/helper-status.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

const STATE_ICON = { ok: '●', warn: '●', fail: '●', unknown: '○' };

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {string} [opts.os]                  macos|windows|linux (default: detectOs())
 * @param {string} [opts.lang]                en|id (locale lain → en)
 * @param {object|null} [opts.health]         respons /health atau null
 * @param {string} [opts.engine]              browser|native
 * @param {boolean} [opts.nativeHostSupported]
 * @param {boolean|null} [opts.hostInstalled]
 * @param {() => void} [opts.onRecheck]       tombol Periksa ulang
 * @param {{ os?: string, open?: Set<string> }} [ui] state UI yang dipertahankan antar redraw
 */
export function renderHelperGuide(root, opts = {}, ui = {}) {
  const lang = opts.lang && opts.lang in { en: 1, id: 1 } ? opts.lang : 'en';
  const G = makeGuideT(lang);
  const detected = guideOsFor(opts.os || detectOs());
  const os = ui.os || detected;
  const open = ui.open || new Set();
  const guide = INSTALL_GUIDES[os];
  const checks = runDiagnostics({ ...opts, os: detected, lang });
  const sum = summarizeDiagnostics(checks);
  const tips = relevantTroubleshooting(os, checks);
  const online = !!opts.health;
  const engine = opts.engine || 'browser';

  const intro = online
    ? sum.healthy
      ? `<div class="hg-banner ok">${esc(G('allGood'))}</div>`
      : ''
    : engine === 'native'
      ? `<div class="hg-banner fail">${esc(G('offlineIntro'))}</div>`
      : `<div class="hg-banner idle">${esc(G('browserEngineNote'))}</div>`;

  root.innerHTML = `
    <div class="helper-guide" data-os="${esc(os)}" data-lang="${esc(lang)}">
      <div class="hg-head">
        <div>
          <h3 class="hg-title">${esc(G('title'))}</h3>
          <p class="notes-meta">${esc(G('subtitle'))}</p>
        </div>
        <button type="button" class="mini-btn" id="hg-recheck">${esc(G('rerun'))}</button>
      </div>

      ${intro}

      <div class="notes-block hg-diag">
        <div class="notes-block-head">
          <h3>${esc(G('diagnostics'))}</h3>
          <span class="hg-diag-sum">
            <span class="hg-dot ok"></span>${sum.ok}
            <span class="hg-dot warn"></span>${sum.warn}
            <span class="hg-dot fail"></span>${sum.fail}
          </span>
        </div>
        <ul class="hg-checks">
          ${checks
            .map(
              (c) => `
            <li class="hg-check ${esc(c.state)}" data-check="${esc(c.id)}">
              <span class="hg-check-icon" aria-hidden="true">${STATE_ICON[c.state] || '○'}</span>
              <span class="hg-check-body">
                <span class="hg-check-label">${esc(c.label)}</span>
                <span class="hg-check-detail">${esc(c.detail)}</span>
              </span>
              <span class="hg-check-state">${esc(G(`state${c.state[0].toUpperCase()}${c.state.slice(1)}`))}</span>
            </li>`,
            )
            .join('')}
        </ul>
      </div>

      <div class="notes-block hg-install hg-collapsible${ui.open.has('sec:install') ? '' : ' collapsed'}">
        <div class="notes-block-head hg-sec-head" data-sec="install" role="button" tabindex="0" aria-expanded="${ui.open.has('sec:install')}">
          <h3>${esc(G('steps'))}</h3>
          <div class="seg hg-os-tabs" role="tablist" aria-label="${esc(G('tabs'))}">
            ${GUIDE_OS_ORDER.map(
              (o) =>
                `<button type="button" role="tab" data-os="${o}" class="${o === os ? 'active' : ''}" aria-selected="${o === os}">${esc(G(`os.${o}`))}${o === detected ? ' ·' : ''}</button>`,
            ).join('')}
          </div>
        </div>
        <p class="notes-meta hg-engine">${esc(G(`osEngine.${os}`))}</p>

        <details class="hg-details" data-key="prereqs" ${open.has('prereqs') ? 'open' : ''}>
          <summary>${esc(G('prereqs'))}</summary>
          <ul class="hg-prereqs">${(guide.prereqs[lang] || guide.prereqs.en).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        </details>

        <ol class="hg-steps">
          ${guide.steps
            .map(
              (s, i) => `
            <li class="hg-step">
              <div class="hg-step-text">${esc(pickLang(s.text, lang))}</div>
              ${
                s.cmd
                  ? `<div class="hg-cmd"><code>${esc(s.cmd)}</code><button type="button" class="mini-btn hg-copy" data-copy="${esc(s.cmd)}" aria-label="${esc(G('copy'))} ${i + 1}">${esc(G('copy'))}</button></div>`
                  : ''
              }
            </li>`,
            )
            .join('')}
        </ol>
        <p class="notes-meta hg-extid">${esc(G('extIdHint'))}</p>

        <details class="hg-details" data-key="manifest" ${open.has('manifest') ? 'open' : ''}>
          <summary>${esc(G('hostManifest'))}</summary>
          <div class="hg-cmd"><code>${esc(guide.hostManifest)}</code><button type="button" class="mini-btn hg-copy" data-copy="${esc(guide.hostManifest)}">${esc(G('copy'))}</button></div>
          ${guide.hostManifestChromium ? `<div class="hg-cmd"><code>${esc(guide.hostManifestChromium)}</code><button type="button" class="mini-btn hg-copy" data-copy="${esc(guide.hostManifestChromium)}">${esc(G('copy'))}</button></div>` : ''}
          ${guide.hostRegistry ? `<div class="hg-cmd"><code>${esc(guide.hostRegistry)}</code><button type="button" class="mini-btn hg-copy" data-copy="${esc(guide.hostRegistry)}">${esc(G('copy'))}</button></div>` : ''}
        </details>
      </div>

      <div class="notes-block hg-ts hg-collapsible${ui.open.has('sec:ts') ? '' : ' collapsed'}">
        <div class="notes-block-head hg-sec-head" data-sec="ts" role="button" tabindex="0" aria-expanded="${ui.open.has('sec:ts')}">
          <h3>${esc(G('troubleshooting'))}</h3>
          <span class="notes-meta">${tips.length}</span>
        </div>
        <div class="hg-ts-list">
          ${tips
            .map((e) => {
              const cmd = cmdFor(e, os);
              const key = `ts:${e.id}`;
              return `
            <details class="hg-details hg-ts-item ${e.flagged ? `flagged-${e.flagged}` : ''}" data-key="${esc(key)}" data-ts="${esc(e.id)}" ${open.has(key) || (e.flagged === 'fail' && !ui.touched) ? 'open' : ''}>
              <summary>
                <span class="hg-ts-symptom">${esc(pickLang(e.symptom, lang))}</span>
                ${e.flagged ? `<span class="hg-flag ${e.flagged}">${esc(G('relatedFail'))}</span>` : ''}
              </summary>
              <div class="hg-ts-body">
                <p><strong>${esc(G('cause'))}:</strong> ${esc(pickLang(e.cause, lang))}</p>
                <p><strong>${esc(G('fix'))}:</strong> ${esc(pickLang(e.fix, lang))}</p>
                ${cmd ? `<div class="hg-cmd"><code>${esc(cmd)}</code><button type="button" class="mini-btn hg-copy" data-copy="${esc(cmd)}">${esc(G('copy'))}</button></div>` : ''}
              </div>
            </details>`;
            })
            .join('')}
        </div>
      </div>
    </div>
  `;

  // ---- wiring ---------------------------------------------------------
  root.querySelectorAll('.hg-os-tabs [data-os]').forEach((b) => {
    b.addEventListener('click', () => {
      ui.os = b.getAttribute('data-os');
      ui.touched = true;
      renderHelperGuide(root, opts, ui);
    });
  });

  root.querySelectorAll('details.hg-details').forEach((d) => {
    d.addEventListener('toggle', () => {
      const k = d.getAttribute('data-key');
      if (!k) return;
      ui.touched = true;
      if (d.open) open.add(k);
      else open.delete(k);
      ui.open = open;
    });
  });

  root.querySelectorAll('.hg-copy').forEach((b) => {
    b.addEventListener('click', async () => {
      const ok = await copyText(b.getAttribute('data-copy') || '');
      const orig = b.textContent;
      b.textContent = ok ? G('copied') : '✕';
      b.classList.toggle('copied', ok);
      setTimeout(() => {
        b.textContent = orig;
        b.classList.remove('copied');
      }, 1400);
    });
  });

  // Install steps & Troubleshooting tertutup secara bawaan — panel ini dibuka orang
  // yang ingin status, bukan tutorial; klik judulnya untuk membuka.
  root.querySelectorAll('.hg-sec-head[data-sec]').forEach((head) => {
    const toggle = (e) => {
      if (e.target.closest('button, a, [role="tab"]')) return; // tab OS / tombol di kepala
      const key = `sec:${head.dataset.sec}`;
      if (ui.open.has(key)) ui.open.delete(key); else ui.open.add(key);
      renderHelperGuide(root, opts, ui);
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
  });

  root.querySelector('#hg-recheck')?.addEventListener('click', () => {
    if (typeof opts.onRecheck === 'function') opts.onRecheck();
    else renderHelperGuide(root, opts, ui);
  });

  return { checks, summary: sum, os, lang };
}

/**
 * Pasang panel dengan getter opsi; mengembalikan fungsi redraw yang
 * mempertahankan tab OS + <details> terbuka.
 */
export function mountHelperGuide(root, getOpts) {
  const ui = { os: null, open: new Set(), touched: false };
  const draw = () => renderHelperGuide(root, getOpts(), ui);
  draw();
  return draw;
}
