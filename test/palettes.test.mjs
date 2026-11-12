// The generated theme palettes (scripts/gen-palettes.mjs -> src/palettes.css, src/lib/palettes.js):
// in sync with the generator, complete, and legible (WCAG AA) in light and dark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PALETTES } from '../src/lib/palettes.js';
import { normalizePalette, LEGACY_PALETTE } from '../src/lib/palette-apply.js';

const css = () => readFileSync('src/palettes.css', 'utf8');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const block = (sel) => { const i = css().indexOf(sel + ' {'); assert.ok(i >= 0, `${sel} missing`); return css().slice(i, css().indexOf('}', i)); };
const tok = (b, name) => { const m = b.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`)); assert.ok(m, `${name} missing`); return m[1]; };

test('the generated files are in sync with the generator', () => {
  const before = [css(), readFileSync('src/lib/palettes.js', 'utf8')];
  execFileSync('node', ['scripts/gen-palettes.mjs'], { stdio: 'pipe' });
  assert.deepEqual([css(), readFileSync('src/lib/palettes.js', 'utf8')], before, 'run `npm run palettes` and commit the result');
});

test('nine themes, each with a name, a one-line description in both languages and swatches', () => {
  assert.equal(PALETTES.length, 9);
  assert.equal(PALETTES[0].id, 'tide');
  for (const p of PALETTES) {
    assert.ok(p.name && p.en && p.id_, p.id);
    for (const m of ['light', 'dark']) for (const k of ['bg', 'card', 'accent', 'ink', 'line']) assert.match(p[m][k], /^#[0-9A-F]{6}$/, `${p.id} ${m} ${k}`);
  }
  assert.equal(new Set(PALETTES.map((p) => p.name)).size, 9, 'names are distinct');
});

test('every generated palette has light, dark, system-dark and both Minutes modes', () => {
  for (const p of PALETTES.slice(1)) {
    const sel = `:root[data-reskin='tide'][data-palette='${p.id}']`;
    block(sel); block(sel + '.theme-dark'); block(sel + "[data-theme='dark']"); block(sel + "[data-theme='paper']");
    assert.ok(css().includes(`@media (prefers-color-scheme: dark) {\n  ${sel}:not(.theme-light)`), `${p.id} system dark`);
  }
});

test('text stays >= 4.5:1 on every surface, in light and dark', () => {
  for (const p of PALETTES.slice(1)) {
    const sel = `:root[data-reskin='tide'][data-palette='${p.id}']`;
    const light = block(sel), dark = block(sel + '.theme-dark');
    const lightBgs = ['#FFFFFF', tok(light, '--tide-surface-2'), tok(light, '--tide-mint')];
    const darkBgs = [tok(dark, '--tide-surface'), tok(dark, '--tide-surface-2'), tok(dark, '--tide-mint')];
    for (const bg of lightBgs) for (const fg of [tok(light, '--tide-ink'), tok(light, '--text2'), tok(light, '--muted'), tok(light, '--tide-green-ink')]) assert.ok(ratio(fg, bg) >= 4.5, `${p.id} light ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
    for (const bg of darkBgs) for (const fg of [tok(dark, '--text'), tok(dark, '--text2'), tok(dark, '--muted'), tok(dark, '--accent-soft')]) assert.ok(ratio(fg, bg) >= 4.5, `${p.id} dark ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
    assert.ok(ratio(tok(light, '--on-accent'), tok(light, '--tide-green')) >= 4.5, `${p.id} text on the light accent fill`);
    assert.ok(ratio(tok(dark, '--on-accent'), tok(dark, '--tide-green')) >= 4.5, `${p.id} text on the dark accent fill`);
  }
});

test('the earlier reskin names keep meaning something; unknown values fall back to Tide', () => {
  assert.deepEqual(LEGACY_PALETTE, { yraverage: 'teal', coretax: 'azure', modern: 'violet' });
  assert.equal(normalizePalette('coretax'), 'azure');
  assert.equal(normalizePalette('sunset'), 'sunset');
  assert.equal(normalizePalette('nope'), 'tide');
  assert.equal(normalizePalette(null), 'tide');
});
