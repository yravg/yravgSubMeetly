/**
 * Skema penyimpanan sesi v1 — Local TransSub.
 *
 * Riwayat sesi sebelumnya disimpan sebagai array mentah tanpa versi: setiap
 * penulis (background, offscreen, panel) menaruh bentuknya sendiri, dan tidak
 * ada cara aman menambah field tanpa merusak data lama. Skema ini memberi
 * bentuk tunggal + nomor versi supaya migrasi berikutnya punya pijakan.
 *
 * Versioned session-history schema. The previous format was an unversioned
 * array whose shape depended on which writer produced it.
 */

export const SESSION_SCHEMA_VERSION = 1;

/** Batas entri tersimpan — sama dengan perilaku lama agar tidak ada kejutan. */
export const MAX_SESSIONS = 50;

/** @typedef {'realtime'|'offline'} SessionMode */

/** Baris transkrip tersimpan: milidetik + teks sumber/terjemahan. */
export function normalizeLine(l) {
  const t = Number(l?.t ?? (l?.t0 != null ? Math.round(l.t0 * 1000) : 0)) || 0;
  const t1raw = l?.t1 != null ? Number(l.t1) : null;
  // Entri lama menyimpan t1 dalam detik pada sebagian jalur; nilai yang lebih
  // kecil dari t hampir pasti detik, bukan milidetik.
  const t1 = t1raw == null ? t + 3000 : t1raw < t ? Math.round(t1raw * 1000) : Math.round(t1raw);
  return {
    t,
    t1: Math.max(t1, t + 1),
    src: String(l?.src ?? l?.source ?? ''),
    tgt: String(l?.tgt ?? l?.translation ?? ''),
  };
}

/** Satu entri riwayat sesi dalam bentuk kanonis. */
export function normalizeSession(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const mode = e.mode === 'offline' ? 'offline' : 'realtime';
  const lines = Array.isArray(e.lines) ? e.lines.map(normalizeLine) : [];
  const ts = Number(e.ts) || Date.now();
  return {
    v: SESSION_SCHEMA_VERSION,
    id: String(e.id || `s-${ts}-${Math.random().toString(36).slice(2, 8)}`),
    ts,
    mode,
    title: String(e.title || 'Untitled session'),
    url: String(e.url || ''),
    srcLang: String(e.srcLang || ''),
    tgtLang: String(e.tgtLang || ''),
    lines,
    // Diturunkan, bukan disimpan ganda oleh pemanggil — supaya tidak bisa
    // berbohong terhadap isi `lines`.
    lineCount: lines.length,
    durationMs: lines.length ? Math.max(0, lines[lines.length - 1].t1 - lines[0].t) : 0,
  };
}

/** True bila entri sudah memakai skema versi saat ini. */
export function isCurrentSession(entry) {
  return !!entry && typeof entry === 'object' && entry.v === SESSION_SCHEMA_VERSION;
}

/** Jeda antar simpan-otomatis sesi berjalan. */
export const AUTOSAVE_INTERVAL_MS = 10_000;

/**
 * Haruskah sesi berjalan disimpan sekarang?
 *
 * Dipisah dari service worker supaya bisa diuji: keputusan throttle inilah
 * yang menentukan apakah transkrip selamat saat worker mati mendadak.
 */
export function shouldAutosave({ now, lastAt, lineCount, active = true, force = false, intervalMs = AUTOSAVE_INTERVAL_MS }) {
  if (!active || !lineCount) return false;
  if (force) return true;
  return now - lastAt >= intervalMs;
}
