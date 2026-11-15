// Writes Kasi's poses, the mark and the app icon as standalone SVG files from kasi.js.
// Run from site/: node brand/export.cjs
const fs = require('fs'), path = require('path');
require(path.join(__dirname, '..', 'kasi.js'));
const K = globalThis.Kasi;
const out = (p, s) => { fs.writeFileSync(path.join(__dirname, '..', p), s + '\n'); console.log('wrote', p); };
let n = 0;
const fixed = (o) => K.svg(Object.assign({ uid: 'k' + (n++) }, o));
const poses = {
  head: {}, mark: { pose: 'mark' }, listen: { pose: 'listen' }, happy: { pose: 'happy' }, think: { pose: 'think' },
  doze: { pose: 'doze' }, worry: { pose: 'worry' }, turn: { yaw: 0.75 }, back: { back: true },
  hang: { pose: 'hang' }, write: { pose: 'write' }, hush: { pose: 'hush' }, sit: { pose: 'sit' }
};
for (const [name, o] of Object.entries(poses)) out(`assets/kasi/kasi-${name}.svg`, fixed(o));
out('assets/icon.svg', K.icon(1024).replace(/ width="1024" height="1024"/, ''));
