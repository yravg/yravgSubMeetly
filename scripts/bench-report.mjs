#!/usr/bin/env node
/**
 * Simpan hasil benchmark sebagai laporan pembanding (Markdown).
 *
 * Membaca test/last-models-bench.json (atau membangunnya via --refresh)
 * dan last-bench.json, lalu menulis:
 *   - test/BENCH-COMPARE.md  — tabel pembanding antar model
 *   - test/BENCH-LATEST.md   — ringkasan native (kompatibel lab)
 *
 * Usage:
 *   node scripts/bench-report.mjs
 *   node scripts/bench-report.mjs --refresh   # jalankan bench-models --catalog-only dulu
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TARGET_DRAFT_MS } from '../test/bench-models-data.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODELS_JSON = path.join(ROOT, 'test', 'last-models-bench.json');
const NATIVE_JSON = path.join(ROOT, 'test', 'last-bench.json');
const COMPARE_MD = path.join(ROOT, 'test', 'BENCH-COMPARE.md');
const LATEST_MD = path.join(ROOT, 'test', 'BENCH-LATEST.md');

const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.log('[bench-report]', ...a);

function load(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function fmt(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  return `${Math.round(ms)} ms`;
}

function badge(status) {
  if (status === 'pass') return 'pass';
  if (status === 'warn') return 'warn';
  if (status === 'fail') return 'fail';
  return 'unverified';
}

function summarizeDrafts(rows) {
  const drafts = (rows || []).filter((r) => String(r.stage || '').startsWith('draft'));
  if (!drafts.length) return null;
  const times = drafts.map((r) => r.ms).filter((n) => typeof n === 'number');
  if (!times.length) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const under = times.filter((t) => t <= TARGET_DRAFT_MS).length;
  return {
    n: times.length,
    under,
    min: Math.min(...times),
    max: Math.max(...times),
    p50: sorted[Math.floor(sorted.length / 2)],
    avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
  };
}

function writeCompare(modelsReport, native) {
  const models = modelsReport?.models || [];
  const draft = summarizeDrafts(modelsReport?.nativeRows || native?.rows);
  const generatedAt = modelsReport?.generatedAt || new Date().toISOString();

  const lines = [];
  lines.push('# Laporan pembanding kinerja model');
  lines.push('');
  lines.push(`Dibuat otomatis oleh \`scripts/bench-report.mjs\` dari \`last-models-bench.json\`.`);
  lines.push('');
  lines.push(`- **Generated:** ${generatedAt}`);
  lines.push(`- **Source:** ${modelsReport?.source || '—'}`);
  lines.push(`- **Target draft:** ≤ **${TARGET_DRAFT_MS} ms** (\`POST /draft\` native)`);
  lines.push('');

  lines.push('## Tabel pembanding');
  lines.push('');
  lines.push('| Model | Engine | Device | Draft | ASR | MT | RTF | Status | Catatan |');
  lines.push('|-------|--------|--------|------:|----:|---:|----:|--------|---------|');
  for (const m of models) {
    lines.push(
      `| ${m.name || m.id} | ${m.engine} | ${m.device || '—'} | ${fmt(m.draftMs)} | ${fmt(m.asrMs)} | ${fmt(m.mtMs)} | ${m.rtf ?? '—'} | ${badge(m.status)} | ${(m.note || '').replace(/\|/g, '/')} |`,
    );
  }
  lines.push('');

  if (draft) {
    lines.push('## Native draft (dari last-bench)');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Draft calls | ${draft.n} |`);
    lines.push(`| ≤${TARGET_DRAFT_MS} ms | ${draft.under} / ${draft.n} |`);
    lines.push(`| min / p50 / avg / max | ${draft.min} / ${draft.p50} / ${draft.avg} / ${draft.max} ms |`);
    lines.push('');
  }

  const live = modelsReport?.live || [];
  if (live.length) {
    lines.push('## Live browser runs');
    lines.push('');
    for (const L of live) {
      if (L.error) {
        lines.push(`- **${L.id}:** gagal — ${L.error}`);
      } else {
        lines.push(
          `- **${L.id}:** asr=${fmt(L.asrMs)} mt=${fmt(L.mtMs)} load=${fmt(L.loadMs)} status=${L.status}`,
        );
      }
    }
    lines.push('');
  }

  lines.push('## Cara menjalankan ulang');
  lines.push('');
  lines.push('```bash');
  lines.push('node scripts/bench-models.mjs --catalog-only   # gabung last-bench + katalog');
  lines.push('node scripts/bench-models.mjs --browser        # ukur Whisper Tiny di Node');
  lines.push('node scripts/bench-models.mjs --native         # bench-lab.py (helper harus hidup)');
  lines.push('node scripts/bench-report.mjs                  # tulis laporan ini');
  lines.push('```');
  lines.push('');
  lines.push('UI: `test/bench.html` (lab) · native UI: `./scripts/run-lab.sh`.');
  lines.push('');

  fs.writeFileSync(COMPARE_MD, lines.join('\n'));
  log('wrote', path.relative(ROOT, COMPARE_MD));
}

function writeLatest(native) {
  if (!native?.rows) {
    log('skip BENCH-LATEST.md — tidak ada last-bench.json');
    return;
  }
  const draft = summarizeDrafts(native.rows);
  const health = native.health || {};
  const lines = [];
  lines.push('# Latest benchmark snapshot');
  lines.push('');
  lines.push('Auto-generated from `scripts/bench-lab.py` / `scripts/bench-report.mjs`.');
  lines.push('');
  lines.push(`**Target:** draft (\`POST /draft\`) ≤ **${TARGET_DRAFT_MS} ms** per update.`);
  lines.push('');
  lines.push('## Summary (last run)');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| At | ${native.at || '—'} |`);
  lines.push(`| Engine | ${health.engine || '—'} · ${(health.model || '').split('/').pop() || '—'} |`);
  if (draft) {
    lines.push(`| Draft calls | ${draft.n} |`);
    lines.push(`| ≤${TARGET_DRAFT_MS} ms | **${draft.under} / ${draft.n}** |`);
    lines.push(`| Draft min / p50 / max | **${draft.min}** / ${draft.p50} / ${draft.max} ms |`);
  }
  lines.push('');

  const byPair = new Map();
  for (const r of native.rows) {
    if (!byPair.has(r.pair)) byPair.set(r.pair, []);
    byPair.get(r.pair).push(r);
  }
  lines.push('## Per-pair highlights');
  lines.push('');
  for (const [pair, rows] of byPair) {
    lines.push(`### ${pair}`);
    const drafts = rows.filter((r) => String(r.stage).startsWith('draft'));
    const best = drafts.length ? drafts.reduce((a, b) => (a.ms <= b.ms ? a : b)) : null;
    if (best) {
      lines.push(`- Draft best: **${best.ms} ms** @ ${best.stage.replace('draft ', '')} → "${(best.translation || best.source || '').slice(0, 80)}"`);
    }
    const asr = rows.find((r) => r.stage === 'final ASR');
    if (asr) lines.push(`- Final ASR: ${asr.ms} ms`);
    const refine = rows.find((r) => r.stage === 'refine');
    if (refine) lines.push(`- Refine: ${refine.ms} ms → "${(refine.translation || '').slice(0, 80)}"`);
    lines.push('');
  }

  lines.push('## How to re-run');
  lines.push('');
  lines.push('```bash');
  lines.push('cd native && ./run.sh');
  lines.push('python3 scripts/bench-lab.py --json test/last-bench.json');
  lines.push('node scripts/bench-models.mjs --catalog-only');
  lines.push('node scripts/bench-report.mjs');
  lines.push('```');
  lines.push('');

  fs.writeFileSync(LATEST_MD, lines.join('\n'));
  log('wrote', path.relative(ROOT, LATEST_MD));
}

function main() {
  if (REFRESH || !fs.existsSync(MODELS_JSON)) {
    log('refresh last-models-bench.json');
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'bench-models.mjs'), '--catalog-only'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) throw new Error('bench-models --catalog-only failed');
  }

  const modelsReport = load(MODELS_JSON);
  const native = load(NATIVE_JSON);
  if (!modelsReport) throw new Error('last-models-bench.json missing');

  writeCompare(modelsReport, native);
  writeLatest(native || { rows: modelsReport.nativeRows, health: modelsReport.nativeHealth, at: modelsReport.nativeAt });
  log('done');
}

main();
