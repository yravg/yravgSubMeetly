/** Lab benchmark kinerja model. */
import {
  loadBenchReport,
  summarizeModels,
  TARGET_DRAFT_MS,
} from './bench-models-data.js';

const STATUS_LABEL = {
  pass: 'Lulus target',
  fail: 'Di atas target',
  warn: 'Mendekati / campur',
  unverified: 'Belum diukur',
};

const $ = (id) => document.getElementById(id);

let report = null;
let engineFilter = 'all';
let statusFilter = 'all';

function fmtMs(n) {
  if (n == null) return '—';
  return `${n} ms`;
}

function fmtRtf(n) {
  if (n == null) return '—';
  return String(n);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function msClass(ms) {
  if (ms == null) return '';
  if (ms <= TARGET_DRAFT_MS) return 'ok';
  if (ms <= 900) return 'warn';
  return 'bad';
}

function renderSummary(models) {
  const s = summarizeModels(models);
  $('stat-total').textContent = String(s.total);
  $('stat-pass').textContent = String(s.pass);
  $('stat-warn').textContent = String(s.warn);
  $('stat-fail').textContent = String(s.fail);
  $('target-label').textContent = `Target draft ≤ ${TARGET_DRAFT_MS} ms`;
}

function renderSource(rep) {
  const el = $('data-source');
  if (String(rep.source).startsWith('stub')) {
    el.textContent =
      rep.source === 'stub+last-bench.json'
        ? 'Stub browser + last-bench.json untuk native'
        : 'Data tiruan (stub) — inferensi tidak dijalankan';
    el.className = 'pill warn';
  } else {
    el.textContent = `Sumber: ${rep.source}`;
    el.className = 'pill ok';
  }
  $('generated-at').textContent = rep.generatedAt ? `Cuplikan ${rep.generatedAt}` : '';
  const h = rep.nativeHealth;
  const health = $('native-health');
  if (h?.ok) {
    health.textContent = `Native: ${h.engine} · ${(h.model || '').split('/').pop()}`;
    health.className = 'pill ok';
  } else {
    health.textContent = 'Native: tidak ada last-bench.json';
    health.className = 'pill unverified';
  }
}

function visibleModels() {
  return report.models.filter((m) => {
    if (engineFilter !== 'all' && m.engine !== engineFilter) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    return true;
  });
}

function renderTable() {
  const rows = visibleModels();
  $('visible-count').textContent = `${rows.length} model`;
  const body = $('model-body');
  body.innerHTML = '';
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-row">Tidak ada model yang cocok.</td></tr>`;
    return;
  }
  for (const m of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="feat-name">${escapeHtml(m.name)}</div>
        <div class="muted">${escapeHtml(m.id)}</div>
      </td>
      <td>${m.engine === 'native' ? 'Native helper' : 'Browser'}</td>
      <td class="muted">${escapeHtml(m.device)} · ${escapeHtml(m.size)}</td>
      <td class="${msClass(m.draftMs)}">${escapeHtml(fmtMs(m.draftMs))}</td>
      <td>${escapeHtml(fmtMs(m.asrMs))}</td>
      <td>${escapeHtml(fmtMs(m.mtMs))}</td>
      <td>${escapeHtml(fmtRtf(m.rtf))}</td>
      <td><span class="pill ${m.status}">${STATUS_LABEL[m.status]}</span></td>
    `;
    body.appendChild(tr);
    const note = document.createElement('tr');
    note.className = 'note-row';
    note.innerHTML = `<td colspan="8" class="muted">${escapeHtml(m.note)}</td>`;
    body.appendChild(note);
  }
}

function renderNativeRows() {
  const wrap = $('native-rows-wrap');
  const body = $('native-body');
  const rows = report.nativeRows || [];
  if (!rows.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  body.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.pair || '')}</td>
        <td>${escapeHtml(r.stage || '')}</td>
        <td class="${msClass(r.ms)}">${escapeHtml(fmtMs(r.ms))}</td>
        <td>${escapeHtml(fmtMs(r.asr_ms))}</td>
        <td>${escapeHtml(fmtMs(r.translate_ms))}</td>
        <td class="muted">${escapeHtml(r.source || '')}</td>
        <td>${escapeHtml(r.translation || '—')}</td>
        <td>${r.pass ? '✅' : '⚠️'}</td>
      </tr>`,
    )
    .join('');
}

function bind() {
  $('engine-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-engine]');
    if (!btn) return;
    engineFilter = btn.dataset.engine;
    for (const b of $('engine-filters').querySelectorAll('button')) {
      b.classList.toggle('active', b === btn);
    }
    renderTable();
  });
  $('status-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;
    statusFilter = btn.dataset.status;
    for (const b of $('status-filters').querySelectorAll('button')) {
      b.classList.toggle('active', b === btn);
    }
    renderTable();
  });
}

report = await loadBenchReport();
bind();
renderSource(report);
renderSummary(report.models);
renderTable();
renderNativeRows();
