/**
 * Analitik kecepatan — src/lib/perf-log.js dan src/lib/perf-charts.js.
 *   node --test test/perf-log.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  SERIES, normalizeSample, normalizeAll, summarize, quantile, filterSamples, p50ByPair,
  scatterPoints, lineSeries, fromBenchJson, toReport, fromReport, toMarkdown, pairLabel,
} from '../src/lib/perf-log.js';
import { barChart, scatterChart, lineChart, legend } from '../src/lib/perf-charts.js';

const S = (o) => normalizeSample({ at: '2026-09-05T10:00:00Z', stage: 'asr', ms: 100, engine: 'browser', device: 'wasm', platform: 'macos', src: 'zh', tgt: 'en', audioSec: 2, ...o });

test('normalizeSample: membuang sampel rusak, memetakan seri dari mesin+perangkat', () => {
  assert.equal(normalizeSample(null), null);
  assert.equal(normalizeSample({ stage: 'asr' }), null, 'tanpa ms');
  assert.equal(normalizeSample({ stage: 'x', ms: 5 }), null, 'tahap tak dikenal');
  assert.equal(S({ engine: 'native' }).series, 'native');
  assert.equal(S({ engine: 'browser', device: 'webgpu' }).series, 'browser-webgpu');
  assert.equal(S({ engine: 'browser', device: 'wasm' }).series, 'browser-wasm');
  assert.equal(S({ platform: 'amiga' }).platform, 'unknown');
  assert.equal(SERIES.length, 3, 'scatter/all-pairs dibatasi tiga seri kategorikal');
});

test('quantile & summarize: p50/p95/RTF benar, RTF hanya dari tahap ASR/draft', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([], 0.5), null);
  const list = [S({ ms: 100 }), S({ ms: 300 }), S({ ms: 500, audioSec: 1 })];
  const sm = summarize(list);
  assert.equal(sm.n, 3); assert.equal(sm.p50, 300); assert.equal(sm.min, 100); assert.equal(sm.max, 500);
  // RTF per sampel: 100/2000=.05, 300/2000=.15, 500/1000=.5 → p50 .15
  assert.equal(sm.rtf, 0.15);
  assert.equal(summarize([S({ stage: 'mt', audioSec: 2 })]).rtf, null, 'MT tidak punya RTF');
});

test('filterSamples & p50ByPair: filter seri/tahap/pasangan, ekor dilipat ke Other', () => {
  const list = [S({ src: 'zh', tgt: 'en', ms: 200 }), S({ src: 'ja', tgt: 'en', ms: 400 }), S({ engine: 'native', src: 'zh', tgt: 'en', ms: 50 })];
  assert.equal(filterSamples(list, { series: new Set(['native']) }).length, 1);
  assert.equal(filterSamples(list, { pair: 'ja→en' }).length, 1);
  assert.equal(filterSamples(list, { stage: 'mt' }).length, 0);
  const rows = p50ByPair(list);
  assert.deepEqual(rows.map((r) => r.label), ['ja→en', 'zh→en'], 'urut dari yang paling lambat');
  const many = Array.from({ length: 15 }, (_, i) => S({ src: `l${i}`, tgt: 'en', ms: i * 10 + 10 }));
  const folded = p50ByPair(many, { limit: 6 });
  assert.equal(folded.length, 6);
  assert.equal(folded.at(-1).label, 'Other');
});

test('fromBenchJson: memetakan tahap bench-lab, jendela draft → audioSec, platform dari health.device', () => {
  const json = { at: '2026-09-05T22:42:12', health: { engine: 'mlx-whisper', device: 'apple-silicon' }, rows: [
    { pair: 'en→zh', stage: 'draft 0.35s', ms: 335 }, { pair: 'en→zh', stage: 'final ASR', ms: 1720, source: 'hello' },
    { pair: 'en→zh', stage: 'fast MT', ms: 689 }, { pair: 'en→zh', stage: 'refine', ms: 877 }, { pair: 'x', stage: 'unknown', ms: 1 },
  ] };
  const out = fromBenchJson(json);
  assert.deepEqual(out.map((s) => s.stage), ['draft', 'asr', 'mt', 'refine']);
  assert.equal(out[0].audioSec, 0.35);
  assert.equal(out[0].platform, 'macos');
  assert.equal(out[0].series, 'native');
  assert.equal(out[0].source, 'bench');
  assert.equal(pairLabel(out[0]), 'en→zh');
  if (existsSync('test/last-bench.json')) {
    const real = fromBenchJson(JSON.parse(readFileSync('test/last-bench.json', 'utf8')));
    assert.ok(real.length >= 300, `bench nyata terbaca ${real.length}`);
    assert.ok(scatterPoints(real).length >= 100, 'jendela draft harus menjadi titik scatter');
  }
});

test('laporan: JSON roundtrip (sumber → import) dan Markdown berisi ketiga tabel', () => {
  const list = [S({ ms: 120 }), S({ engine: 'native', ms: 40 }), S({ stage: 'mt', ms: 300, audioSec: null })];
  const rep = toReport(list, { platform: 'macos' });
  assert.equal(rep.version, 1); assert.equal(rep.counts.total, 3);
  assert.ok(rep.summary.bySeries['browser-wasm'] && rep.summary.bySeries.native);
  const back = fromReport(JSON.parse(JSON.stringify(rep)));
  assert.equal(back.length, 3); assert.ok(back.every((s) => s.source === 'import'));
  const md = toMarkdown(rep);
  assert.match(md, /## By engine/); assert.match(md, /## By stage/); assert.match(md, /## By language pair/);
  assert.match(md, /zh→en/);
  assert.equal(fromReport({ version: 2 }).length, 0);
});

test('chart SVG: bar ≤ 24px, ujung membulat, grid solid, titik 8px bercincin, legenda hanya untuk ≥ 2 seri', () => {
  const list = normalizeAll([S({ ms: 200 }), S({ engine: 'native', ms: 50, src: 'ja' })]);
  const bar = barChart({ rows: p50ByPair(list), target: 500 });
  assert.match(bar, /<svg/); assert.match(bar, /class="viz-bar"/); assert.match(bar, /viz-target/);
  assert.doesNotMatch(bar, /stroke-dasharray/, 'grid tidak boleh putus-putus');
  assert.match(bar, /a4,4 0 0 1 4,4/, 'ujung data membulat 4px');
  const sc = scatterChart({ points: scatterPoints(list), series: SERIES });
  assert.equal((sc.match(/class="viz-dot/g) || []).length, 2);
  assert.match(sc, /r="4" class="viz-dot/, 'penanda 8px (r=4)');
  assert.match(sc, /r="12" fill="transparent"/, 'target sentuh lebih besar dari penanda');
  const ln = lineChart({ series: lineSeries(list), order: SERIES });
  assert.match(ln, /class="viz-line viz-s/);
  const present = SERIES.filter((s) => list.some((x) => x.series === s.id));
  assert.equal(present.length, 2);
  assert.match(legend(present, SERIES, 'id'), /Helper native/);
  // Teks memakai token teks, bukan warna seri: tidak ada fill inline pada <text>.
  assert.doesNotMatch(bar + sc + ln, /<text[^>]*fill="#/);
  // Escaping: label tidak boleh menyuntikkan markup.
  assert.doesNotMatch(barChart({ rows: [{ label: '<img>', value: 5, n: 1 }] }), /<img>/);
});
