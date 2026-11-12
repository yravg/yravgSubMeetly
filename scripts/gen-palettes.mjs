#!/usr/bin/env node
// Generates src/palettes.css and src/lib/palettes.js from the spec below.
//
// A theme here is a PALETTE over the one "Tide" structure (layout, type, radius): the shell pages, the
// side panel and the Minutes register all read the same --tide-* primitives, so a palette only has to
// replace colours. Every text pair is checked against WCAG AA (4.5:1) while generating; the script
// fails loudly instead of writing a palette that is hard to read. Run: node scripts/gen-palettes.mjs

import { writeFileSync } from 'node:fs';

// ---- colour maths ----------------------------------------------------------------------------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function hsl(h, s, l) {
  s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;
const shift = (c, d) => c.map((v) => clamp(v + d, 0, 255));

// Moves lightness until `fg` reaches `min` contrast on every background in `bgs`.
function legible(h, s, l, bgs, min, dir) {
  for (let i = 0; i < 80; i++) {
    const c = hsl(h, s, l);
    if (bgs.every((b) => ratio(c, b) >= min)) return c;
    l += dir;
  }
  throw new Error(`no legible colour for hue ${h}`);
}

// ---- the palettes ----------------------------------------------------------------------------
// h/s: hue and saturation of the neutrals (surfaces, lines, text). ah/as/al: the accent (fill) and its lightness.
export const SPEC = [
  { id: 'teal',   name: 'Teal',   en: 'The original yravg teal.',              id_: 'Teal asli yravg.',                          h: 166, s: 32, ah: 163, as: 82, al: 40 },
  { id: 'azure',  name: 'Azure',  en: 'Calm blue with crisp edges.',           id_: 'Biru tenang, tepi tegas.',                  h: 216, s: 38, ah: 214, as: 80, al: 46 },
  { id: 'violet', name: 'Violet', en: 'Soft purple, friendly and warm.',       id_: 'Ungu lembut yang ramah.',                   h: 262, s: 34, ah: 262, as: 70, al: 52 },
  { id: 'sunset', name: 'Sunset', en: 'Warm coral and orange.',                id_: 'Karang dan oranye yang hangat.',            h: 22,  s: 40, ah: 18,  as: 88, al: 50 },
  { id: 'rose',   name: 'Rose',   en: 'Pink with a quiet blush.',              id_: 'Merah muda dengan semburat lembut.',        h: 344, s: 36, ah: 342, as: 72, al: 48 },
  { id: 'sand',   name: 'Sand',   en: 'Warm paper tones for long reading.',    id_: 'Nuansa kertas hangat untuk membaca lama.',  h: 38,  s: 30, ah: 28,  as: 62, al: 40 },
  { id: 'slate',  name: 'Slate',  en: 'Neutral graphite, no colour.',          id_: 'Grafit netral, tanpa warna.',               h: 214, s: 7,  ah: 214, as: 14, al: 34 },
  { id: 'citrus', name: 'Citrus', en: 'Lime and ink, high energy.',            id_: 'Lemon dan tinta, penuh energi.',            h: 78,  s: 34, ah: 80,  as: 70, al: 52 },
];

const WHITE = [255, 255, 255];

function build(p) {
  const { h, s, ah, as: asat, al } = p;
  // ---- light
  const surface2 = hsl(h, s, 97), mint = hsl(h, s + 8, 94), line = hsl(h, s * 0.6, 87);
  const lightBgs = [WHITE, surface2, mint];
  const ink = hsl(h, Math.min(s, 30), 6);
  const text2 = legible(h, s * 0.3, 26, lightBgs, 7, -1);
  const muted = legible(h, s * 0.22, 40, lightBgs, 4.9, -1);
  const fill = hsl(ah, asat, al);
  const hover = hsl(ah, asat, al - 7);
  const accentInk = legible(ah, Math.min(asat + 5, 90), 36, lightBgs, 4.6, -1);
  const onFill = ratio(WHITE, fill) >= 4.5 ? WHITE : ink;
  if (ratio(onFill, fill) < 4.5) throw new Error(`${p.id}: text on the accent fill is below 4.5:1`);
  const highlight = hsl(ah, 80, 74);
  if (ratio(ink, highlight) < 7) throw new Error(`${p.id}: ink on the highlight is below 7:1`);
  const L = { surface2, mint, line, ink, text2, muted, fill, hover, accentInk, onFill, highlight, sky1: hsl(h, s + 14, 92), sky2: hsl(h, s + 10, 94), sea1: hsl(ah, 48, 82) };
  // ---- dark
  const ds = Math.min(s, 26);
  const dSurface = hsl(h, ds, 6), dSurface2 = hsl(h, ds, 8.5), dMint = hsl(h, Math.min(s + 4, 30), 11.5), dLine = hsl(h, Math.min(s, 24), 18);
  const darkBgs = [dSurface, dSurface2, dMint];
  const dText = hsl(h, 22, 93);
  const dText2 = legible(h, 16, 80, darkBgs, 8, -1);
  const dMuted = legible(h, 10, 62, darkBgs, 4.8, 1);
  const dFill = hsl(ah, Math.min(asat + 6, 92), clamp(al + 12, 48, 62));
  const dSoft = legible(ah, Math.min(asat + 10, 92), 62, darkBgs, 5, 1);
  const dInk = hsl(h, ds, 5);
  const dOnFill = ratio(WHITE, dFill) >= 4.5 ? WHITE : dInk;
  if (ratio(dOnFill, dFill) < 4.5) throw new Error(`${p.id}: text on the dark accent fill is below 4.5:1`);
  const D = { surface: dSurface, surface2: dSurface2, mint: dMint, line: dLine, text: dText, text2: dText2, muted: dMuted, fill: dFill, soft: dSoft, onFill: dOnFill, ink: dInk, sky1: hsl(h, ds, 9), sky2: dMint, sea1: hsl(ah, 40, 17) };
  return { L, D };
}

