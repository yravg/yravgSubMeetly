/**
 * Perender Markdown untuk halaman panduan (test/guide.html).
 *   node --test test/mini-markdown.test.mjs
 *
 * guide.html menyuntikkan hasilnya lewat innerHTML, jadi escaping bukan
 * kerapian melainkan syarat: docs/*.md dirender apa adanya ke DOM.
 * Tes ini juga merender panduan sungguhan supaya konstruksi yang dipakai
 * penulisnya tidak pernah melewati apa yang bisa dirender.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderInline, renderMarkdown, escapeHtml } from './mini-markdown.js';

test('HTML mentah di-escape, bukan dieksekusi', () => {
  assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
  const html = renderMarkdown('Teks <img src=x onerror=alert(1)> lagi');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('tautan: relatif dan http(s) diterima, skema berbahaya ditolak', () => {
  assert.match(renderInline('[a](https://x.test/y)'), /<a href="https:\/\/x\.test\/y">a<\/a>/);
  assert.match(renderInline('[b](../native/SETUP.md)'), /<a href="\.\.\/native\/SETUP\.md">b<\/a>/);
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
    const out = renderInline(`[klik](${bad})`);
    assert.doesNotMatch(out, /<a /, `${bad} seharusnya tidak jadi tautan`);
  }
});

test('`kode` inline tidak mengubah angka telanjang di sekitarnya', () => {
  // Placeholder berbasis angka pernah mengubah " 3 " jadi <code>undefined</code>.
  const out = renderInline('sekitar 3 menit dan `npm run build` lalu 42 detik');
  assert.match(out, /sekitar 3 menit/);
  assert.match(out, /<code>npm run build<\/code>/);
  assert.match(out, /lalu 42 detik/);
  assert.doesNotMatch(out, /undefined/);
});

test('tebal dan kode tidak saling merusak', () => {
  assert.match(renderInline('**Balanced** — `Whisper Base`'), /<strong>Balanced<\/strong>/);
  // Bintang DI DALAM kode harus tetap literal.
  assert.match(renderInline('`a ** b`'), /<code>a \*\* b<\/code>/);
});

test('judul, daftar, tabel, dan blok kode terbentuk', () => {
  const md = [
    '# Judul',
    '',
    'Paragraf biasa.',
    '',
    '## Bagian',
    '',
    '1. satu',
    '2. dua',
    '',
    '- a',
    '- b',
    '',
    '| Kolom | Arti |',
    '| --- | --- |',
    '| x | y |',
    '',
    '```',
    'npm run build',
    '```',
    '',
    '---',
  ].join('\n');
  const html = renderMarkdown(md);
  assert.match(html, /<h1>Judul<\/h1>/);
  assert.match(html, /<h2>Bagian<\/h2>/);
  assert.match(html, /<p>Paragraf biasa\.<\/p>/);
  assert.match(html, /<ol><li>satu<\/li><li>dua<\/li><\/ol>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<th>Kolom<\/th><th>Arti<\/th>/);
  assert.match(html, /<td>x<\/td><td>y<\/td>/);
  // Tabel lebar harus bisa menggulir sendiri, bukan mendorong halaman.
  assert.match(html, /<div class="table-wrap"><table>/);
  assert.match(html, /<pre><code>npm run build<\/code><\/pre>/);
  assert.match(html, /<hr \/>/);
});

test('kutipan `>` menjadi blockquote, termasuk yang menyambung beberapa baris', () => {
  const html = renderMarkdown(['> **Catatan:** baris satu', '> baris dua', '', 'Paragraf biasa.'].join('\n'));
  assert.match(html, /<blockquote><p><strong>Catatan:<\/strong> baris satu baris dua<\/p><\/blockquote>/);
  assert.match(html, /<p>Paragraf biasa\.<\/p>/);
  assert.doesNotMatch(html, /&gt;/);
});

test('sub-poin menjorok menempel pada butir induknya', () => {
  const html = renderMarkdown(['1. Pilih model:', '   yang sesuai kebutuhan', '2. Tekan Start'].join('\n'));
  assert.match(html, /<li>Pilih model: yang sesuai kebutuhan<\/li>/);
  assert.match(html, /<li>Tekan Start<\/li>/);
});

// Panduan yang dipublikasikan halaman guide.html — daftarnya harus sama dengan
// allowlist DOCS di test/guide.html.
const GUIDES = ['USER-GUIDE.md', 'USER-GUIDE-MACOS.md', 'USER-GUIDE-WINLINUX.md'];

for (const file of GUIDES) {
  test(`docs/${file} terender penuh, tanpa sisa penanda mentah`, () => {
    const md = readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8');
    const html = renderMarkdown(md);
    assert.match(html, /<h1>/);
    // Panduan Win/Linux memakai h3 untuk sub-bagian per OS, jadi h2-nya lebih sedikit.
    assert.ok((html.match(/<h2>/g) || []).length >= 6, 'bagian utama panduan hilang');
    assert.ok((html.match(/<h[23]>/g) || []).length >= 10, 'sub-bagian panduan hilang');
    assert.ok((html.match(/<table>/g) || []).length >= 2, 'tabel panduan tidak terender');

    // Tidak boleh ada baris Markdown yang lolos mentah ke keluaran — di luar
    // blok kode; komentar shell `# Debian` di dalam <pre> memang harus utuh.
    const prose = html.replace(/<pre>[\s\S]*?<\/pre>/g, '');
    assert.doesNotMatch(prose, /^\s*#{1,4}\s/m, 'judul mentah tersisa');
    assert.doesNotMatch(prose, /\|\s*---\s*\|/, 'pemisah tabel mentah tersisa');
    assert.doesNotMatch(prose, /\*\*/, 'penanda tebal mentah tersisa');
    assert.doesNotMatch(prose, /^\s*&gt;/m, 'kutipan mentah tersisa');
    assert.doesNotMatch(html, /undefined/);
  });
}

test('allowlist guide.html memuat tepat panduan yang ada di docs/', () => {
  const page = readFileSync(new URL('./guide.html', import.meta.url), 'utf8');
  for (const file of GUIDES) {
    assert.ok(page.includes(`'${file}'`), `guide.html tidak menawarkan ${file}`);
  }
  // Berkas yang ditawarkan halaman harus benar-benar ada, kalau tidak
  // pemilihnya menghasilkan 404 di muka pengguna.
  const offered = [...page.matchAll(/file:\s*'([^']+\.md)'/g)].map((m) => m[1]);
  assert.deepEqual(offered.sort(), [...GUIDES].sort());
});
