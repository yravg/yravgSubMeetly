/**
 * Penjaga design system.
 *   node --test test/design-tokens.test.mjs
 *
 * Bukan tes tampilan — tes disiplin. Yang dijaga adalah hal-hal yang kalau
 * longgar akan kembali menimbulkan bug nyata: nilai z-index yang dipilih
 * dengan menebak (itu yang membuat panel Pengaturan pernah tercetak di bawah
 * halaman), skala yang didefinisikan dua kali di dua berkas, dan halaman yang
 * memuat stylesheet permukaan tanpa memuat tokennya — yang membuat seluruh
 * `var()` gagal diam-diam.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(root + f, 'utf8');
const SURFACES = ['src/minutes.css', 'src/sidepanel.css', 'src/notes-panel.css'];

/** Buang komentar supaya contoh di dalamnya tidak ikut terhitung. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('tidak ada z-index mentah di stylesheet permukaan', () => {
  for (const f of SURFACES) {
    const raw = [...stripComments(read(f)).matchAll(/z-index:\s*(-?[0-9]+)/g)].map((m) => m[1]);
    assert.deepEqual(raw, [], `${f} memakai z-index mentah: ${raw.join(', ')} — pakai token --z-* dari tokens.css`);
  }
});

test('tangga lapisan naik monoton dan tiap rung punya nama', () => {
  const tokens = [...read('src/tokens.css').matchAll(/--z-([a-z-]+):\s*([0-9]+);/g)]
    .map(([, name, v]) => ({ name, v: Number(v) }));
  assert.ok(tokens.length >= 14, `tangga terlalu pendek: ${tokens.length} rung`);
  for (let i = 1; i < tokens.length; i++) {
    assert.ok(tokens[i].v >= tokens[i - 1].v,
      `urutan tangga terbalik: --z-${tokens[i - 1].name}(${tokens[i - 1].v}) lalu --z-${tokens[i].name}(${tokens[i].v})`);
  }
  // Urutan yang benar-benar menentukan perilaku, dan pernah salah sekali.
  const at = (n) => tokens.find((t) => t.name === n)?.v;
  assert.ok(at('dock') < at('appbar'), 'appbar harus di atas dok');
  assert.ok(at('appbar') < at('overlay'), 'overlay modal harus menutupi appbar');
  assert.ok(at('toast') < at('appbar'), 'popover appbar harus di atas toast');
});

test('skala bersama hanya didefinisikan sekali, di tokens.css', () => {
  const shared = [...read('src/tokens.css').matchAll(/^\s*(--(?:space|text|radius|font|z|ease|transition|container)-[a-z0-9-]+):/gm)]
    .map((m) => m[1]);
  assert.ok(shared.length >= 40, `tokens.css terlalu tipis: ${shared.length}`);

  // Permukaan boleh MENIMPA satu token dengan alasan tertulis, tapi tidak
  // boleh menyalin ulang skalanya.
  for (const f of ['src/minutes.css', 'src/sidepanel.css']) {
    const css = read(f);
    const redefined = shared.filter((t) => new RegExp(`^\\s*${t}\\s*:`, 'm').test(css));
    assert.ok(redefined.length <= 12,
      `${f} mendefinisikan ulang ${redefined.length} token skala: ${redefined.join(', ')}`);
    for (const t of redefined) {
      const i = css.search(new RegExp(`^\\s*${t}\\s*:`, 'm'));
      const before = css.slice(Math.max(0, i - 400), i);
      assert.ok(/\*\//.test(before), `penimpaan ${t} di ${f} tanpa komentar yang menjelaskan alasannya`);
    }
  }
});

test('setiap halaman yang memuat stylesheet permukaan juga memuat tokens.css', () => {
  // Kalau tidak, seluruh var() gagal tanpa galat: teksnya balik ke 16px dan
  // padding-nya hilang, dan itu hanya kelihatan kalau halamannya dibuka.
  const pages = [
    ...readdirSync(root + 'src').filter((f) => f.endsWith('.html')).map((f) => `src/${f}`),
    ...readdirSync(root + 'test').filter((f) => f.endsWith('.html')).map((f) => `test/${f}`),
  ];
  const gagal = [];
  for (const page of pages) {
    const html = read(page);
    if (!/href="[^"]*(sidepanel|minutes|notes-panel)\.css"/.test(html)) continue;
    if (!/href="[^"]*tokens\.css"/.test(html)) gagal.push(page);
  }
  assert.deepEqual(gagal, [], `halaman tanpa tokens.css: ${gagal.join(', ')}`);
});

test('tokens.css ikut tersalin oleh build', () => {
  assert.match(read('esbuild.config.mjs'), /\['src\/tokens\.css', 'tokens\.css'\]/,
    'tokens.css tidak ada di daftar salin build — dist akan kehilangan seluruh tokennya');
});

test('nama kelas dan kosakata easing seragam antar permukaan', () => {
  const all = SURFACES.map(read).join('\n') + read('src/minutes.html') + read('src/sidepanel.html');
  assert.ok(!/\biconbtn\b/.test(all), 'masih ada .iconbtn — ejaannya .icon-btn');
  assert.ok(!/--ease-(std|emph)\b/.test(all), 'masih ada --ease-std/--ease-emph — pakai --ease-sharp/--ease-emphasized');
});

/* ---------------------------------------------------------------------------
 * TIDE-001 (papan K01): lapisan token Tide di src/theme-tide.css.
 * Hanya berlaku di bawah [data-reskin='tide']; token global tidak disentuh.
 * ------------------------------------------------------------------------- */
