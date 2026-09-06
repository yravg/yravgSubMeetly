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
