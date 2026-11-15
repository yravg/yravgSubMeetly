// Builds yravgSubMeetly's brand icon set and the social share image from site/kasi.js.
// Run from anywhere: node site/brand/icons/build.cjs
//
// Writes, under site/brand/icons/:
//   png/yravgSubMeetly-<size>.png    16 ... 1024, full bleed (16-32 use the small-size variant)
//   svg/icon.svg, svg/icon-small-<size>.svg   the vector sources of those PNGs
//   compare/full-<size>.png           Kasi.icon() itself at 16-32, kept to show why the variant exists
//   yravgSubMeetly.ico                Windows: 16, 24, 32, 48, 64, 256 (PNG-compressed entries)
//   yravgSubMeetly.iconset/ + .icns   macOS, on Apple's icon grid (824 of 1024, soft shadow)
//   before/                           the current app icons, for the side-by-side
//   index.html                        preview page
// and site/assets/og.png (1200x630) from site/brand/og.html.
//
// Needs headless Chrome through puppeteer (PUPPETEER_DIR, or `puppeteer` on the module path, or the
// wt-mac-release copy) and, for the .icns, macOS `iconutil`. The og image loads Gabarito and Figtree
// from Google Fonts; the build stops if they did not load.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = __dirname;
const SITE = path.resolve(OUT, '..', '..');
const REPO = path.resolve(SITE, '..');
const OG_HTML = path.join(SITE, 'brand', 'og.html');
const OG_PNG = path.join(SITE, 'assets', 'og.png');

require(path.join(SITE, 'kasi.js'));
const K = globalThis.Kasi;
const C = K.colors;

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];
const SMALL_MAX = 32;                       // at and below this the small-size variant is used
const ICO_SIZES = [16, 24, 32, 48, 64, 256];
const ICONSET = [['icon_16x16', 16], ['icon_16x16@2x', 32], ['icon_32x32', 32], ['icon_32x32@2x', 64],
  ['icon_128x128', 128], ['icon_128x128@2x', 256], ['icon_256x256', 256], ['icon_256x256@2x', 512],
  ['icon_512x512', 512], ['icon_512x512@2x', 1024]];
const SQUIRCLE = 'M512 0C860 0 1024 164 1024 512S860 1024 512 1024 0 860 0 512 164 0 512 0Z';

function loadPuppeteer() {
  const tries = [process.env.PUPPETEER_DIR, 'puppeteer', require('path').join(__dirname, '..', '..', '..', 'node_modules', 'puppeteer')];
  for (const t of tries) { if (!t) continue; try { return require(t); } catch (_) { /* next */ } }
  throw new Error('puppeteer not found: set PUPPETEER_DIR to a puppeteer install');
}

const inner = (svgStr) => svgStr.replace(/^<svg[^>]*>|<\/svg>$/g, '');
// Replace and insist that the pattern matched, so a change in kasi.js fails the build instead of
// silently drawing a different icon.
function must(str, re, rep, what) {
  const out = str.replace(re, rep);
  if (out === str) throw new Error(`small icon: kasi.js no longer has the ${what} this build edits`);
  return out;
}

/* ---------- the app icon, full: Kasi.icon() unchanged ---------- */
const fullSvg = (size) => K.icon(size);

/* ---------- the small-size variant (16-32 px) ----------
   Kasi.icon() at 16-24 px blurs: the mark's eyes touch, so they merge into one dark band; the hands
   become caramel smudges on a 1-2 px yellow line. Here: the same mark head, larger (scale 4.6 vs 3.55),
   shorter ears so the face gets the room, eyes a little smaller and further apart so a cream gap
   survives between them, bigger catch-lights, no ear ridges, no second catch-light, no hands. The
   caption bar is thicker and its edges sit on whole pixels at each size; Kasi peeks over it. */
