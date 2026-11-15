# yravgSubMeetly website and Kasi

The public landing page for yravgSubMeetly and the brand sheet for its mascot, **Kasi** (a tarsier from Sulawesi). Static files, no build step.

| File | What it is |
| --- | --- |
| `index.html`, `style.css`, `main.js` | The landing page: hero, live pill demo, Meet Kasi, features, privacy, customisation, what's new, downloads, questions |
| `i18n.js` | Every string in English and Indonesian (`data-i18n` keys) |
| `kasi.js` | Kasi, drawn from parameters: `Kasi.svg({ pose, yaw, lids, gaze, earAngle, ... })` and `Kasi.icon(size)` |
| `brand/index.html` | Brand sheet: marks, size ladder, model sheet, expressions, poses, colours, type, rules, motion |
| `brand/export.cjs` | Writes `assets/kasi/*.svg` and `assets/icon.svg` from `kasi.js` |
| `assets/` | Exported SVGs (do not edit by hand; change `kasi.js` and re-export) |

Design decisions are in `../DESIGN.md`; product facts the copy relies on are in `../PRODUCT.md`.

## Preview

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8080 --directory site
```

Then open http://localhost:8080 and http://localhost:8080/brand/.

## Re-export Kasi after a change

```bash
node site/brand/export.cjs
```

## Live data

The page asks the GitHub releases API for the latest version, installer sizes and links. Without network it keeps the built-in values (v1.4.5) and links to the releases page. The installer download count appears in the hero only from 500 (`MIN_COUNT` in `main.js`).

## Publishing

Not published yet. GitHub Pages can serve this folder (Settings › Pages, or a workflow that uploads `site/`); that makes it public at `https://yravg.github.io/yravgSubMeetly/`.
