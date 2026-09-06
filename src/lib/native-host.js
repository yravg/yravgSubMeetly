// Chrome Native Messaging bridge — lets the extension start/stop the helper
// without opening a terminal. Install once:  cd native && ./install-host.sh
import { classifyNativeHostError, hostInstalledFromState } from './native-protocol.js';

export const NATIVE_HOST_NAME = 'com.yraveragesubmin.helper';
/**
 * Nama host sebelum produk berganti nama. Manifest Native Messaging tersimpan
 * di mesin pengguna dengan nama berkas ini; sampai mereka menjalankan ulang
 * installer, satu-satunya host yang ada adalah yang lama. Mencoba nama baru
 * lalu mundur ke sini membuat pemasangan lama tetap bekerja.
 */
export const LEGACY_NATIVE_HOST_NAME = 'com.localtranssub.helper';

/** Nama host yang terbukti menjawab, supaya percobaan ganda hanya sekali. */
let resolvedHost = null;

/** Host yang benar-benar dipakai sejauh ini (null = belum pernah tersambung). */
export function activeNativeHostName() {
  return resolvedHost;
}

/**
 * Pemeriksaan sambungan: apakah bridge Native Messaging benar-benar terhubung?
 *
 * Sebelum ini status host hanya tersimpul sebagai efek samping dari aksi
 * 'start' — mahal (bisa mengunduh model) dan tidak pernah jalan kalau pengguna
 * tak menekan Start, sehingga diagnostik selalu "unknown". `ping` dijawab host
 * seketika tanpa menyentuh helper HTTP, jadi aman dipanggil saat panel dibuka.
 *
 * Selalu resolve — pemanggil membaca `state`, tidak perlu try/catch.
 *
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{state: string, connected: boolean, hostInstalled: boolean|null,
 *   host: string, info: object|null, helperPortOpen: boolean|null, error: string|null}>}
 */
export async function nativeHostConnection({ timeoutMs = 4_000 } = {}) {
  const base = { host: resolvedHost || NATIVE_HOST_NAME, info: null, helperPortOpen: null, error: null };
  if (!nativeHostSupported()) {
    return { ...base, state: 'unsupported', connected: false, hostInstalled: null };
  }
  try {
    const res = await nativeHostAction('ping', { timeoutMs });
    base.host = resolvedHost || NATIVE_HOST_NAME;
    // Host lama belum mengenal 'ping' dan menjawab unknown action — itu tetap
    // membuktikan bridge-nya hidup, jadi tetap 'connected'.
    const stale = res?.ok === false && /unknown action/i.test(String(res?.error || ''));
    return {
      ...base,
      state: 'connected',
      connected: true,
      hostInstalled: true,
      info: res?.host || null,
      helperPortOpen: typeof res?.helper_port_open === 'boolean' ? res.helper_port_open : null,
      error: stale ? 'host lama: aksi ping belum didukung' : null,
    };
  } catch (e) {
    const state = classifyNativeHostError(e);
    return { ...base, state, connected: false, hostInstalled: hostInstalledFromState(state), error: String(e?.message || e) };
  }
}

export function nativeHostSupported() {
  return typeof chrome?.runtime?.connectNative === 'function';
}

/**
 * Coba satu nama host. Dipisah supaya nativeHostAction bisa mundur ke nama
 * lama tanpa menduplikasi seluruh pengurusan port dan timeout.
 */
function connectOnce(hostName, action, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };
    let port;
    try {
      port = chrome.runtime.connectNative(hostName);
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      try {
        port.disconnect();
      } catch {}
      finish(reject, new Error('Native host timed out'));
    }, timeoutMs);
    port.onMessage.addListener((msg) => {
      try {
        port.disconnect();
      } catch {}
      finish(resolve, msg);
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      const err = chrome.runtime.lastError?.message;
      finish(reject, new Error(err || 'Native host disconnected'));
    });
    port.postMessage({ action });
  });
}

export async function nativeHostAction(action, { timeoutMs = 45_000 } = {}) {
  if (!nativeHostSupported()) {
    throw new Error('Native messaging is not available in this browser');
  }
  const order = resolvedHost ? [resolvedHost] : [NATIVE_HOST_NAME, LEGACY_NATIVE_HOST_NAME];
  let lastErr;
  for (const hostName of order) {
    try {
      const res = await connectOnce(hostName, action, timeoutMs);
      resolvedHost = hostName;
      return res;
    } catch (e) {
      lastErr = e;
      // Hanya "host tidak ditemukan" yang layak dicoba dengan nama lain.
      // Forbidden, crash, atau timeout berarti hostnya ADA — mencoba nama
      // lain cuma menutupi galat sebenarnya.
      if (classifyNativeHostError(e) !== 'not-installed') throw e;
    }
  }
  throw lastErr;
}
