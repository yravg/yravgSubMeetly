#!/usr/bin/env node
/**
 * Generator daftar cacat rilis dari hasil uji (smoke / e2e / bench).
 *
 * Usage:
 *   node scripts/gen-defects.mjs
 *   node scripts/gen-defects.mjs --with-stubs   # sertakan STUB_DEFECTS sebagai basis
 *
 * Menulis test/last-defects.json (bentuk sama dengan defects-data.js).
 * Task berikutnya menandai mustFix / gerbang rilis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUB_DEFECTS } from '../test/defects-data.js';
import { TARGET_DRAFT_MS } from '../test/bench-models-data.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'test', 'last-defects.json');
const WITH_STUBS = process.argv.includes('--with-stubs');
const log = (...a) => console.log('[gen-defects]', ...a);

function load(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function defect({ id, title, severity, status = 'open', mustFix = false, area, featureId, summary, evidence }) {
  return { id, title, severity, status, mustFix, area, featureId, summary, evidence };
}

function* fromSmoke(smoke) {
  if (!smoke?.results) return;
  for (const r of smoke.results) {
    if (r.status === 'fail') {
      yield defect({
        id: `SMOKE-${r.id}`,
        title: `Smoke gagal: ${r.name || r.id}`,
        severity: 'high',
        mustFix: true,
        area: r.group || 'Smoke',
        featureId: r.id,
        summary: r.detail || 'Pemeriksaan asap gagal',
        evidence: 'test/last-smoke.json · scripts/smoke.mjs',
      });
    } else if (r.status === 'warn') {
      yield defect({
        id: `SMOKE-W-${r.id}`,
        title: `Smoke peringatan: ${r.name || r.id}`,
        severity: 'medium',
        mustFix: false,
        area: r.group || 'Smoke',
        featureId: r.id,
        summary: r.detail || 'Peringatan asap',
        evidence: 'test/last-smoke.json',
      });
    }
  }
}

function* fromE2E(e2e) {
  const suites = e2e?.suites || [];
  const byId = Object.fromEntries(suites.map((s) => [s.id, s]));

  for (const s of suites) {
    if (s.status === 'fail') {
      yield defect({
        id: `E2E-${s.id}`,
        title: `E2E gagal: ${s.name}`,
        severity: 'high',
        mustFix: true,
        area: 'E2E',
        featureId: s.id.includes('file')
          ? 'ext-offline-file'
          : s.id.includes('pick')
            ? 'ext-tab-picker'
            : s.id.includes('native')
              ? 'helper-asr'
              : 'ext-tab-capture',
        summary: s.error || s.checks?.find((c) => c.status === 'fail')?.detail || 'Suite E2E gagal',
        evidence: `${s.command || s.script} · test/last-e2e.json`,
      });
    }
    for (const c of s.checks || []) {
      if (c.status === 'fail') {
        yield defect({
          id: `E2E-${s.id}-${c.id}`,
          title: `E2E check gagal: ${c.name}`,
          severity: 'high',
          mustFix: true,
          area: 'E2E',
          featureId: s.id,
          summary: c.detail,
          evidence: `test/last-e2e.json · ${s.id}`,
        });
      }
    }
  }

  const pick = byId['e2e-pick'];
  if (!pick || pick.status !== 'pass' || pick.command?.includes('harness-only')) {
    yield defect({
      id: 'REL-02',
      title: 'E2E jalur pemilih tab (--pick) belum diverifikasi penuh',
      severity: 'high',
      mustFix: true,
      area: 'Ekstensi Chrome',
      featureId: 'ext-tab-picker',
      summary: 'Jalankan node scripts/e2e.mjs --pick dengan lab server + Chrome headed.',
      evidence: 'scripts/e2e.mjs --pick · test/last-e2e.json',
    });
  }

  const nat = byId['e2e-native'];
  if (!nat || nat.status !== 'pass' || nat.command?.includes('harness-only')) {
    yield defect({
      id: 'REL-03',
      title: 'E2E mesin native (--native) belum diverifikasi penuh',
      severity: 'high',
      mustFix: true,
      area: 'Native Helper',
      featureId: 'helper-asr',
      summary: 'Jalankan helper lalu node scripts/e2e.mjs --native.',
      evidence: 'scripts/e2e.mjs --native',
    });
  }

  const fileSuite = byId['e2e-file'];
  const browserRan = fileSuite?.checks?.some((c) => c.id === 'e2e-file-lines' && c.status === 'pass');
  if (!browserRan) {
    yield defect({
      id: 'REL-04',
      title: 'E2E berkas offline (--browser) belum dijalankan',
      severity: 'high',
      mustFix: true,
      area: 'Ekstensi Chrome',
      featureId: 'ext-offline-file',
      summary:
        'scripts/e2e-file.mjs sudah menguji kontrak ekspor; jalur Puppeteer offline masih perlu --browser.',
      evidence: 'scripts/e2e-file.mjs --browser',
    });
  }
}

function* fromBench(native, models) {
  const rows = native?.rows || models?.nativeRows || [];
  const drafts = rows.filter((r) => String(r.stage || '').startsWith('draft'));
  if (drafts.length) {
    const times = drafts.map((r) => r.ms).filter((n) => typeof n === 'number');
    const under = times.filter((t) => t <= TARGET_DRAFT_MS).length;
    const best = times.length ? Math.min(...times) : null;
    if (under < times.length) {
      yield defect({
        id: 'REL-01',
        title: 'Draft native sering di atas target 500 ms',
        severity: under === 0 ? 'high' : 'medium',
        mustFix: under === 0,
        area: 'Native Helper',
        featureId: 'ext-refine',
        summary: `last-bench: ${under}/${times.length} draft ≤${TARGET_DRAFT_MS} ms (terbaik ${best} ms).`,
        evidence: 'test/last-bench.json · test/BENCH-COMPARE.md',
      });
    }
  }
  for (const m of models?.models || []) {
    if (m.status === 'fail' && m.engine === 'browser') {
      yield defect({
        id: `BENCH-${m.id}`,
        title: `Model browser di luar target: ${m.name}`,
        severity: 'medium',
        mustFix: false,
        area: 'Benchmark',
        featureId: m.id,
        summary: m.note || `draft=${m.draftMs} ms`,
        evidence: 'test/last-models-bench.json · test/BENCH-COMPARE.md',
      });
    }
  }
}

function mergeById(list) {
  const map = new Map();
  for (const d of list) {
    const prev = map.get(d.id);
    if (!prev) {
      map.set(d.id, d);
      continue;
    }
    // Prefer open + higher severity + mustFix true
    const rank = (x) =>
      (x.mustFix ? 10 : 0) +
      ({ blocker: 4, high: 3, medium: 2, low: 1 }[x.severity] || 0) +
      (x.status === 'open' ? 5 : 0);
    if (rank(d) >= rank(prev)) map.set(d.id, { ...prev, ...d });
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function main() {
  const smoke = load('test/last-smoke.json');
  const e2e = load('test/last-e2e.json');
  const native = load('test/last-bench.json');
  const models = load('test/last-models-bench.json');

  /** @type {ReturnType<typeof defect>[]} */
  let defects = [];

  if (WITH_STUBS) {
    // Ambil accepted/low dari stub sebagai pengetahuan produk; open mustFix diganti hasil uji
    defects.push(...STUB_DEFECTS.filter((d) => d.status === 'accepted' || !d.mustFix));
  } else {
    // Selalu bawa accepted constraints dari stub
    defects.push(...STUB_DEFECTS.filter((d) => d.status === 'accepted'));
  }

  defects.push(...fromSmoke(smoke));
  defects.push(...fromE2E(e2e));
  defects.push(...fromBench(native, models));

  // Jika tidak ada smoke sama sekali, catat celah proses
  if (!smoke) {
    defects.push(
      defect({
        id: 'PROC-SMOKE',
        title: 'Belum ada last-smoke.json',
        severity: 'medium',
        mustFix: true,
        area: 'Proses QA',
        featureId: 'ext-transcribe',
        summary: 'Jalankan node scripts/smoke.mjs sebelum gerbang rilis.',
        evidence: 'scripts/smoke.mjs',
      }),
    );
  }

  defects = mergeById(defects);

  const report = {
    source: 'gen-defects',
    generatedAt: new Date().toISOString(),
    inputs: {
      smoke: !!smoke,
      e2e: !!e2e,
      nativeBench: !!native,
      modelsBench: !!models,
    },
    defects,
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  const openMust = defects.filter((d) => d.mustFix && d.status === 'open').length;
  log(`wrote ${path.relative(ROOT, OUT)} — ${defects.length} cacat, mustFix open=${openMust}`);
}

main();
