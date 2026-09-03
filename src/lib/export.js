// Export helpers — optional save folder via File System Access API.

let dirHandle = null;

export async function loadExportDir() {
  try {
    const db = await openDb();
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get('exportDir');
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
  const tx = db.transaction('handles', 'readwrite');
  tx.objectStore('handles').put(dirHandle, 'exportDir');
  return dirHandle.name;
}

export async function clearExportDir() {
  dirHandle = null;
  try {
    const db = await openDb();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('exportDir');
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

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('local-transsub', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
