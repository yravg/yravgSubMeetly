/**
 * src/lib/ask-export.js — menyimpan berkas ekspor Ask Tide: chrome.downloads di ekstensi,
 * tautan unduh di lab / jendela engine. Semua distub; tanpa browser.
 *   node --test test/ask-export.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveExport, openExport } from '../src/lib/ask-export.js';

const FILE = { name: 'open-actions-2026-11-09.md', content: '# Open actions\n', mime: 'text/markdown' };

function fakeChrome({ has = true, grants = true } = {}) {
  const calls = [];
  return {
    calls,
    permissions: {
      contains: async (q) => { calls.push(['contains', q]); return has; },
      request: async (q) => { calls.push(['request', q]); return grants; },
    },
    downloads: {
      download: async (o) => { calls.push(['download', o]); return 41; },
      show: (id) => { calls.push(['show', id]); },
    },
  };
}
const fakeDoc = () => {
  const clicks = [];
  return { clicks, createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }), body: { append() {} } };
};
const noUrl = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };

test('ekstensi: chrome.downloads.download, id disimpan untuk tombol Open', async () => {
  const chrome = fakeChrome();
  const r = await saveExport(FILE, { chrome, doc: fakeDoc(), url: noUrl });
  assert.deepEqual(r, { ok: true, via: 'downloads', filename: FILE.name, id: 41 });
  const dl = chrome.calls.find((c) => c[0] === 'download')[1];
  assert.equal(dl.filename, FILE.name);
  assert.equal(dl.saveAs, false);
  assert.match(dl.url, /^data:text\/markdown;charset=utf-8,/);
  assert.equal(decodeURIComponent(dl.url.split(',')[1]), FILE.content);
  assert.equal(chrome.calls.some((c) => c[0] === 'request'), false, 'izin sudah ada: tidak diminta lagi');
  assert.equal(chrome.calls.some((c) => c[0] === 'show'), false, 'belum dibuka: itu tombol Open');
});

test('izin downloads bersifat opsional: diminta saat ekspor pertama', async () => {
  const chrome = fakeChrome({ has: false, grants: true });
  const r = await saveExport(FILE, { chrome, doc: fakeDoc(), url: noUrl });
  assert.equal(r.via, 'downloads');
  assert.deepEqual(chrome.calls.find((c) => c[0] === 'request')[1], { permissions: ['downloads'] });
});

test('izin ditolak → tautan unduh, tanpa id (jadi tanpa Open)', async () => {
  const chrome = fakeChrome({ has: false, grants: false });
  const doc = fakeDoc();
  const r = await saveExport(FILE, { chrome, doc, url: noUrl });
  assert.deepEqual(r, { ok: true, via: 'link', filename: FILE.name, id: null });
  assert.deepEqual(doc.clicks, [FILE.name]);
  assert.equal(chrome.calls.some((c) => c[0] === 'download'), false);
});

test('lab / jendela engine (tanpa chrome.downloads): tautan unduh dengan nama berkas', async () => {
  const doc = fakeDoc();
  const r = await saveExport(FILE, { chrome: { runtime: {} }, doc, url: noUrl });
  assert.deepEqual(r, { ok: true, via: 'link', filename: FILE.name, id: null });
  assert.deepEqual(doc.clicks, [FILE.name]);
});

test('galat download → ok:false dengan pesan, bukan lemparan', async () => {
  const chrome = fakeChrome();
  chrome.downloads.download = async () => { throw new Error('Invalid filename'); };
  const r = await saveExport(FILE, { chrome, doc: fakeDoc(), url: noUrl });
  assert.equal(r.ok, false);
  assert.match(r.error, /Invalid filename/);
});

test('openExport: chrome.downloads.show(id); tanpa id atau API → false', () => {
  const chrome = fakeChrome();
  assert.equal(openExport(41, { chrome }), true);
  assert.deepEqual(chrome.calls.at(-1), ['show', 41]);
  assert.equal(openExport(null, { chrome }), false);
  assert.equal(openExport(41, { chrome: { runtime: {} } }), false);
});
