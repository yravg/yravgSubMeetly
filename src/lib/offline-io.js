// Shared offline media staging (OPFS) — chunked so multi-GB files work in Chrome.

export const OFFLINE_INPUT_NAME = 'offline-input';
export const CHUNK_BYTES = 8 * 1024 * 1024;
// Chrome/V8 cannot allocate ArrayBuffers >= ~2 GiB; stay under that for browser decode.
export const BROWSER_MAX_BYTES = 1536 * 1024 * 1024;

export function needsNativeFilePath(size) {
  return size >= BROWSER_MAX_BYTES;
}

async function opfsRoot() {
  return navigator.storage.getDirectory();
}

export async function getOfflineInputFile() {
  const root = await opfsRoot();
  const fh = await root.getFileHandle(OFFLINE_INPUT_NAME);
  return fh.getFile();
}

/** Stream a user-picked File into OPFS without loading it all into RAM. */
export async function stageFileToOpfs(file, onProgress) {
  const root = await opfsRoot();
  const fh = await root.getFileHandle(OFFLINE_INPUT_NAME, { create: true });
  const w = await fh.createWritable({ keepExistingData: false });
  try {
    const reader = file.stream().getReader();
    let loaded = 0;
    const total = file.size;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await w.write(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
  } finally {
    await w.close();
  }
}

export async function readOfflineInputBytes() {
  const file = await getOfflineInputFile();
  return file.arrayBuffer();
}
