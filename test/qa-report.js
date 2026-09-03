/** Halaman laporan uji asap dan E2E. */
import { loadQaReport, summarizeSuites } from './qa-report-data.js';

const STATUS_LABEL = {
  pass: 'Lulus',
  fail: 'Gagal',
  unverified: 'Belum diuji',
  skip: 'Dilewati',
};

const $ = (id) => document.getElementById(id);

let report = null;
let kindFilter = 'all';
let statusFilter = 'all';

function formatWhen(iso) {
  if (!iso) return 'Belum pernah';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSummary(suites) {
  const s = summarizeSuites(suites);
  $('stat-suites').textContent = String(s.total);
  $('stat-smoke').textContent = String(s.smoke);
  $('stat-e2e').textContent = String(s.e2e);
  $('stat-pass').textContent = String(s.pass);
  $('stat-unverified').textContent = String(s.unverified);
  $('stat-fail').textContent = String(s.fail);
  $('checks-label').textContent = `${s.checksPass} / ${s.checks} cek lulus`;
}

function renderSource(rep) {
  const el = $('data-source');
  if (rep.source === 'stub') {
    el.textContent = 'Data tiruan (stub) — skrip smoke/E2E tidak dijalankan dari halaman ini';
    el.className = 'pill warn';
  } else {
    el.textContent = `Sumber: ${rep.source}`;
    el.className = 'pill ok';
  }
  $('generated-at').textContent = `Diperbarui ${formatWhen(rep.generatedAt)}`;
}

function visibleSuites() {
  return report.suites.filter((s) => {
    if (kindFilter !== 'all' && s.kind !== kindFilter) return false;
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    return true;
  });
}

function renderSuites() {
  const list = $('suite-list');
  list.innerHTML = '';
  const rows = visibleSuites();
  $('visible-count').textContent = `${rows.length} suite`;
  if (!rows.length) {
    list.innerHTML = `<p class="empty">Tidak ada suite yang cocok dengan filter.</p>`;
    return;
  }
  for (const s of rows) {
    const el = document.createElement('article');
    el.className = 'suite';
    el.innerHTML = `
      <header class="suite-head">
        <div>
          <div class="suite-kind">${s.kind === 'smoke' ? 'Uji asap' : 'E2E'}</div>
          <h2>${escapeHtml(s.name)}</h2>
        </div>
        <span class="pill ${s.status}">${STATUS_LABEL[s.status]}</span>
      </header>
      <p class="covers">${escapeHtml(s.covers)}</p>
      <dl class="meta-grid">
        <div><dt>Perintah</dt><dd><code>${escapeHtml(s.command)}</code></dd></div>
        <div><dt>Durasi</dt><dd>${escapeHtml(formatDuration(s.durationMs))}</dd></div>
        <div><dt>Terakhir</dt><dd>${escapeHtml(formatWhen(s.lastRun))}</dd></div>
      </dl>
      <table class="checks">
        <thead>
          <tr><th>Cek</th><th>Status</th><th>Detail</th></tr>
        </thead>
        <tbody>
          ${s.checks
            .map(
              (c) => `
            <tr>
              <td>${escapeHtml(c.name)}</td>
              <td><span class="pill ${c.status}">${STATUS_LABEL[c.status]}</span></td>
              <td class="muted">${escapeHtml(c.detail)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <details class="log-wrap">
        <summary>Log (${s.log.length} baris)</summary>
        <pre class="log">${s.log.map(escapeHtml).join('\n')}</pre>
      </details>
    `;
    list.appendChild(el);
  }
}

function bind() {
  $('kind-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    kindFilter = btn.dataset.kind;
    for (const b of $('kind-filters').querySelectorAll('button')) {
      b.classList.toggle('active', b === btn);
    }
    renderSuites();
  });
  $('status-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;
    statusFilter = btn.dataset.status;
    for (const b of $('status-filters').querySelectorAll('button')) {
      b.classList.toggle('active', b === btn);
    }
    renderSuites();
  });
}

report = await loadQaReport();
bind();
renderSource(report);
renderSummary(report.suites);
renderSuites();