function smallSvg(size, uid = 's' + size) {
  const S = 4.6, TOP = 50;                  // head scale; top of the head's bounding box (of 1024)
  let head = inner(K.svg({ pose: 'mark', mouth: 'none', eyeX: 35, earLen: 60, uid }));
  head = must(head, /<path [^>]*stroke="#A0653A"[^>]*\/>/g, '', 'ear ridge strokes');
  head = must(head, /<circle [^>]*opacity="\.85"\/>/g, '', 'second catch-light');
  head = must(head, /rx="32" ry="32"/g, 'rx="28" ry="28"', 'mark eye radius 32');
  head = must(head, /<ellipse cx="([-\d.]+)" cy="([-\d.]+)" rx="([\d.]+)" ry="([\d.]+)" fill="#FFFFFF"\/>/g,
    (m, cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${(rx * 1.45).toFixed(2)}" ry="${(ry * 1.45).toFixed(2)}" fill="#FFFFFF"/>`,
    'catch-light');
  const cy = TOP + 118.5 * S;               // 118.5 = distance from the mark's top to its centre
  const u = 1024 / size;                    // viewBox units per pixel
  const bh = Math.max(3, Math.round(size * 0.17)), bm = Math.round(size * 0.11), side = Math.round(size * 0.14);
  const bar = { x: side * u, y: (size - bm - bh) * u, w: (size - 2 * side) * u, h: bh * u };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}" role="img" aria-label="yravgSubMeetly">` +
    // one-pixel warm rim so the tile reads on dark taskbars (matches Kasi.icon)
    `<path d="${SQUIRCLE}" fill="#4A3526"/>` +
    `<path d="${SQUIRCLE}" transform="translate(512 512) scale(${f2((1024 - 2 * u) / 1024)}) translate(-512 -512)" fill="${C.ink}"/>` +
    `<g transform="translate(512 ${cy}) scale(${S})">${head}</g>` +
    `<rect x="${f2(bar.x)}" y="${f2(bar.y)}" width="${f2(bar.w)}" height="${f2(bar.h)}" rx="${f2(bar.h / 2)}" fill="${C.accent}"/>` +
    `</svg>`;
}
const f2 = (n) => Math.round(n * 100) / 100;
const appSvg = (size) => (size <= SMALL_MAX ? smallSvg(size) : fullSvg(size));

/* ---------- macOS: the same art on Apple's icon grid ----------
   The tile is 824 of 1024 (as island/tools/make_mac_icon.py already does), snapped to whole pixels,
   with the shadow Apple's template draws from 64 px up. */
function macSvg(size) {
  const pad = Math.round(size * 100 / 1024), tile = size - 2 * pad;
  const art = appSvg(tile).replace(/ width="\d+" height="\d+"/, ` x="${pad}" y="${pad}" width="${tile}" height="${tile}"`);
  const shadow = size >= 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    (shadow ? `<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${f2(size * 10 / 1024)}" stdDeviation="${f2(size * 12 / 1024)}" flood-color="#000" flood-opacity=".28"/></filter></defs>` : '') +
    `<g${shadow ? ' filter="url(#sh)"' : ''}>${art}</g></svg>`;
}

/* ---------- files ---------- */
const mk = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };
const rel = (p) => path.relative(REPO, p);
function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// ICO with PNG-compressed entries (Windows Vista and later read these at every size).
function writeIco(entries, out) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach((e, i) => {
    const p = 6 + 16 * i, d = e.size >= 256 ? 0 : e.size;
    head.writeUInt8(d, p); head.writeUInt8(d, p + 1); head.writeUInt8(0, p + 2); head.writeUInt8(0, p + 3);
    head.writeUInt16LE(1, p + 4); head.writeUInt16LE(32, p + 6);
    head.writeUInt32LE(e.buf.length, p + 8); head.writeUInt32LE(off, p + 12);
    off += e.buf.length;
  });
  fs.writeFileSync(out, Buffer.concat([head, ...entries.map((e) => e.buf)]));
}
function readIco(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) throw new Error(`${file}: not an ICO`);
  const n = b.readUInt16LE(4), list = [];
  for (let i = 0; i < n; i++) {
    const p = 6 + 16 * i, w = b.readUInt8(p) || 256, h = b.readUInt8(p + 1) || 256;
    const len = b.readUInt32LE(p + 8), off = b.readUInt32LE(p + 12), data = b.subarray(off, off + len);
    const isPng = data.readUInt32BE(0) === 0x89504e47;
    list.push({ w, h, bits: b.readUInt16LE(p + 6), isPng, png: isPng ? pngSize(data) : null, data });
  }
  return list;
}

