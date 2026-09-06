/**
 * Registrasi host Native Messaging yang diharapkan ekstensi.
 * Izin `"nativeMessaging"` ada di src/manifest.json; nama host dipakai
 * via chrome.runtime.connectNative (lihat src/lib/native-host.js).
 * Instal host OS: native/install-host.sh | install-host.bat | install-host-linux.sh
 */
export const REGISTERED_NATIVE_HOST = 'com.yraveragesubmin.helper';
export const NATIVE_MESSAGING_PERMISSION = 'nativeMessaging';
