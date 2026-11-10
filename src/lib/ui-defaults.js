/**
 * Bawaan tampilan panel samping dan app shell (keputusan pemilik 2026-11-10).
 *
 * Kontrak:
 *  DEFAULT_RESKIN = 'tide', DEFAULT_THEME = 'light' ('auto' tetap pilihan, ikut sistem).
 *  migrateUiDefaults(settings) → { reskin, theme } yang berlaku.
 *   - Tanpa nilai, atau nilai tak dikenal → bawaan baru.
 *   - Pengaturan lama disimpan utuh oleh panel, jadi 'yraverage' / 'auto' tanpa penanda
 *     `reskinExplicit` / `themeExplicit` dibaca sebagai "masih di bawaan lama" dan pindah.
 *   - Penanda ditulis hanya saat pengguna memilih sendiri (setReskin, setTheme).
 *  shouldAdoptRemote(key, value, settings) → bool: salinan dari helper (/ui-prefs) boleh
 *   menimpa nilai lokal? Nilai bawaan lama dari helper hanya diterima bila pilihan itu eksplisit.
 * Catatan: pengguna yang dulu memilih Klasik/otomatis sendiri tak bisa dibedakan dari yang
 * bawaan (tidak ada penanda saat itu); mereka pindah satu kali dan bisa memilih lagi.
 */
export const RESKINS = ['yraverage', 'coretax', 'modern', 'tide'];
export const THEMES = ['auto', 'light', 'dark'];
export const DEFAULT_RESKIN = 'tide';
export const DEFAULT_THEME = 'light';

const OLD = { reskin: 'yraverage', theme: 'auto' };
const FLAG = { reskin: 'reskinExplicit', theme: 'themeExplicit' };

export function migrateUiDefaults(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const pick = (key, list, dflt) => {
    const v = s[key];
    if (!list.includes(v)) return dflt;
    if (v === OLD[key] && !s[FLAG[key]]) return dflt;
    return v;
  };
  return { reskin: pick('reskin', RESKINS, DEFAULT_RESKIN), theme: pick('theme', THEMES, DEFAULT_THEME) };
}

export function shouldAdoptRemote(key, value, settings) {
  if (value === OLD[key]) return !!settings?.[FLAG[key]];
  return true;
}
