// Manifest for the Chrome Web Store zip: the store assigns its own extension ID, so "key" must not ship.
// The unpacked build (Setup's {app}\extension) keeps "key" so every PC loads it under one fixed ID.
import { createHash } from 'node:crypto';

export function stripKey(manifest) {
  const { key, ...rest } = manifest;
  return rest;
}

/** Extension ID Chrome derives from a manifest "key" (base64 SPKI): sha256, first 16 bytes, hex nibbles to a-p. */
export function extensionIdFromKey(key) {
  const hash = createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
  return [...hash].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');
}
