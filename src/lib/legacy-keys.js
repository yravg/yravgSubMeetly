/**
 * Migrasi kunci penyimpanan dari nama lama (awalan `lts`, dari "Local TransSub")
 * ke `ysm` (yraverageSubMin).
 *
 * Ganti nama tanpa migrasi berarti pengguna yang sudah memakai aplikasi ini
 * kehilangan tata letak panel, glosarium, pasangan bahasa, dan namanya sendiri —
 * datanya masih ada di localStorage, hanya tidak pernah dibaca lagi. Jadi kunci
 * lama disalin lebih dulu, sekali, lalu dibuang.
 *
 * Sifatnya idempoten: kunci baru yang sudah ada tidak pernah ditimpa, sehingga
 * memanggilnya berkali-kali (atau di beberapa permukaan sekaligus) aman.
 */

/** Kunci lama → kunci baru. Hanya kunci yang benar-benar bertahan di disk. */
export const LEGACY_LOCAL_KEYS = Object.freeze({
  ltsMinutesLayout: 'ysmMinutesLayout',
  ltsMinutesLang: 'ysmMinutesLang',
  ltsMinutesMe: 'ysmMinutesMe',
  ltsMinutesTgt: 'ysmMinutesTgt',
  ltsGlossary: 'ysmGlossary',
  ltsAppWidth: 'ysmAppWidth',
});

/**
 * Pindahkan nilai kunci lama ke kunci baru bila kunci barunya belum ada.
 * @param {Storage} [store] penyimpanan yang dipakai; localStorage secara bawaan.
 * @returns {string[]} kunci baru yang benar-benar terisi pada pemanggilan ini.
 */
export function migrateLegacyLocalKeys(store) {
  const s = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return [];
  const moved = [];
  for (const [oldKey, newKey] of Object.entries(LEGACY_LOCAL_KEYS)) {
    try {
      const legacy = s.getItem(oldKey);
      if (legacy === null) continue;
      // Kunci baru menang: pengguna mungkin sudah memakai versi baru di
      // perangkat ini, dan nilai lamanya tinggal sisa.
      if (s.getItem(newKey) === null) {
        s.setItem(newKey, legacy);
        moved.push(newKey);
      }
      s.removeItem(oldKey);
    } catch {
      /* kuota penuh atau storage diblokir — biarkan kunci lama apa adanya */
    }
  }
  return moved;
}
