// Kasi in the app window (src/lib/kasi-art.js): the copies in src/kasi/ stay equal to the brand
// exports of site/kasi.js, every state has its sticker and its still, and the Tide otter is gone
// from the pages, their styles and the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { KASI_STATES, STICKER_HEAD, kasiFrame, kasiSrc, kasiImg, prefersReducedMotion } from '../src/lib/kasi-art.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KASI = path.join(ROOT, 'src', 'kasi');
const read = (...p) => readFileSync(path.join(ROOT, ...p));

// src/kasi/<file> -> its source among the brand exports.
const SOURCES = {
  'icon-small-32.svg': 'site/brand/icons/svg/icon-small-32.svg',
};
for (const f of readdirSync(path.join(ROOT, 'site/brand/stickers')).filter((f) => f.endsWith('.svg'))) SOURCES[f] = `site/brand/stickers/${f}`;
for (const f of readdirSync(path.join(ROOT, 'site/assets/kasi')).filter((f) => f.endsWith('.svg'))) SOURCES[f] = `site/assets/kasi/${f}`;

test('every picture in src/kasi is a byte-for-byte copy of its brand export', () => {
  const files = readdirSync(KASI).filter((f) => !f.startsWith('.'));
  assert.ok(files.length >= 12, files.join(', '));
  for (const f of files) {
    assert.ok(SOURCES[f], `src/kasi/${f} has no source in site/: copy it from the brand exports, do not draw it here`);
    assert.ok(read('src', 'kasi', f).equals(read(SOURCES[f])), `src/kasi/${f} differs from ${SOURCES[f]}: copy it again`);
  }
});

test('each state has a sticker that moves and a still pose for reduced motion', () => {
  for (const [state, [sticker, still]] of Object.entries(KASI_STATES)) {
    assert.ok(existsSync(path.join(KASI, `${sticker}.svg`)), `${state}: ${sticker}.svg`);
    assert.ok(existsSync(path.join(KASI, `${still}.svg`)), `${state}: ${still}.svg`);
    assert.match(read('src', 'kasi', `${sticker}.svg`).toString(), /<animate/, `${sticker} is animated`);
    assert.doesNotMatch(read('src', 'kasi', `${still}.svg`).toString(), /<animate/, `${still} is still`);
    assert.equal(kasiSrc(state, false), `kasi/${sticker}.svg`);
    assert.equal(kasiSrc(state, true), `kasi/${still}.svg`);
  }
  assert.deepEqual(Object.keys(KASI_STATES).sort(), ['done', 'empty', 'ready', 'thinking', 'welcome']);
  assert.throws(() => kasiSrc('error'), /no Kasi/, 'errors get words, not a mascot');
});

test('the <img> is decorative, says which state it shows and carries its frame', () => {
  assert.equal(kasiImg('empty', 'st-art', false), '<img class="kasi-art st-art" src="kasi/kasi-dozing.svg" alt="" data-kasi="empty" style="--kasi-zoom:1.3234;--kasi-foot:0.2275" />');
  assert.equal(kasiImg('done', '', true), '<img class="kasi-art" src="kasi/kasi-happy.svg" alt="" data-kasi="done" style="--kasi-zoom:1.0000;--kasi-foot:0.0579" />');
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersReducedMotion({}), false);
});

test('the Tide otter is gone from the pages, their styles and the build', () => {
  assert.equal(existsSync(path.join(ROOT, 'src', 'tide')), false, 'src/tide/ removed');
  const stale = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['fonts', 'kasi', 'addins'].includes(e.name)) walk(p); continue; }
      if (!/\.(js|html|css)$/.test(e.name)) continue;
      const s = readFileSync(p, 'utf8');
      // The otter's files and the folder they were served from (not the Tide palette, nor the
      // tide-shell-canvas design docs the comments point to).
      if (/['"(]tide\/|tide-(wave|sleep|shell|celebrate|compass|happy)\.webp|01-tide-mark|\btide-art\b/.test(s)) stale.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'src'));
  assert.deepEqual(stale, []);
  const build = read('esbuild.config.mjs').toString();
  assert.match(build, /src\/kasi/);
  assert.doesNotMatch(build, /src\/tide/);
});

test('each sticker head placement matches its file, so the chin lands on the ask bar', () => {
  for (const [state, [sticker]] of Object.entries(KASI_STATES)) {
    const svg = read('src', 'kasi', `${sticker}.svg`).toString();
    const m = svg.match(/<\/title><g transform="translate\(128 ([\d.]+)\) scale\(([\d.]+)\)"/);
    assert.ok(m, `${sticker}: head transform not found`);
    assert.deepEqual(STICKER_HEAD[sticker], [Number(m[1]), Number(m[2])], `${state}: update STICKER_HEAD for ${sticker}`);
    const { zoom, foot } = kasiFrame(sticker);
    assert.ok(zoom > 1.2 && zoom < 1.45 && foot > 0.05 && foot < 0.3, `${sticker}: ${zoom} ${foot}`);
  }
});
