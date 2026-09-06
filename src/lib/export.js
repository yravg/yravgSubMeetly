// Export helpers — optional save folder via File System Access API.

let dirHandle = null;

export async function loadExportDir() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('exportDir');
    const handle = await reqToPromise(req);
    if (handle && (await verifyPermission(handle))) {
      dirHandle = handle;
      return handle.name;
    }
  } catch {}
  return null;
}

export async function pickExportDir() {
  if (!window.showDirectoryPicker) {
    throw new Error('Folder picker not supported in this browser');
  }
  dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await verifyPermission(dirHandle, true);
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(dirHandle, 'exportDir');
  return dirHandle.name;
}

export async function clearExportDir() {
  dirHandle = null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete('exportDir');
  } catch {}
}

export async function saveExportFile(filename, content) {
  if (dirHandle) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    return { saved: true, path: `${dirHandle.name}/${filename}` };
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { saved: false, path: filename };
}

const DB_NAME = 'yraverage-submin';
const LEGACY_DB_NAME = 'local-transsub';
const STORE = 'handles';
let migrated = false;

function openNamed(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Pindahkan handle direktori ekspor dari basis data bernama lama.
 *
 * Isinya satu hal, tapi hal yang tidak bisa dibuat ulang oleh kode: izin
 * folder yang dipilih pengguna lewat File System Access. Tanpa migrasi,
 * mengganti nama basis data berarti diam-diam meminta pengguna memilih
 * folder ekspornya lagi.
 */
async function migrateLegacyDb(db) {
  if (migrated) return;
  migrated = true;
  try {
    const count = await reqToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).count());
    if (count > 0) return;
    // Jangan sampai malah MEMBUAT basis data lama kalau memang tidak ada.
    // Di browser tanpa indexedDB.databases() pemeriksaan ini dilewati; basis
    // data kosong yang telanjur terbuat langsung dihapus lagi di bawah.
    if (typeof indexedDB.databases === 'function') {
      const list = await indexedDB.databases().catch(() => []);
      if (!list.some((d) => d.name === LEGACY_DB_NAME)) return;
    }
    const legacy = await openNamed(LEGACY_DB_NAME);
    const handle = await reqToPromise(
      legacy.transaction(STORE, 'readonly').objectStore(STORE).get('exportDir'),
    );
    if (handle) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, 'exportDir');
      await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
    }
    legacy.close();
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch {
    /* migrasi bersifat usaha terbaik — kegagalannya tidak boleh memblokir ekspor */
  }
}

async function openDb() {
  const db = await openNamed(DB_NAME);
  await migrateLegacyDb(db);
  return db;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function verifyPermission(handle, write = false) {
  const opts = { mode: write ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (write) return (await handle.requestPermission(opts)) === 'granted';
  return false;
}

export function exportDirLabel() {
  return dirHandle?.name || null;
}
