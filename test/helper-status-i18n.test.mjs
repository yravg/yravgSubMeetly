// The Native Helper card follows the UI language: no Indonesian text in English or Chinese.
//   node --test test/helper-status-i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHelperStatusCard } from '../src/helper-status.js';

// The card only writes innerHTML and wires listeners; a stub root is enough (no jsdom).
const stubRoot = () => ({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });
const ID_WORDS = /terhubung|terputus|Tugas|Mesin|Panduan|Jalankan|Pastikan|Daftarkan|Buka |Verifikasi|Ikuti|OS ini|lewat|bisa/;

for (const os of ['macos', 'windows', 'linux', 'unknown']) {
  for (const lang of ['en', 'zh']) {
    for (const online of [true, false]) {
      test(`${os} ${lang} online=${online}: no Indonesian`, () => {
        const root = stubRoot();
        renderHelperStatusCard(root, { os, lang, online, engine: 'native', largeFile: null });
        const text = root.innerHTML.replace(/<[^>]+>/g, ' ');
        assert.doesNotMatch(text, ID_WORDS);
      });
    }
  }
  test(`${os} id: card stays Indonesian`, () => {
    const root = stubRoot();
    renderHelperStatusCard(root, { os, lang: 'id', online: false, engine: 'native', largeFile: null });
    assert.match(root.innerHTML, /Helper terputus/);
    assert.match(root.innerHTML, /Panduan/);
  });
}