async function main() {
  const t0 = Date.now();
  const puppeteer = loadPuppeteer();
  const dirs = { png: mk(path.join(OUT, 'png')), svg: mk(path.join(OUT, 'svg')), cmp: mk(path.join(OUT, 'compare')), before: mk(path.join(OUT, 'before')) };
  const iconset = path.join(OUT, 'yravgSubMeetly.iconset');
  fs.rmSync(iconset, { recursive: true, force: true }); mk(iconset);

  // vector sources
  fs.writeFileSync(path.join(dirs.svg, 'icon.svg'), fullSvg(1024).replace(/ width="1024" height="1024"/, '') + '\n');
  for (const s of SIZES.filter((s) => s <= SMALL_MAX)) fs.writeFileSync(path.join(dirs.svg, `icon-small-${s}.svg`), smallSvg(s) + '\n');

  const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  async function raster(svg, size, out) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    const [w, h] = pngSize(fs.readFileSync(out));
    if (w !== size || h !== size) throw new Error(`${out}: ${w}x${h}, expected ${size}`);
  }

  // 1. app icon PNGs
  for (const s of SIZES) await raster(appSvg(s), s, path.join(dirs.png, `yravgSubMeetly-${s}.png`));
  for (const s of SIZES.filter((s) => s <= SMALL_MAX)) await raster(fullSvg(s), s, path.join(dirs.cmp, `full-${s}.png`));
  console.log(`png: ${SIZES.join(', ')} (small variant at ${SIZES.filter((s) => s <= SMALL_MAX).join(', ')})`);

  // 2a. Windows .ico
  const ico = path.join(OUT, 'yravgSubMeetly.ico');
  writeIco(ICO_SIZES.map((size) => ({ size, buf: fs.readFileSync(path.join(dirs.png, `yravgSubMeetly-${size}.png`)) })), ico);
  const back = readIco(ico);
  const got = back.map((e) => `${e.w}${e.png[0] === e.w && e.png[1] === e.h ? '' : '(MISMATCH ' + e.png + ')'}`);
  if (back.length !== ICO_SIZES.length || back.some((e, i) => e.w !== ICO_SIZES[i] || e.png[0] !== e.w || e.png[1] !== e.h)) throw new Error(`ico read-back: ${got}`);
  console.log(`ico: ${got.join(', ')} | ${execFileSync('file', ['-b', ico]).toString().trim().slice(0, 90)}...`);

  // 2b. macOS .icns
  for (const [name, s] of ICONSET) await raster(macSvg(s), s, path.join(iconset, `${name}.png`));
  const icns = path.join(OUT, 'yravgSubMeetly.icns');
  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-icns-'));
    const round = path.join(tmp, 'back.iconset');
    execFileSync('iconutil', ['-c', 'iconset', icns, '-o', round]);
    const sizes = ICONSET.map(([name, s]) => {
      const [w, h] = pngSize(fs.readFileSync(path.join(round, `${name}.png`)));
      if (w !== s || h !== s) throw new Error(`icns read-back ${name}: ${w}x${h}`);
      return `${name.replace('icon_', '')}=${w}`;
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`icns: ${execFileSync('file', ['-b', icns]).toString().trim()} | read back ${sizes.join(' ')}`);
  } else console.log('icns: skipped (iconutil is macOS only); the .iconset is written');

  // before: the current app icons
  const winBefore = path.join(REPO, 'island', 'installer', 'art', 'yravgsubmeetly.ico');
  if (fs.existsSync(winBefore)) for (const e of readIco(winBefore)) if (e.isPng) fs.writeFileSync(path.join(dirs.before, `windows-${e.w}.png`), e.data);
  const macBefore = [path.join(REPO, 'island', 'build', 'yravgSubMeetly.icns'), '/Applications/yravgSubMeetly.app/Contents/Resources/yravgSubMeetly.icns'].find((p) => fs.existsSync(p));
  if (macBefore && process.platform === 'darwin') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-before-'));
    execFileSync('iconutil', ['-c', 'iconset', macBefore, '-o', path.join(tmp, 'b.iconset')]);
    for (const [name, s] of ICONSET.filter(([n]) => !n.includes('@2x'))) {
      const src = path.join(tmp, 'b.iconset', `${name}.png`);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dirs.before, `mac-${s}.png`));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const beforeFiles = fs.readdirSync(dirs.before).filter((f) => f.endsWith('.png')).sort();
  console.log(`before: ${beforeFiles.join(', ') || 'none found'}${macBefore ? ' (mac from ' + macBefore + ')' : ''}`);

  // 3. social share image
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto('file://' + OG_HTML, { waitUntil: 'networkidle0', timeout: 45000 });
  await page.waitForFunction('document.body.dataset.ready === "1"', { timeout: 20000 });
  const fonts = await page.evaluate(() => ({
    display: document.fonts.check('900 80px Gabarito'), body: document.fonts.check('600 20px Figtree'),
    overflow: [...document.querySelectorAll('[data-fit]')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.className)
  }));
  if (!fonts.display || !fonts.body) throw new Error(`og: web fonts did not load (Gabarito ${fonts.display}, Figtree ${fonts.body})`);
  if (fonts.overflow.length) throw new Error(`og: text overflows ${fonts.overflow.join(', ')}`);
  await page.screenshot({ path: OG_PNG, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  const og = pngSize(fs.readFileSync(OG_PNG));
  if (og[0] !== 1200 || og[1] !== 630) throw new Error(`og.png is ${og}`);
  console.log(`og: ${rel(OG_PNG)} ${og.join('x')}`);

  // 4. preview page
  fs.writeFileSync(path.join(OUT, 'index.html'), previewHtml(beforeFiles));
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(OUT, 'index.html'), { waitUntil: 'networkidle0', timeout: 45000 });
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src')));
  if (broken.length) throw new Error(`index.html: broken images ${broken.join(', ')}`);
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log(`preview: ${rel(path.join(OUT, 'index.html'))}`);

  await browser.close();
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

/* ---------- preview page ---------- */
function previewHtml(before) {
  const has = (f) => before.includes(f);
  const img = (src, px, alt, extra = '') => `<img src="${src}" width="${px}" height="${px}" alt="${alt}"${extra}>`;
  const ladder = SIZES.filter((s) => s <= 256).map((s) => `<figure>${img(`png/yravgSubMeetly-${s}.png`, s, `${s} px`)}<figcaption>${s}${s <= SMALL_MAX ? '<i>small</i>' : ''}</figcaption></figure>`).join('');
  const big = [512, 1024].map((s) => `<figure>${img(`png/yravgSubMeetly-${s}.png`, 256, `${s} px`)}<figcaption>${s} <i>at 256</i></figcaption></figure>`).join('');
  const ba = [16, 24, 32, 48, 256].map((s) => {
    const shown = s === 256 ? 128 : s;
    const cell = (f, label) => `<div class="ba-cell">${f ? img(f, shown, label) : '<span class="na">none</span>'}</div>`;
    return `<div class="ba-row"><b>${s}</b>${cell(has(`windows-${s}.png`) && `before/windows-${s}.png`, 'Windows before')}${cell(has(`mac-${s}.png`) && `before/mac-${s}.png`, 'Mac before')}${cell(`png/yravgSubMeetly-${s}.png`, 'new')}</div>`;
  }).join('');
  const zoom = SIZES.filter((s) => s <= SMALL_MAX).map((s) => `<div class="zoom"><div>${img(`compare/full-${s}.png`, s * 5, `Kasi.icon at ${s}`, ' class="px"')}<span>Kasi.icon() · ${s}</span></div><div>${img(`png/yravgSubMeetly-${s}.png`, s * 5, `small variant at ${s}`, ' class="px"')}<span>small variant · ${s}</span></div></div>`).join('');
  const mac = [['icon_512x512@2x', 1024, 256], ['icon_128x128', 128, 128], ['icon_32x32', 32, 32], ['icon_16x16', 16, 16]]
    .map(([n, s, shown]) => `<figure>${img(`yravgSubMeetly.iconset/${n}.png`, shown, n)}<figcaption>${s}${s !== shown ? ` <i>at ${shown}</i>` : ''}</figcaption></figure>`).join('');
  const panel = (cls, title) => `<div class="panel ${cls}"><h3>${title}</h3><div class="ladder">${ladder}</div><div class="ladder">${big}</div></div>`;
  const baPanel = (cls, title) => `<div class="panel ${cls}"><h3>${title}</h3><div class="ba-row head"><b></b><span>Windows now</span><span>Mac now</span><span>New</span></div>${ba}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>App icon review</title>
<!-- Generated by build.cjs in this folder. Edit the build script, not this file. -->
<link rel="icon" href="png/yravgSubMeetly-32.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gabarito:wght@700;800;900&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --bg: #0C0B09; --bg-2: #15130F; --line: #2B2721; --text: #F6F1E8; --text-2: #C2B8A9; --text-3: #978D7F; --yellow: #FFD23F; --light: #F6F3EE; --light-line: #E2DCD2; --light-text: #2A2117; --light-text-3: #6B5A49; color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 400 16px/1.55 'Figtree', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  main { width: min(1180px, 100% - 32px); margin: 0 auto; padding: 56px 0 80px; }
  h1, h2, h3 { font-family: 'Gabarito', 'Figtree', sans-serif; margin: 0; letter-spacing: -0.03em; text-wrap: balance; }
  h1 { font-size: clamp(2.2rem, 5vw, 3.4rem); font-weight: 900; line-height: 1; }
  h2 { font-size: 1.7rem; font-weight: 800; margin: 64px 0 8px; }
  h3 { font-size: 1rem; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 18px; }
  p { margin: 0; color: var(--text-2); max-width: 70ch; }
  p + p { margin-top: 10px; }
  a { color: var(--yellow); text-underline-offset: 3px; }
  code { font: 500 .88em ui-monospace, 'SF Mono', Menlo, monospace; color: var(--text); }
  .lead { margin-top: 14px; font-size: 1.08rem; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
  .panel { border-radius: 22px; padding: 22px; background: var(--bg); box-shadow: inset 0 0 0 1px var(--line); min-width: 0; }
  .panel.light { background: var(--light); color: var(--light-text); box-shadow: none; }
  .panel.light figcaption, .panel.light .ba-row span, .panel.light .ba-row b, .panel.light .na { color: var(--light-text-3); }
  .ladder { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 18px 20px; }
  .ladder + .ladder { margin-top: 22px; }
  figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  figcaption { font-size: .8rem; color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
  figcaption i { font-style: normal; color: var(--yellow); margin-left: 4px; }
  .panel.light figcaption i { color: #8A6A00; }
  img { display: block; max-width: 100%; height: auto; }
  .ba-row { display: grid; grid-template-columns: 44px repeat(3, minmax(0, 1fr)); align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
  .panel.light .ba-row { border-color: var(--light-line); }
  .ba-row.head { border: 0; padding-top: 0; font-size: .82rem; }
  .ba-row b { font-weight: 600; font-size: .85rem; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .ba-row span { color: var(--text-3); }
  .ba-cell { display: flex; justify-content: flex-start; }
  .na { font-size: .8rem; color: var(--text-3); }
  .zooms { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr)); gap: 16px; margin-top: 20px; }
  .zoom { display: flex; flex-wrap: wrap; gap: 14px; padding: 16px; border-radius: 18px; background: #3A352E; }
  .zoom > div { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .zoom span { font-size: .78rem; color: #E6DED2; }
  .px { image-rendering: pixelated; }
  .og { margin-top: 20px; border-radius: 18px; overflow: hidden; box-shadow: 0 0 0 1px var(--line); width: 100%; }
  .files { margin: 16px 0 0; padding-left: 20px; color: var(--text-2); display: grid; gap: 6px; }
  @media (max-width: 820px) { .pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <h1>yravgSubMeetly app icon</h1>
  <p class="lead">Kasi's head on an ink squircle, holding a subtitle-yellow caption bar. Drawn by <code>Kasi.icon()</code> in <code>site/kasi.js</code>; every file here comes from <code>build.cjs</code>. For review only: nothing is wired into the app yet.</p>

  <h2>Every size</h2>
  <p>PNGs at their real pixel size (512 and 1024 shown at 256). Sizes marked <i style="font-style:normal;color:var(--yellow)">small</i> use the small-size variant.</p>
  <div class="pair">${panel('dark', 'On dark')}${panel('light', 'On light')}</div>

  <h2>Before and after</h2>
  <p>The current icons: Windows from <code>island/installer/art/yravgsubmeetly.ico</code>, Mac from the installed app's <code>.icns</code>${has('mac-16.png') ? '' : ' (not found on this machine)'}. The 256 row is shown at 128.</p>
  <div class="pair">${baPanel('dark', 'On dark')}${baPanel('light', 'On light')}</div>

  <h2>Why 16 to 32 px use a variant</h2>
  <p>Left: <code>Kasi.icon()</code> scaled down. Right: the small variant. Both 5&times; with hard pixels. At 16 to 24 px the full icon's eyes, which touch in the mark, merge into one dark band, and the hands turn into smudges on a 1 to 2 px yellow line.</p>
  <p>The variant keeps the same mark head but draws it larger, with shorter ears, eyes slightly smaller and further apart so a cream gap survives, bigger catch-lights, and no ear ridges or hands. The caption bar is thicker and its edges land on whole pixels; Kasi peeks over it. From 40 px up the full icon holds, so it is used as drawn.</p>
  <div class="zooms">${zoom}</div>

  <h2>macOS (.icns)</h2>
  <p>Same art on Apple's icon grid: the tile is 824 of 1024 with a soft shadow from 64 px, like the current Mac icon, so it sits at the same size as other apps in the Dock. 16 and 32 px use the small variant.</p>
  <div class="pair"><div class="panel dark"><div class="ladder">${mac}</div></div><div class="panel light"><div class="ladder">${mac}</div></div></div>

  <h2>Social share image</h2>
  <p>1200&times;630, from <code>site/brand/og.html</code>. Sample caption text, as on the page's demo.</p>
  <img class="og" src="../../assets/og.png" width="1200" height="630" alt="Kasi hanging under the pill with a live caption, next to the headline Every word, right where you look.">

  <h2>Files</h2>
  <ul class="files">
    <li><a href="yravgSubMeetly.ico">yravgSubMeetly.ico</a>: ${ICO_SIZES.join(', ')} px, PNG entries</li>
    <li><a href="yravgSubMeetly.icns">yravgSubMeetly.icns</a> and <code>yravgSubMeetly.iconset/</code></li>
    <li><code>png/yravgSubMeetly-&lt;size&gt;.png</code>: ${SIZES.join(', ')}</li>
    <li><code>svg/icon.svg</code>, <code>svg/icon-small-&lt;size&gt;.svg</code></li>
    <li><a href="../../assets/og.png">assets/og.png</a> from <a href="../og.html">brand/og.html</a></li>
  </ul>
</main>
</body>
</html>
`;
}

main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
