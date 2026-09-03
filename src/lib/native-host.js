// Chrome Native Messaging bridge — lets the extension start/stop the helper
// without opening a terminal. Install once:  cd native && ./install-host.sh
export const NATIVE_HOST_NAME = 'com.localtranssub.helper';

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
