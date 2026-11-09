import * as esbuild from 'esbuild';
import { cp, mkdir, rm, copyFile, readdir, watch as fsWatch } from 'node:fs/promises';
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const nm = path.join(root, 'node_modules');
const watch = process.argv.includes('--watch');

function ensureDevServices() {
  const script = path.join(root, 'scripts/ensure-dev-services.sh');
  console.log('[dev] ensuring native helper + lab…');
  const r = spawnSync('bash', [script], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.warn('[dev] WARN: ensure-dev-services failed — run ./scripts/ensure-native.sh');
  }
}

function restartNativeHelper() {
  const script = path.join(root, 'scripts/restart-native.sh');
  console.log('[dev] native code changed — restarting helper…');
  spawn('bash', [script], { cwd: root, stdio: 'inherit' });
}

function watchNativeChanges() {
  const nativeDir = path.join(root, 'native');
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(restartNativeHelper, 800);
  };
  fsWatch(nativeDir, { recursive: true }, (_evt, fname) => {
    if (!fname || !/\.(py|sh)$/.test(fname)) return;
    schedule();
  }).catch((e) => console.warn('[dev] native watch failed:', e.message));
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// ---- static files -------------------------------------------------------
const statics = [
  ['src/manifest.json', 'manifest.json'],
  ['src/offscreen.html', 'offscreen.html'],
  ['src/sidepanel.html', 'sidepanel.html'],
  ['src/tokens.css', 'tokens.css'],
  ['src/sidepanel.css', 'sidepanel.css'],
  ['src/notes-panel.css', 'notes-panel.css'],
  ['src/minutes.html', 'minutes.html'],
  ['src/minutes.css', 'minutes.css'],
  ['src/theme-tide.css', 'theme-tide.css'],
  ['src/app.html', 'app.html'],
  ['src/app.css', 'app.css'],
  ['src/minutes-tide.css', 'minutes-tide.css'],
];
for (const [from, to] of statics) {
  await copyFile(path.join(root, from), path.join(dist, to));
}
await cp(path.join(root, 'icons'), path.join(dist, 'icons'), { recursive: true });
// Fredoka + Plus Jakarta Sans (SIL OFL 1.1) for theme-tide.css, with their licences.
await cp(path.join(root, 'src/fonts'), path.join(dist, 'fonts'), { recursive: true });
// Tide mascot poses + mark (yravgBuds, owner's brand) for the app shell.
await cp(path.join(root, 'src/tide'), path.join(dist, 'tide'), { recursive: true });

// ---- vendor runtime assets (must ship in package: MV3 forbids CDN) ------
// Copy EVERY ort-wasm-simd-threaded* variant (plain/jsep/asyncify/jspi) — the
// runtime picks one at load time depending on backend and browser features.
async function copyOrtRuntime(fromDir, toDir) {
  await mkdir(toDir, { recursive: true });
  for (const f of await readdir(fromDir)) {
    if (f.startsWith('ort-wasm-simd-threaded') && /\.(wasm|mjs)$/.test(f)) {
      await copyFile(path.join(fromDir, f), path.join(toDir, f));
    }
  }
}

// ORT wasm for transformers.js (hoisted onnxruntime-web, version pinned by transformers)
await copyOrtRuntime(path.join(nm, 'onnxruntime-web/dist'), path.join(dist, 'ort'));

// Silero VAD assets + the ORT build vad-web was built against (nested copy)
await mkdir(path.join(dist, 'vad'), { recursive: true });
for (const f of ['silero_vad_v5.onnx', 'silero_vad_legacy.onnx', 'vad.worklet.bundle.min.js']) {
  await copyFile(path.join(nm, '@ricky0123/vad-web/dist', f), path.join(dist, 'vad', f));
}
await copyOrtRuntime(
  path.join(nm, '@ricky0123/vad-web/node_modules/onnxruntime-web/dist'),
  path.join(dist, 'vad/ort'),
);

// ---- bundles ------------------------------------------------------------
const common = {
  bundle: true,
  minify: false,
  sourcemap: false,
  platform: 'browser',
  target: 'chrome120',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

const builds = [
  { entryPoints: ['src/background.js'], outfile: 'dist/background.js', format: 'esm' },
  { entryPoints: ['src/offscreen.js'], outfile: 'dist/offscreen.js', format: 'esm' },
  { entryPoints: ['src/ai-worker.js'], outfile: 'dist/ai-worker.js', format: 'esm' },
  { entryPoints: ['src/sidepanel.js'], outfile: 'dist/sidepanel.js', format: 'esm' },
  { entryPoints: ['src/minutes.js'], outfile: 'dist/minutes.js', format: 'esm' },
  { entryPoints: ['src/app.js'], outfile: 'dist/app.js', format: 'esm' },
  // overlay.css and tokens.css are inlined into the overlay's shadow root as text.
  { entryPoints: ['src/content.js'], outfile: 'dist/content.js', format: 'iife', loader: { '.css': 'text' } },
];

for (const b of builds) {
  const opts = { ...common, ...b };
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
  } else {
    await esbuild.build(opts);
  }
}
console.log(watch ? 'watching…' : 'build complete → dist/');
ensureDevServices();
if (watch) watchNativeChanges();