const x = hex;
// Shell primitives and tokens for one mode, as the lines of a rule body.
function shellLight({ L }) {
  return [
    `--tide-green: ${x(L.fill)}; --tide-lime: ${x(L.highlight)}; --tide-emerald: ${x(L.hover)};`,
    `--tide-ink: ${x(L.ink)}; --tide-green-ink: ${x(L.accentInk)}; --tide-white: #FFFFFF;`,
    `--tide-surface: #FFFFFF; --tide-surface-2: ${x(L.surface2)}; --tide-mint: ${x(L.mint)}; --tide-line: ${x(L.line)};`,
    `--tide-sky-1: ${x(L.sky1)}; --tide-sky-2: ${x(L.sky2)}; --tide-sea-1: ${x(L.sea1)};`,
    `--tide-shadow: 0 1px 2px ${rgba(L.ink, 0.05)}, 0 10px 28px -14px ${rgba(L.accentInk, 0.3)};`,
    `--tide-scrim: ${rgba(L.ink, 0.38)};`,
    `--text2: ${x(L.text2)}; --muted: ${x(L.muted)};`,
    `--accent-dim: ${rgba(L.fill, 0.14)}; --on-accent: ${x(L.onFill)};`,
    `color-scheme: light;`,
  ];
}
function shellDark({ D, L }) {
  return [
    `--tide-green: ${x(D.fill)}; --tide-lime: ${x(L.highlight)}; --tide-emerald: ${x(D.soft)};`,
    `--tide-ink: ${x(D.ink)}; --tide-green-ink: ${x(D.soft)}; --tide-white: #FFFFFF;`,
    `--tide-surface: ${x(D.surface)}; --tide-surface-2: ${x(D.surface2)}; --tide-mint: ${x(D.mint)}; --tide-line: ${x(D.line)};`,
    `--tide-sky-1: ${x(D.sky1)}; --tide-sky-2: ${x(D.sky2)}; --tide-sea-1: ${x(D.sea1)};`,
    `--tide-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 28px -14px rgba(0, 0, 0, 0.6);`,
    `--tide-scrim: rgba(0, 0, 0, 0.55);`,
    `--text: ${x(D.text)}; --text2: ${x(D.text2)}; --muted: ${x(D.muted)};`,
    `--accent-dim: ${rgba(D.fill, 0.16)}; --accent-hover: ${x(D.soft)}; --accent-soft: ${x(D.soft)}; --accent-strong: ${x(D.soft)};`,
    `--on-accent: ${x(D.onFill)}; --pill-bg: ${x(D.text)}; --pill-fg: ${x(D.ink)};`,
    `color-scheme: dark;`,
  ];
}
// Minutes register: its own token names; dark = the default structure, light = the 'paper' structure.
function minutesDark({ D }) {
  return [
    `--bg: ${x(D.surface)}; --bg-deep: ${x(shift(D.surface, -3))}; --card: ${x(D.surface2)}; --card2: ${x(D.mint)}; --card3: ${x(shift(D.mint, 8))};`,
    `--border: ${x(D.line)}; --grid: ${rgba(D.text, 0.06)}; --row-hover: ${rgba(D.text, 0.04)}; --row-sel: ${rgba(D.soft, 0.12)};`,
    `--text: ${x(D.text)}; --text2: ${x(D.text2)}; --muted: ${x(D.muted)}; --muted2: ${x(D.muted)};`,
    `--accent: ${x(D.fill)}; --accent-hover: ${x(D.soft)}; --accent-soft: ${x(D.soft)}; --accent-dim: ${rgba(D.fill, 0.16)};`,
    `--accent-fill: ${x(D.fill)}; --on-accent-fill: ${x(D.onFill)};`,
    `--up: ${x(D.soft)};`,
  ];
}
function minutesLight({ L }) {
  return [
    `--bg: #FFFFFF; --bg-deep: ${x(L.surface2)}; --card: #FFFFFF; --card2: ${x(L.surface2)}; --card3: ${x(L.mint)};`,
    `--border: ${x(L.line)}; --grid: ${rgba(L.ink, 0.06)}; --row-hover: ${rgba(L.accentInk, 0.05)}; --row-sel: ${rgba(L.highlight, 0.28)};`,
    `--text: ${x(L.ink)}; --text2: ${x(L.text2)}; --muted: ${x(L.muted)}; --muted2: ${x(L.muted)};`,
    `--accent: ${x(L.ink)}; --accent-hover: ${x(shift(L.ink, 18))}; --accent-soft: ${x(L.accentInk)}; --accent-dim: ${rgba(L.fill, 0.16)};`,
    `--accent-fill: ${x(L.ink)}; --on-accent-fill: #fff;`,
    `--gold: ${x(L.highlight)}; --gold-dim: ${rgba(L.highlight, 0.45)};`,
    `--ok-ink: ${x(L.accentInk)}; --up: ${x(L.accentInk)};`,
    `--glass: rgba(255, 255, 255, 0.88);`,
    `--shadow-float: 0 18px 48px ${rgba(L.accentInk, 0.18)}, 0 0 0 1px ${rgba(L.ink, 0.06)};`,
    `--ink-hover: ${x(shift(L.ink, 18))}; --ink-line: ${rgba(L.accentInk, 0.35)}; --green-wash: ${rgba(L.fill, 0.18)};`,
  ];
}

