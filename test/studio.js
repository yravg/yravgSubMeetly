import {
  STUB_SEGMENTS,
  STUB_FILE,
  formatTimecode,
  scoreDevice,
  pickEngineMode,
  simulateFallback,
} from './studio-lib.js';
import { generateSrt, generateVtt, generateTxt } from './studio-export.js';
import { exportBasename, detectOs, guideFor } from '../src/lib/helper-status.js';
import { saveExportFile } from '../src/lib/export.js';

const $ = (id) => document.getElementById(id);
// Cermin bahasa registry (src/lib/registry.js): sumber didukung Whisper,
// target adalah TARGET_LANGS. Stub hanya punya pasangan en→id asli.
const STUDIO_SOURCES = [
  ['auto', 'Otomatis'], ['en', 'English'], ['ja', '日本語'], ['zh', '中文'],
  ['ko', '한국어'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'],
  ['ru', 'Русский'], ['it', 'Italiano'], ['id', 'Bahasa Indonesia'], ['vi', 'Tiếng Việt'],
];
const STUDIO_TARGETS = [
  ['en', 'English'], ['zh', '中文'], ['de', 'Deutsch'], ['fr', 'Français'],
  ['es', 'Español'], ['ru', 'Русский'], ['it', 'Italiano'], ['id', 'Bahasa Indonesia'],
  ['vi', 'Tiếng Việt'], ['ja', '日本語'], ['ko', '한국어'],
];
const REAL_TGT = { id: true, en: true };
let srcLang = 'en';
let tgtLang = 'id';
let segments = STUB_SEGMENTS.map((s) => ({ ...s }));
let dualLine = true;
let progress = 0;
let engine = pickEngineMode(scoreDevice({ webgpu: false, ramGb: 8, cores: 8 }));

function showPage(name) {
  for (const id of ['page-transcribe', 'page-translate', 'page-extension']) {
    $(id).classList.toggle('hidden', id !== `page-${name}`);
  }
}

function renderSegments(activeId = null) {
  const host = $('segments');
  host.innerHTML = segments
    .map(
      (s) => `
      <div class="seg-row${s.id === activeId ? ' active' : ''}" data-seg="${s.id}" data-t0="${s.t0}">
        <div class="tc">${formatTimecode(s.t0)}</div>
        <div>
          <div>${s.tgt || s.src}</div>
          ${dualLine && s.src ? `<div class="notes-meta">${s.src}</div>` : ''}
        </div>
      </div>`,
    )
    .join('');
  host.querySelectorAll('[data-seg]').forEach((el) => {
    el.addEventListener('click', () => {
      const t0 = Number(el.getAttribute('data-t0') || 0);
      const player = $('media-player');
      if (player) player.currentTime = t0;
    });
  });
}

function renderTranslatePreview() {
  $('translate-preview').textContent = segments
    .map((s) => (dualLine ? `${s.src}\n${s.tgt}` : s.tgt))
    .join('\n\n');
}

// Pasangan mock: id/en memakai stub asli; target lain memakai terjemahan
// tiruan berlabel jelas `[kode]` supaya tak dikira hasil model.
function applyPair() {
  segments = STUB_SEGMENTS.map((s) => ({
    ...s,
    tgt: tgtLang === 'id' ? s.tgt : tgtLang === 'en' ? s.src : `[${tgtLang}] ${s.src}`,
  }));
  const note = $('pair-note');
  if (note) {
    note.textContent = REAL_TGT[tgtLang]
      ? `Pasangan ${srcLang} → ${tgtLang} memakai stub asli.`
      : `Pasangan ${srcLang} → ${tgtLang} memakai terjemahan tiruan berlabel [${tgtLang}] (mock).`;
  }
  renderSegments();
  renderTranslatePreview();
}

function fillLangs() {
  const src = $('studio-src');
  const tgt = $('studio-tgt');
  if (src) {
    src.innerHTML = STUDIO_SOURCES.map(([c, l]) => `<option value="${c}">${l}</option>`).join('');
    src.value = srcLang;
    src.addEventListener('change', () => {
      srcLang = src.value;
      applyPair();
    });
  }
  if (tgt) {
    tgt.innerHTML = STUDIO_TARGETS.map(([c, l]) => `<option value="${c}">${l}</option>`).join('');
    tgt.value = tgtLang;
    tgt.addEventListener('change', () => {
      tgtLang = tgt.value;
      applyPair();
    });
  }
}

function setProgress(p, label) {
  progress = p;
  $('progress-bar').style.width = `${Math.round(p * 100)}%`;
  $('progress-text').textContent = label || `${Math.round(p * 100)}%`;
}

function setEngine(e, note = '') {
  engine = e;
  $('engine-pill').textContent = `Mesin: ${e.label}${note ? ` · ${note}` : ''}`;
  $('engine-pill').className = `notes-pill ${e.engine === 'native' ? 'warn' : 'ready'}`;
}

async function probeHelper() {
  const pill = $('helper-pill');
  const os = detectOs();
  const guide = guideFor(os, 'id');
  let online = false;
  let health = null;
  try {
    const r = await fetch('http://127.0.0.1:17865/health', { signal: AbortSignal.timeout(800) });
    if (!r.ok) throw new Error('bad');
    health = await r.json();
    online = true;
    pill.textContent = `Helper · ${health.engine}`;
    pill.className = 'notes-pill ready';
  } catch {
    pill.textContent = 'Helper terputus';
    pill.className = 'notes-pill error';
  }
  const mount = $('ext-helper-mount');
  if (mount) {
    mount.innerHTML = `
      <strong>Status helper (${guide.label})</strong>
      <p class="notes-meta">${online ? 'Terhubung' : 'Terputus'} · ${guide.engine}</p>
      <ol class="helper-steps">${guide.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    `;
  }
  if ($('ext-engine-pill')) {
    $('ext-engine-pill').textContent = `Mesin: ${online ? health?.engine || engine.label : engine.label}`;
    $('ext-engine-pill').className = `notes-pill ${online ? 'ready' : 'error'}`;
  }
  if ($('ext-mode-pill')) $('ext-mode-pill').textContent = 'Mode: offline';
  if ($('ext-task-pill')) $('ext-task-pill').textContent = 'Tugas: transcribe';
}

function setExportEnabled(on) {
  for (const id of ['btn-export-srt', 'btn-export-vtt', 'btn-export-txt']) {
    const el = $(id);
    if (el) el.disabled = !on;
  }
  document.querySelectorAll('.studio-grid [data-dl]').forEach((b) => {
    b.disabled = !on;
  });
  const st = $('offline-export-status');
  if (st && !on) st.textContent = 'Jalankan sesi tiruan untuk mengaktifkan ekspor.';
}

async function download(kind) {
  const body =
    kind === 'srt'
      ? generateSrt(segments, { dualLine, title: STUB_FILE.name })
      : kind === 'vtt'
        ? generateVtt(segments, { dualLine, title: STUB_FILE.name })
        : generateTxt(segments, { dualLine, title: STUB_FILE.name });
  const name = exportBasename(STUB_FILE.name.replace(/\.[^.]+$/, ''), kind);
  const result = await saveExportFile(name, body);
  const msg = result.saved ? `Disimpan ${result.path}` : `Diunduh ${result.path}`;
  if ($('export-hint')) $('export-hint').textContent = msg;
  if ($('offline-export-status')) $('offline-export-status').textContent = msg;
  if ($('export-preview')) $('export-preview').textContent = body.slice(0, 1200);
}

function wire() {
  document.querySelectorAll('#page-tabs [data-page]').forEach((b) => {
    b.addEventListener('click', () => showPage(b.dataset.page));
  });
  const dz = $('file-picker');
  const input = $('studio-file');
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    $('file-info').textContent = `${f.name} · ${(f.size / 1024 / 1024).toFixed(2)} MiB · ${f.type || 'unknown'}`;
  });
  dz.addEventListener('dragover', (e) => e.preventDefault());
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    $('file-info').textContent = `${f.name} · ${(f.size / 1024 / 1024).toFixed(2)} MiB`;
  });

  $('btn-run-mock').addEventListener('click', async () => {
    setEngine(engine);
    setExportEnabled(false);
    for (const step of [0.15, 0.4, 0.7, 1]) {
      setProgress(step, `Transkripsi tiruan ${Math.round(step * 100)}%`);
      await new Promise((r) => setTimeout(r, 280));
    }
    renderSegments();
    renderTranslatePreview();
    if ($('export-preview')) {
      $('export-preview').textContent = generateSrt(segments, { dualLine }).slice(0, 800);
    }
    setExportEnabled(true);
    if ($('offline-export-status')) {
      $('offline-export-status').textContent = 'Siap ekspor SRT / VTT / TXT.';
    }
  });

  $('btn-fail-engine').addEventListener('click', () => {
    const r = simulateFallback(engine, false);
    setEngine(r.active, r.reason);
  });

  const syncDual = (checked) => {
    dualLine = !!checked;
    const a = $('dual-toggle');
    const b = $('export-dual-toggle');
    if (a) a.checked = dualLine;
    if (b) b.checked = dualLine;
    renderSegments();
    renderTranslatePreview();
  };
  $('dual-toggle')?.addEventListener('change', (e) => syncDual(e.target.checked));
  $('export-dual-toggle')?.addEventListener('change', (e) => syncDual(e.target.checked));

  document.querySelectorAll('[data-dl]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      download(b.dataset.dl).catch((err) => {
        const msg = String(err?.message || err);
        if ($('export-hint')) $('export-hint').textContent = msg;
        if ($('offline-export-status')) $('offline-export-status').textContent = msg;
      });
    });
  });
  $('btn-copy-all')?.addEventListener('click', async () => {
    const text = segments.map((s) => (dualLine ? `${s.src}\n${s.tgt}` : s.tgt)).join('\n\n');
    await navigator.clipboard.writeText(text);
    if ($('export-hint')) $('export-hint').textContent = 'Disalin ke clipboard';
  });

  const player = $('media-player');
  player?.addEventListener('timeupdate', () => {
    const t = player.currentTime;
    const active = [...segments].reverse().find((s) => t >= s.t0) || segments[0];
    if (active) renderSegments(active.id);
  });

  $('file-info').textContent = `${STUB_FILE.name} · ${(STUB_FILE.size / 1024 / 1024).toFixed(2)} MiB (stub)`;
  const resumeId = new URLSearchParams(location.search).get('resume');
  const resumeNote = $('resume-note');
  if (resumeId && resumeNote) {
    resumeNote.hidden = false;
    resumeNote.textContent = `Melanjutkan sesi ${resumeId} (mock) — konteks sesi asli tidak terbawa di halaman contoh.`;
  }
  fillLangs();
  applyPair();
  setEngine(engine);
  setExportEnabled(true);
  renderSegments();
  renderTranslatePreview();
  probeHelper();
  showPage('transcribe');
}

wire();
