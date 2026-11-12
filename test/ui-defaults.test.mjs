/**
 * Bawaan tampilan (keputusan pemilik 2026-11-10): reskin Tide dan tema terang untuk pengguna baru
 * dan untuk yang masih memakai bawaan lama; pilihan eksplisit tidak diubah.
 *   node --test test/ui-defaults.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateUiDefaults, shouldAdoptRemote, DEFAULT_RESKIN, DEFAULT_THEME } from '../src/lib/ui-defaults.js';

test('bawaan: Tide dan terang', () => {
  assert.equal(DEFAULT_RESKIN, 'tide');
  assert.equal(DEFAULT_THEME, 'light');
  assert.deepEqual(migrateUiDefaults(undefined), { reskin: 'tide', theme: 'light' });
  assert.deepEqual(migrateUiDefaults({}), { reskin: 'tide', theme: 'light' });
});

test('pengguna lama di bawaan lama (tersimpan utuh tanpa penanda) pindah ke bawaan baru', () => {
  assert.deepEqual(migrateUiDefaults({ reskin: 'yraverage', theme: 'auto' }), { reskin: 'tide', theme: 'light' });
});

test('pilihan eksplisit tidak diubah, termasuk Klasik, Coretax, Modern, gelap dan otomatis', () => {
  assert.deepEqual(migrateUiDefaults({ reskin: 'yraverage', reskinExplicit: true, theme: 'auto', themeExplicit: true }), { reskin: 'teal', theme: 'auto' });
  assert.deepEqual(migrateUiDefaults({ reskin: 'coretax', theme: 'dark' }), { reskin: 'azure', theme: 'dark' });
  assert.deepEqual(migrateUiDefaults({ reskin: 'modern', theme: 'light' }), { reskin: 'violet', theme: 'light' });
});

test('nilai tak dikenal jatuh ke bawaan', () => {
  assert.deepEqual(migrateUiDefaults({ reskin: 'neon', theme: 'sepia' }), { reskin: 'tide', theme: 'light' });
});

test('salinan dari helper: nilai bawaan lama tidak menimpa bawaan baru kecuali pilihan eksplisit', () => {
  assert.equal(shouldAdoptRemote('reskin', 'yraverage', {}), false);
  assert.equal(shouldAdoptRemote('theme', 'auto', {}), false);
  assert.equal(shouldAdoptRemote('reskin', 'yraverage', { reskinExplicit: true }), true);
  assert.equal(shouldAdoptRemote('theme', 'auto', { themeExplicit: true }), true);
  assert.equal(shouldAdoptRemote('reskin', 'modern', {}), true);
  assert.equal(shouldAdoptRemote('theme', 'dark', {}), true);
});