const body = (lines, pad = '  ') => lines.map((l) => pad + l).join('\n');
let css = `/* GENERATED by scripts/gen-palettes.mjs from its SPEC: do not edit by hand.
   Palettes recolour the one Tide structure (data-reskin="tide") through data-palette="<id>", in
   light and dark, for the shell pages, the side panel and the Minutes register (data-theme="paper"
   is its light mode). Every text pair was checked >= 4.5:1 while generating. */\n`;
const meta = [];
for (const p of SPEC) {
  const c = build(p);
  const sel = `:root[data-reskin='tide'][data-palette='${p.id}']`;
  css += `\n/* ---- ${p.name} ---- */\n`;
  css += `${sel} {\n${body(shellLight(c))}\n}\n`;
  css += `${sel}.theme-dark {\n${body(shellDark(c))}\n}\n`;
  css += `@media (prefers-color-scheme: dark) {\n  ${sel}:not(.theme-light) {\n${body(shellDark(c), '    ')}\n  }\n}\n`;
  // Minutes: its mode comes from data-theme, not the .theme-* classes; both blocks restate the primitives.
  css += `${sel}[data-theme='dark'] {\n${body([...shellDark(c), ...minutesDark(c)])}\n}\n`;
  css += `${sel}[data-theme='paper'] {\n${body([...shellLight(c), ...minutesLight(c)])}\n}\n`;
  meta.push({
    id: p.id, name: p.name, en: p.en, id_: p.id_,
    light: { bg: x(c.L.surface2), card: '#FFFFFF', accent: x(c.L.fill), ink: x(c.L.ink), line: x(c.L.line) },
    dark: { bg: x(c.D.surface), card: x(c.D.surface2), accent: x(c.D.fill), ink: x(c.D.text), line: x(c.D.line) },
  });
}
writeFileSync(new URL('../src/palettes.css', import.meta.url), css);

const tide = {
  id: 'tide', name: 'Tide', en: 'Fresh green on white. The default.', id_: 'Hijau segar di atas putih. Bawaan.',
  light: { bg: '#F3FBF6', card: '#FFFFFF', accent: '#22C55E', ink: '#0A0F0C', line: '#DCE8E1' },
  dark: { bg: '#0B1310', card: '#111C18', accent: '#22C55E', ink: '#E8F2EC', line: '#24372F' },
};
const js = `// GENERATED by scripts/gen-palettes.mjs: do not edit by hand.
// The themes the person can pick. 'tide' is the default and has no data-palette override.
export const PALETTES = ${JSON.stringify([tide, ...meta], null, 2)};
`;
writeFileSync(new URL('../src/lib/palettes.js', import.meta.url), js);
console.log(`palettes: ${SPEC.length} generated (+ Tide), all text pairs >= 4.5:1`);
