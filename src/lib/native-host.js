// Chrome Native Messaging bridge — lets the extension start/stop the helper
// without opening a terminal. Install once:  cd native && ./install-host.sh
import { classifyNativeHostError, hostInstalledFromState } from './native-protocol.js';

export const NATIVE_HOST_NAME = 'com.localtranssub.helper';

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
  const base = { host: NATIVE_HOST_NAME, info: null, helperPortOpen: null, error: null };
  if (!nativeHostSupported()) {
    return { ...base, state: 'unsupported', connected: false, hostInstalled: null };
  }
  try {
    const res = await nativeHostAction('ping', { timeoutMs });
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

export function nativeHostAction(action, { timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!nativeHostSupported()) {
      reject(new Error('Native messaging is not available in this browser'));
      return;
    }
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
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
