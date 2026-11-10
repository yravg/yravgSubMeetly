/**
 * Menyimpan berkas ekspor Ask Tide (papan A03, kartu "Done · N rows · Open →").
 *
 *  saveExport({ name, content, mime }, { chrome, doc, url }) → Promise
 *      { ok: true, via: 'downloads', filename, id }  di ekstensi: chrome.downloads.download
 *      { ok: true, via: 'link', filename, id: null } di lab / jendela engine, atau bila izin
 *                                                    "downloads" ditolak: tautan unduh biasa
 *      { ok: false, error }                          download gagal (nama berkas ditolak, dll.)
 *  openExport(id, { chrome }) → boolean   chrome.downloads.show(id): menyorot berkas di folder.
 *
 * Izin `downloads` opsional (manifest.optional_permissions): diminta saat ekspor pertama dari
 * gestur pengguna, jadi pemasang lama tidak melihat ekstensinya dinonaktifkan oleh pembaruan.
 * Halaman web biasa tidak bisa membuka berkas yang diunduhnya, jadi tanpa id tidak ada "Open".
 */
async function hasDownloads(chrome) {
  if (!chrome?.downloads?.download) return false;
  try {
    if (!chrome.permissions?.contains) return true;
    const want = { permissions: ['downloads'] };
    return (await chrome.permissions.contains(want)) || (await chrome.permissions.request(want));
  } catch {
    return false;
  }
}

function viaLink(file, doc, url) {
  const href = url.createObjectURL(new Blob([file.content], { type: `${file.mime};charset=utf-8` }));
  const a = doc.createElement('a');
  a.href = href;
  a.download = file.name;
  doc.body.append(a);
  a.click();
  a.remove();
  const timer = setTimeout(() => url.revokeObjectURL(href), 10_000);
  timer?.unref?.(); // Node: do not hold a test process open
  return { ok: true, via: 'link', filename: file.name, id: null };
}

export async function saveExport(file, { chrome = globalThis.chrome, doc = globalThis.document, url = globalThis.URL } = {}) {
  try {
    if (await hasDownloads(chrome)) {
      const id = await chrome.downloads.download({
        url: `data:${file.mime};charset=utf-8,${encodeURIComponent(file.content)}`,
        filename: file.name,
        saveAs: false,
      });
      return { ok: true, via: 'downloads', filename: file.name, id };
    }
    return viaLink(file, doc, url);
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export function openExport(id, { chrome = globalThis.chrome } = {}) {
  if (id == null || !chrome?.downloads?.show) return false;
  try {
    chrome.downloads.show(id);
    return true;
  } catch {
    return false;
  }
}
