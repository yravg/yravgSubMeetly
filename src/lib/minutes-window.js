/**
 * TIDE-023 (board A04c): "Open Minutes window ↗".
 *
 * Kontrak:
 *  - openMinutesWindow(api, url) → Promise<'focused'|'created'|'tab'>
 *      Bila jendela Minutes yang tercatat masih ada: fokuskan (tidak membuka kedua).
 *      Kalau tidak: buat popup (`chrome.windows.create`, type 'popup') dengan ukuran
 *      dan posisi terakhir dari chrome.storage.local, lalu catat id-nya.
 *      Tanpa chrome.windows (lab): window.open bernama, jadi klik kedua memakai
 *      jendela yang sama.
 *  - trackMinutesWindow(api) — dipasang sekali di background: simpan ukuran dan posisi
 *    saat jendela itu diubah, hapus id saat ditutup.
 *  - isMinutesWindowOpen(api) → Promise<boolean> — untuk label tombol.
 * Kunci storage: WIN_ID_KEY (number), WIN_BOUNDS_KEY ({left, top, width, height}).
 * Halaman minutes.html sendiri tidak berubah.
 */

export const WIN_ID_KEY = 'minutesWindowId';
export const WIN_BOUNDS_KEY = 'minutesWindowBounds';
export const DEFAULT_BOUNDS = { width: 1280, height: 800 };
const LAB_NAME = 'ysm-minutes';

/** Hanya bilangan bulat yang masuk akal; sisanya dibuang supaya windows.create tidak menolak. */
export function cleanBounds(b) {
  const out = {};
  for (const k of ['left', 'top', 'width', 'height']) {
    if (Number.isFinite(b?.[k])) out[k] = Math.round(b[k]);
  }
  if (!(out.width >= 480) || !(out.height >= 360)) return { ...DEFAULT_BOUNDS };
  return out;
}

async function storedId(api) {
  const id = (await api.storage.local.get(WIN_ID_KEY))[WIN_ID_KEY];
  if (!Number.isInteger(id)) return null;
  try {
    await api.windows.get(id);
    return id;
  } catch {
    await api.storage.local.remove(WIN_ID_KEY);
    return null;
  }
}

export async function isMinutesWindowOpen(api) {
  if (!api?.windows?.get) return false;
  return (await storedId(api)) != null;
}

export async function openMinutesWindow(api, url, win = globalThis.window) {
  if (!api?.windows?.create) {
    win?.open(url, LAB_NAME, `popup,width=${DEFAULT_BOUNDS.width},height=${DEFAULT_BOUNDS.height}`);
    return 'tab';
  }
  const id = await storedId(api);
  if (id != null) {
    await api.windows.update(id, { focused: true });
    return 'focused';
  }
  const bounds = cleanBounds((await api.storage.local.get(WIN_BOUNDS_KEY))[WIN_BOUNDS_KEY]);
  const w = await api.windows.create({ url, type: 'popup', focused: true, ...bounds });
  await api.storage.local.set({ [WIN_ID_KEY]: w.id });
  return 'created';
}

export function trackMinutesWindow(api) {
  api.windows?.onBoundsChanged?.addListener(async (w) => {
    const id = (await api.storage.local.get(WIN_ID_KEY))[WIN_ID_KEY];
    if (w.id === id) await api.storage.local.set({ [WIN_BOUNDS_KEY]: cleanBounds(w) });
  });
  api.windows?.onRemoved?.addListener(async (wid) => {
    const id = (await api.storage.local.get(WIN_ID_KEY))[WIN_ID_KEY];
    if (wid === id) await api.storage.local.remove(WIN_ID_KEY);
  });
}
