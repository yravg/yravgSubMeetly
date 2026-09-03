// Generates simple solid-gradient PNG icons without any image library.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'icons'), { recursive: true });

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePNG(size) {
  // rounded-square indigo gradient with a lighter "subtitle bar" near the bottom
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r0 = Math.max(2, Math.round(size * 0.22));
  const barTop = Math.round(size * 0.62);
  const barBot = Math.round(size * 0.82);
  const barL = Math.round(size * 0.18);
  const barR = Math.round(size * 0.82);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      // rounded corner mask
      const dx = Math.max(r0 - x, x - (size - 1 - r0), 0);
      const dy = Math.max(r0 - y, y - (size - 1 - r0), 0);
      const inside = dx * dx + dy * dy <= r0 * r0;
      if (!inside) {
        raw[i + 3] = 0;
        continue;
      }
      const g = y / size;
      let R = Math.round(0x4f + (0x7c - 0x4f) * (1 - g));
      let G = Math.round(0x5f + (0x8c - 0x5f) * (1 - g));
      let B = Math.round(0xd7 + (0xf8 - 0xd7) * (1 - g));
      if (y >= barTop && y <= barBot && x >= barL && x <= barR) {
        R = 0xf2;
        G = 0xf4;
        B = 0xff;
      }
      raw[i] = R;
      raw[i + 1] = G;
      raw[i + 2] = B;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [16, 48, 128]) {
  writeFileSync(path.join(root, 'icons', `icon${s}.png`), makePNG(s));
}
console.log('icons generated');
