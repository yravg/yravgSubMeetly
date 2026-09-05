/**
 * Migrasi riwayat sesi ke SESSION_SCHEMA_VERSION.
 *
 * Data lama (v0) adalah array tanpa field `v`, ditulis oleh beberapa jalur
 * berbeda sehingga bentuknya tidak seragam. Migrasi ini idempoten: menjalankan
 * ulang pada data yang sudah termigrasi tidak mengubah apa pun.
 */
import { MAX_SESSIONS, SESSION_SCHEMA_VERSION, isCurrentSession, normalizeSession } from './session-schema.js';

/** True bila ada entri yang belum memakai skema saat ini. */
export function needsMigration(raw) {
  if (!Array.isArray(raw)) return !!raw;
  return raw.some((e) => !isCurrentSession(e));
}

/**
 * Kembalikan array sesi yang sudah ternormalisasi, terurut terbaru dulu, dan
 * dipotong ke MAX_SESSIONS. Entri yang tidak bisa dipakai dibuang, bukan
 * dibiarkan merusak daftar.
 */
export function migrateSessions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const s = isCurrentSession(entry) ? entry : normalizeSession(entry);
    if (seen.has(s.id)) continue; // id ganda: pertahankan yang terbaru saja
    seen.add(s.id);
    out.push(s);
  }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out.slice(0, MAX_SESSIONS);
}

export { SESSION_SCHEMA_VERSION };
