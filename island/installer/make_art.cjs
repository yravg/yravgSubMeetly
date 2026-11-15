// The app's own art, in the Kasi brand. Run from anywhere: node island/installer/make_art.cjs
//
// 1. Copies the brand icon set (built by `node site/brand/icons/build.cjs` from site/kasi.js) to
//    where the app takes it from:
//      site/brand/icons/yravgSubMeetly.ico      -> island/installer/art/yravgsubmeetly.ico (Setup)
//                                               -> island/crates/poni/res/poni.ico (the exe, the tray)
//      site/brand/icons/png/yravgSubMeetly-256.png -> island/installer/art/yravgsubmeetly-256.png
//    The Mac .icns is made in the release workflow from site/brand/icons/yravgSubMeetly.iconset.
// 2. Draws Setup's wizard images from site/kasi.js: Kasi hanging under the pill on the warm night
//    ground, the wordmark and one line (wizard.png 164x314 at 100, 150 and 200 %), and the app
//    icon for the inner pages' corner (wizard-small 55, 83, 110).
//
// Needs headless Chrome through puppeteer (PUPPETEER_DIR, or `puppeteer` on the module path, or the
// repo's node_modules). The words load Gabarito and Figtree from Google Fonts; the build stops if
// they did not load. The outputs are committed: run this only to change them.
'use strict';
const fs = require('fs');
const path = require('path');

const ISLAND = path.resolve(__dirname, '..');
const REPO = path.resolve(ISLAND, '..');
const ART = path.join(__dirname, 'art');
const ICONS = path.join(REPO, 'site', 'brand', 'icons');

require(path.join(REPO, 'site', 'kasi.js'));
const K = globalThis.Kasi;
const C = K.colors;
// DESIGN.md tokens: the warm night ground, the pill, text on dark, the muted "yravg".
const GROUND = '#0C0B09', PILL = '#000000', TEXT = '#F6F1E8', MUTED = '#8A7660', YELLOW = C.accent;

function loadPuppeteer() {
  const tries = [process.env.PUPPETEER_DIR, 'puppeteer', path.join(REPO, 'node_modules', 'puppeteer')];
  for (const t of tries) { if (!t) continue; try { return require(t); } catch (_) { /* next */ } }
  throw new Error('puppeteer not found: set PUPPETEER_DIR to a puppeteer install');
}

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function copyIcons() {
  const copies = [
    [path.join(ICONS, 'yravgSubMeetly.ico'), path.join(ART, 'yravgsubmeetly.ico')],
    [path.join(ICONS, 'yravgSubMeetly.ico'), path.join(ISLAND, 'crates', 'poni', 'res', 'poni.ico')],
    [path.join(ICONS, 'png', 'yravgSubMeetly-256.png'), path.join(ART, 'yravgsubmeetly-256.png')],
  ];
  for (const [from, to] of copies) {
    if (!fs.existsSync(from)) throw new Error(`${from} is missing: run node site/brand/icons/build.cjs first`);
    fs.copyFileSync(from, to);
    console.log(`icon: ${path.relative(REPO, from)} -> ${path.relative(REPO, to)}`);
  }
}

// Kasi hangs from the pill's lower edge (kasi.js `hang`, both hands on it). Its own pill is the
// first rect; here it is the island's black with a faint rim and a subtitle-yellow caption in it.
function wizardHtml() {
  let hang = K.svg({ pose: 'hang', pill: true, uid: 'wz' });
  const pillRect = /<rect x="-150" y="-146" width="300" height="50" rx="25" fill="#1B120B"\/>/;
  if (!pillRect.test(hang)) throw new Error('wizard: kasi.js no longer draws the hang pose\'s pill as this script expects');
  hang = hang.replace(pillRect,
    `<rect x="-148" y="-146" width="296" height="50" rx="25" fill="${PILL}" stroke="rgba(255,255,255,.14)" stroke-width="2"/>` +
    `<rect x="-60" y="-125" width="120" height="8" rx="4" fill="${YELLOW}"/>`);
  // The words sit in one column anchored to the bottom, so nothing can land on anything else;
  // the build checks the column fits under Kasi (`data-fit`, `.foot`).
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gabarito:wght@800&family=Figtree:wght@500&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; }
  body { width: 164px; height: 314px; overflow: hidden; background: ${GROUND}; position: relative; }
  .k { position: absolute; left: 50%; top: 6px; width: 132px; transform: translateX(-50%); }
  .k svg { display: block; width: 100%; height: auto; }
  .foot { position: absolute; left: 15px; right: 12px; bottom: 18px; display: flex; flex-direction: column; gap: 7px; }
  .word { font: 800 18.5px/1 Gabarito, sans-serif; letter-spacing: -0.035em; color: ${TEXT}; white-space: nowrap; }
  .word span { color: ${MUTED}; }
  .line { font: 500 10.5px/1.4 Figtree, sans-serif; color: rgba(246,241,232,.66); white-space: nowrap; }
  .bar { width: 22px; height: 3px; border-radius: 2px; background: ${YELLOW}; margin-top: 4px; }
</style></head><body>
<div class="k">${hang}</div>
<div class="foot"><div class="word" data-fit><span>yravg</span>SubMeetly</div>
<div class="line" data-fit>Every word,<br>right where you look.</div>
<div class="bar"></div></div>
</body></html>`;
}

// The inner pages' corner: the app icon on Setup's white header.
function smallHtml(px) {
  const icon = K.icon(Math.round(px * 0.82)).replace(/ width="\d+" height="\d+"/, ` width="${Math.round(px * 0.82)}" height="${Math.round(px * 0.82)}"`);
  return `<!doctype html><html><body style="margin:0;width:${px}px;height:${px}px;background:#FFFFFF;display:grid;place-items:center">${icon}</body></html>`;
}

async function main() {
  copyIcons();
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const check = (out, w, h) => {
    const [gw, gh] = pngSize(fs.readFileSync(out));
    if (gw !== w || gh !== h) throw new Error(`${out}: ${gw}x${gh}, expected ${w}x${h}`);
    console.log(`art: ${path.relative(REPO, out)} ${gw}x${gh}`);
  };

  for (const [scale, tag] of [[1, ''], [1.5, '-150'], [2, '-200']]) {
    await page.setViewport({ width: 164, height: 314, deviceScaleFactor: scale });
    await page.setContent(wizardHtml(), { waitUntil: 'load', timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    const ok = await page.evaluate(() => ({
      display: document.fonts.check('800 18px Gabarito'), body: document.fonts.check('500 10px Figtree'),
      overflow: [...document.querySelectorAll('[data-fit]')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.className),
      // The words' column starts below Kasi's tail.
      gap: document.querySelector('.foot').getBoundingClientRect().top - document.querySelector('.k').getBoundingClientRect().bottom,
    }));
    if (ok.gap < 4) ok.overflow.push(`foot (only ${ok.gap.toFixed(1)} px under Kasi)`);
    if (!ok.display || !ok.body) throw new Error(`wizard: web fonts did not load (Gabarito ${ok.display}, Figtree ${ok.body})`);
    if (ok.overflow.length) throw new Error(`wizard: text overflows ${ok.overflow.join(', ')}`);
    const out = path.join(ART, `wizard${tag}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 164, height: 314 } });
    check(out, Math.round(164 * scale), Math.round(314 * scale));
  }

  for (const px of [55, 83, 110]) {
    await page.setViewport({ width: px, height: px, deviceScaleFactor: 1 });
    await page.setContent(smallHtml(px));
    const out = path.join(ART, `wizard-small-${px}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: px, height: px } });
    check(out, px, px);
  }

  await browser.close();
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
