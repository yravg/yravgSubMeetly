/** Halaman daftar cacat rilis. */
import { loadDefectList, summarizeDefects } from './defects-data.js';

const SEV_LABEL = { blocker: 'Blocker', high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };
const STATUS_LABEL = { open: 'Terbuka', accepted: 'Diterima', fixed: 'Selesai' };

const $ = (id) => document.getElementById(id);

let list = null;
let statusFilter = 'all';
let sevFilter = 'all';
let mustOnly = false;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderGate(defects) {
  const s = summarizeDefects(defects);
  $('stat-total').textContent = String(s.total);
  $('stat-open').textContent = String(s.open);
  $('stat-must').textContent = String(s.mustFixOpen);
  $('stat-accepted').textContent = String(s.accepted);
  const gate = $('release-gate');
  if (s.releaseBlocked) {
    gate.textContent = `Rilis ditahan — ${s.mustFixOpen} cacat wajib masih terbuka`;
    gate.className = 'pill fail';
  } else {
    gate.textContent = 'Gerbang rilis: tidak ada cacat wajib terbuka';
    gate.className = 'pill pass';
  }
}

function renderSource(rep) {
  const el = $('data-source');
  el.textContent =
    rep.source === 'stub'
      ? 'Data tiruan (stub) — daftar dari README, lab, dan celah uji'
      : `Sumber: ${rep.source}`;
  el.className = 'pill warn';
}

function visible() {
  return list.defects.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (sevFilter !== 'all' && d.severity !== sevFilter) return false;
    if (mustOnly && !d.mustFix) return false;
    return true;
  });
}

function renderTable() {
  const rows = visible();
  $('visible-count').textContent = `${rows.length} cacat`;
  const body = $('defect-body');
  body.innerHTML = '';
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty-row">Tidak ada cacat yang cocok.</td></tr>`;
    return;
  }
  for (const d of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${escapeHtml(d.id)}</code></td>
      <td>
        <div class="feat-name">${escapeHtml(d.title)}</div>
        <div class="muted">${escapeHtml(d.summary)}</div>
      </td>
      <td><span class="pill sev-${d.severity}">${SEV_LABEL[d.severity]}</span></td>
      <td><span class="pill ${d.status}">${STATUS_LABEL[d.status]}</span></td>
      <td>${d.mustFix ? '<span class="pill fail">Wajib</span>' : '<span class="muted">Tidak</span>'}</td>
      <td>
        <div>${escapeHtml(d.area)}</div>
        <div class="muted">${escapeHtml(d.featureId)}</div>
        <div class="muted">${escapeHtml(d.evidence)}</div>
      </td>
    `;
    body.appendChild(tr);
  }
}

function bind() {
  $('status-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;
    statusFilter = btn.dataset.status;
    for (const b of $('status-filters').querySelectorAll('button')) {
      b.classList.toggle('active', b === btn);
    }
    renderTable();
  });
  $('sev-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sev]');
    if (!btn) return;
    sevFilter = btn.dataset.sev;
    for (const b of $('sev-filters').querySelectorAll('button')) {
      b.classList.toggle('active', b === btn);
    }
    renderTable();
  });
  $('must-only').addEventListener('change', (e) => {
    mustOnly = e.target.checked;
    renderTable();
  });
}

list = await loadDefectList();
bind();
renderSource(list);
renderGate(list.defects);
renderTable();
