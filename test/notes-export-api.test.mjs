import test from 'node:test';
import assert from 'node:assert/strict';
import { notesExport } from '../src/lib/notes-api.js';

test('notesExport decodes the base64 body of a DOCX/PDF into a blob', async () => {
  const bytes = Buffer.from('%PDF-1.4 fake');
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    return { ok: true, json: async () => ({ filename: 'x.pdf', mime: 'application/pdf', encoding: 'base64', content: bytes.toString('base64') }) };
  };
  const out = await notesExport('http://127.0.0.1:17865/', { id: 'MOM-1' }, 'pdf');
  assert.equal(calls[0][0], 'http://127.0.0.1:17865/notes/export');
  assert.deepEqual(calls[0][1], { note: { id: 'MOM-1' }, format: 'pdf' });
  assert.equal(out.filename, 'x.pdf');
  assert.equal(out.blob.type, 'application/pdf');
  assert.equal(Buffer.from(await out.blob.arrayBuffer()).toString(), '%PDF-1.4 fake');
});

test('notesExport returns text formats as text and fails loudly when the engine says no', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ filename: 'x.md', content: '# Hi' }) });
  const md = await notesExport(undefined, {}, 'markdown');
  assert.equal(await md.blob.text(), '# Hi');
  globalThis.fetch = async () => ({ ok: false, status: 400 });
  await assert.rejects(() => notesExport(undefined, {}, 'rtf'), /notes\/export 400/);
});
