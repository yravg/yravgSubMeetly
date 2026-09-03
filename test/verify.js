/** Dashboard status verifikasi 26 sub-fitur Fase 1. */
import { loadVerifyCatalog, summarize, VERIFY_TARGET } from './verify-data.js';

const STATUS_LABEL = {
  pass: 'Lulus',
  fail: 'Gagal',
  warn: 'Peringatan',
  unverified: 'Belum diuji',
};

const $ = (id) => document.getElementById(id);

let catalog = null;
let groupFilter = 'all';
let statusFilter = 'all';
let query = '';

function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function renderSummary(features) {
  const s = summarize(features);
  $('stat-total').textContent = String(s.total);
  $('stat-pass').textContent = String(s.pass);
  $('stat-warn').textContent = String(s.warn);
  $('stat-fail').textContent = String(s.fail);
  $('stat-unverified').textContent = String(s.unverified);
  const pct = s.total ? Math.round((s.pass / s.total) * 100) : 0;
  $('progress-bar').style.width = `${pct}%`;
  $('progress-label').textContent = `${s.pass} / ${s.total} lulus (${pct}%)`;

  const mismatch = $('count-mismatch');
  if (s.total !== VERIFY_TARGET) {
    mismatch.hidden = false;
    mismatch.textContent = `Katalog harus berisi ${VERIFY_TARGET} sub-fitur, sekarang ${s.total}.`;
  } else {
    mismatch.hidden = true;
  }
}

function filtered(features) {
  const q = query.trim().toLowerCase();
  return features.filter((f) => {
    if (groupFilter !== 'all' && f.group !== groupFilter) return false;
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    if (!q) return true;
    return [f.name, f.summary, f.surface, f.id, f.evidence.label]
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}

function evidenceCell(ev) {
  if (ev.href) {
    return `<a href="${ev.href}">${escapeHtml(ev.label)}</a>`;
  }
  return `<span class="muted">${escapeHtml(ev.label)}</span>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderGroups(features) {
  const groups = [...new Set(features.map((f) => f.group))];
  const nav = $('group-filters');
  nav.innerHTML = '';
  for (const [value, label] of [['all', 'Semua grup'], ...groups.map((g) => [g, g])]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${groupFilter === value ? ' active' : ''}`;
    btn.textContent = label;
    btn.dataset.group = value;
    nav.appendChild(btn);
  }
}

function renderTable(features) {
  const rows = filtered(features);
  $('visible-count').textContent = `${rows.length} ditampilkan`;
  const body = $('feature-body');
  body.innerHTML = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" class="empty-row">Tidak ada sub-fitur yang cocok dengan filter.</td>`;
    body.appendChild(tr);
    return;
  }

  let lastGroup = null;
  for (const f of rows) {
    if (f.group !== lastGroup) {
      lastGroup = f.group;
      const hr = document.createElement('tr');
      hr.className = 'group-row';
      hr.innerHTML = `<td colspan="6">${escapeHtml(f.group)}</td>`;
      body.appendChild(hr);
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${escapeHtml(f.id)}</code></td>
      <td>
        <div class="feat-name">${escapeHtml(f.name)}</div>
        <div class="feat-sum">${escapeHtml(f.summary)}</div>
      </td>
      <td class="muted">${escapeHtml(f.surface)}</td>
      <td><span class="pill ${f.status}">${STATUS_LABEL[f.status]}</span></td>
      <td>${evidenceCell(f.evidence)}</td>
      <td class="muted">${escapeHtml(formatWhen(f.lastRun))}</td>
    `;
    body.appendChild(tr);
  }
}

function renderSource(cat) {
  const el = $('data-source');
  if (cat.source === 'stub') {
    el.textContent = 'Data tiruan (stub) — hasil smoke/E2E/lab belum terhubung';
    el.className = 'pill warn';
  } else {
    el.textContent = `Sumber: ${cat.source}`;
    el.className = 'pill ok';
  }
  $('generated-at').textContent = `Diperbarui ${formatWhen(cat.generatedAt)}`;
}

function bind() {
  $('group-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-group]');
    if (!btn) return;
    groupFilter = btn.dataset.group;
    for (const b of $('group-filters').querySelectorAll('button')) {
      b.classList.toggle('active', b === btn);
    }
    renderTable(catalog.features);
  });

  $('status-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;
    statusFilter = btn.dataset.status;
    for (const b of $('status-filters').querySelectorAll('button')) {
      b.classList.toggle('active', b === btn);
    }
    renderTable(catalog.features);
  });

  $('search').addEventListener('input', (e) => {
    query = e.target.value;
    renderTable(catalog.features);
  });
}

const catalogData = await loadVerifyCatalog();
catalog = catalogData;
bind();
renderSource(catalog);
renderSummary(catalog.features);
renderGroups(catalog.features);
renderTable(catalog.features);
