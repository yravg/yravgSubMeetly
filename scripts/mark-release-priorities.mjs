#!/usr/bin/env node
/**
 * Tandai prioritas wajib diperbaiki sebelum rilis (gerbang rilis Fase 1).
 *
 * Menjalankan gen-defects, lalu menerapkan kebijakan mustFix kanonis,
 * menulis ulang test/last-defects.json + test/RELEASE-GATE.md.
 *
 * Usage:
 *   node scripts/mark-release-priorities.mjs
 *   node scripts/mark-release-priorities.mjs --check   # exit 1 jika masih ada mustFix open
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { summarizeDefects } from '../test/defects-data.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFECTS_PATH = path.join(ROOT, 'test', 'last-defects.json');
const GATE_MD = path.join(ROOT, 'test', 'RELEASE-GATE.md');
const CHECK = process.argv.includes('--check');
const log = (...a) => console.log('[release-gate]', ...a);

/** ID yang selalu wajib sebelum rilis sampai bukti uji penuh ada. */
const ALWAYS_MUST_FIX = new Set(['REL-01', 'REL-02', 'REL-03', 'REL-04']);

/** ID yang sudah tertutup oleh smoke/export kontrak — jangan tahan rilis. */
const AUTO_FIXED_IF_SMOKE_PASS = {
  'REL-05': {
    title: 'Ekspor TXT tanpa unit test',
    evidenceCheck: (smoke) =>
      smoke?.results?.some((r) => r.id === 'export-txt' && r.status === 'pass'),
  },
};

function load(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function applyPriorities(report, smoke) {
  const defects = (report.defects || []).map((d) => ({ ...d }));

  for (const d of defects) {
    if (ALWAYS_MUST_FIX.has(d.id) && d.status === 'open') {
      d.mustFix = true;
      if (d.severity === 'low') d.severity = 'high';
      d.priority = 'release-blocker';
    }
  }

  for (const [id, rule] of Object.entries(AUTO_FIXED_IF_SMOKE_PASS)) {
    if (rule.evidenceCheck(smoke)) {
      let row = defects.find((d) => d.id === id);
      if (!row) {
        row = {
          id,
          title: rule.title,
          severity: 'medium',
          status: 'fixed',
          mustFix: false,
          area: 'Ekspor',
          featureId: 'export-txt',
          summary: 'Ditutup oleh scripts/smoke.mjs (export-txt) + scripts/e2e-file.mjs.',
          evidence: 'test/last-smoke.json · scripts/e2e-file.mjs',
          priority: 'resolved',
        };
        defects.push(row);
      } else {
        row.status = 'fixed';
        row.mustFix = false;
        row.priority = 'resolved';
        row.summary =
          (row.summary || '') + ' — ditandai fixed karena smoke export-txt lulus.';
      }
    }
  }

  // Tandai prioritas eksplisit untuk open mustFix
  for (const d of defects) {
    if (d.mustFix && d.status === 'open') {
      d.priority = d.priority || 'release-blocker';
      d.releaseGate = true;
    } else if (d.status === 'accepted') {
      d.priority = d.priority || 'wontfix-documented';
      d.releaseGate = false;
    } else if (d.status === 'fixed') {
      d.priority = d.priority || 'resolved';
      d.releaseGate = false;
    } else {
      d.priority = d.priority || 'track';
      d.releaseGate = false;
    }
  }

  defects.sort((a, b) => {
    const score = (x) =>
      (x.mustFix && x.status === 'open' ? 100 : 0) +
      ({ blocker: 40, high: 30, medium: 20, low: 10 }[x.severity] || 0);
    return score(b) - score(a) || a.id.localeCompare(b.id);
  });

  return {
    ...report,
    source: 'release-gate',
    generatedAt: new Date().toISOString(),
    policy: {
      alwaysMustFix: [...ALWAYS_MUST_FIX],
      autoFixed: Object.keys(AUTO_FIXED_IF_SMOKE_PASS),
    },
    defects,
  };
}

function writeGateMd(report) {
  const s = summarizeDefects(report.defects);
  const blockers = report.defects.filter((d) => d.mustFix && d.status === 'open');
  const lines = [];
  lines.push('# Gerbang rilis Fase 1 — prioritas wajib');
  lines.push('');
  lines.push(`Dibuat oleh \`scripts/mark-release-priorities.mjs\` pada ${report.generatedAt}.`);
  lines.push('');
  if (s.releaseBlocked) {
    lines.push(`**Status: DITAHAN** — ${s.mustFixOpen} cacat wajib masih terbuka.`);
  } else {
    lines.push('**Status: LOLOS GERBANG** — tidak ada cacat wajib terbuka.');
  }
  lines.push('');
  lines.push('## Ringkasan');
  lines.push('');
  lines.push('| Metrik | Nilai |');
  lines.push('|--------|------:|');
  lines.push(`| Total cacat | ${s.total} |`);
  lines.push(`| Wajib terbuka | ${s.mustFixOpen} |`);
  lines.push(`| Open / Accepted / Fixed | ${s.open} / ${s.accepted} / ${s.fixed} |`);
  lines.push('');
  lines.push('## Wajib sebelum rilis');
  lines.push('');
  if (!blockers.length) {
    lines.push('_Tidak ada._');
  } else {
    lines.push('| ID | Judul | Area | Bukti |');
    lines.push('|----|-------|------|-------|');
    for (const d of blockers) {
      lines.push(
        `| ${d.id} | ${d.title} | ${d.area} | ${(d.evidence || '').replace(/\|/g, '/')} |`,
      );
    }
  }
  lines.push('');
  lines.push('## Kebijakan');
  lines.push('');
  lines.push('- Selalu wajib sampai bukti E2E/bench ada: `REL-01` … `REL-04`.');
  lines.push('- `REL-05` (TXT) otomatis **fixed** jika smoke `export-txt` lulus.');
  lines.push('- Cacat `accepted` = kendala terdokumentasi, tidak menahan gerbang.');
  lines.push('');
  lines.push('```bash');
  lines.push('node scripts/gen-defects.mjs');
  lines.push('node scripts/mark-release-priorities.mjs');
  lines.push('node scripts/mark-release-priorities.mjs --check   # CI gate');
  lines.push('```');
  lines.push('');
  lines.push('UI: `test/defects.html`.');
  lines.push('');
  fs.writeFileSync(GATE_MD, lines.join('\n'));
  log('wrote', path.relative(ROOT, GATE_MD));
}

function main() {
  const gen = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-defects.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (gen.stdout) process.stdout.write(gen.stdout);
  if (gen.stderr) process.stderr.write(gen.stderr);
  if (gen.status !== 0) throw new Error('gen-defects failed');

  const raw = load('test/last-defects.json');
  const smoke = load('test/last-smoke.json');
  const gated = applyPriorities(raw, smoke);
  fs.writeFileSync(DEFECTS_PATH, JSON.stringify(gated, null, 2) + '\n');
  log('wrote', path.relative(ROOT, DEFECTS_PATH));

  writeGateMd(gated);
  const s = summarizeDefects(gated.defects);
  log(
    `gate: ${s.releaseBlocked ? 'BLOCKED' : 'CLEAR'} mustFixOpen=${s.mustFixOpen} total=${s.total}`,
  );

  if (CHECK && s.releaseBlocked) {
    process.exitCode = 1;
  }
}

main();