const TIDE = 'src/theme-tide.css';
const TIDE_NAMES = [
  '--bg', '--card', '--card2', '--card3', '--border', '--text', '--text2', '--muted',
  '--accent', '--accent-hover', '--accent-soft', '--accent-dim', '--accent-strong', '--on-accent',
  '--warn-bg', '--warn-text', '--danger', '--danger-bg', '--pill-bg', '--pill-fg',
];

/** Deklarasi `--x: v` di semua blok yang selektornya memenuhi `pick`. */
function tideVars(pick) {
  const css = stripComments(read(TIDE));
  const out = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!pick(m[1].trim())) continue;
    for (const d of m[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}
const isDark = (sel) => /theme-dark|:not\(\.theme-light\)/.test(sel);
const lightVars = () => tideVars((s) => /\[data-reskin='tide'\]/.test(s) && !isDark(s));
const darkVars = () => ({ ...lightVars(), ...tideVars((s) => /\[data-reskin='tide'\]/.test(s) && isDark(s)) });

function resolve(vars, v, depth = 0) {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (!m || depth > 5) return v;
  assert.ok(m[1] in vars, `${m[1]} dipakai tetapi tidak didefinisikan di ${TIDE}`);
  return resolve(vars, vars[m[1]], depth + 1);
}
function lum(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('TIDE-001: theme-tide.css hanya berlaku di bawah [data-reskin=tide]', () => {
  const css = stripComments(read(TIDE));
  for (const m of css.matchAll(/([^{}@]+)\{[^{}]*--[a-z]/g)) {
    const sel = m[1].trim();
    assert.match(sel, /\[data-reskin='tide'\]/, `blok token tanpa cakupan Tide: "${sel}"`);
  }
});

test('TIDE-001: nama token aplikasi dipetakan, terang dan gelap', () => {
  for (const [mode, vars] of [['terang', lightVars()], ['gelap', darkVars()]]) {
    for (const n of TIDE_NAMES) {
      assert.ok(n in vars, `${n} tidak ada (${mode})`);
      assert.match(resolve(vars, vars[n]), /^#[0-9a-fA-F]{3,6}$|^rgba?\(/, `${n} (${mode}) bukan warna`);
    }
  }
  const dark = tideVars((s) => /\[data-reskin='tide'\]/.test(s) && isDark(s));
  for (const n of ['--bg', '--card', '--text', '--muted', '--accent-soft', '--pill-bg', '--pill-fg']) {
    assert.ok(n in dark, `${n} tidak ditimpa untuk gelap`);
  }
});

test('TIDE-001: setiap pasangan teks ≥ 4,5:1 (tabel kontras K01)', () => {
  const PAIRS = [
    ['--text', '--bg'], ['--text', '--card'], ['--text', '--card2'], ['--text2', '--card'],
    ['--muted', '--bg'], ['--muted', '--card'], ['--muted', '--card2'],
    ['--accent-soft', '--card'], ['--accent-soft', '--card2'],
    ['--on-accent', '--accent-strong'], ['--pill-fg', '--pill-bg'],
    ['--danger', '--card'], ['--danger', '--danger-bg'], ['--warn-text', '--warn-bg'],
  ];
  const rows = [];
  for (const [mode, vars] of [['light', lightVars()], ['dark', darkVars()]]) {
    for (const [fg, bg] of PAIRS) {
      const a = resolve(vars, vars[fg]); const b = resolve(vars, vars[bg]);
      const r = ratio(a, b);
      rows.push(`${mode} ${fg} ${a} on ${bg} ${b} = ${r.toFixed(2)}`);
      assert.ok(r >= 4.5, `${mode}: ${fg} ${a} di atas ${bg} ${b} hanya ${r.toFixed(2)}:1`);
    }
  }
  assert.equal(rows.length, PAIRS.length * 2);
});

test('TIDE-001: hijau merek tidak pernah jadi warna teks di latar terang', () => {
  const v = lightVars();
  for (const n of ['--text', '--text2', '--muted', '--accent-soft']) {
    assert.notEqual(resolve(v, v[n]).toUpperCase(), '#22C55E', `${n} memakai hijau merek sebagai teks`);
  }
  assert.equal(resolve(v, v['--accent']).toUpperCase(), '#22C55E', '--accent (isian) adalah hijau merek');
});

test('TIDE-001: Fredoka dan Plus Jakarta Sans ikut dipaket dengan lisensi OFL', () => {
  const css = read(TIDE);
  for (const fam of ['Fredoka', 'Plus Jakarta Sans']) {
    const face = new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*'${fam}'[^}]*url\\('([^']+)'\\)`).exec(css);
    assert.ok(face, `@font-face ${fam} tidak ada`);
    const file = 'src/' + face[1].replace(/^\.\//, '');
    assert.ok(readdirSync(root + file.replace(/\/[^/]+$/, '')).includes(file.split('/').pop()), `${file} tidak ada`);
  }
  for (const lic of ['src/fonts/OFL-Fredoka.txt', 'src/fonts/OFL-PlusJakartaSans.txt']) {
    assert.match(read(lic), /SIL OPEN FONT LICENSE/i, `${lic} bukan lisensi OFL`);
  }
  const build = read('esbuild.config.mjs');
  assert.match(build, /'src\/theme-tide\.css'/, 'theme-tide.css tidak disalin build');
  assert.match(build, /src\/fonts/, 'folder fonts tidak disalin build');
});
