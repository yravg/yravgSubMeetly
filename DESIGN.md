# Design: Kasi by yravg (site and mascot)

The product formerly called yravgSubMeetly is **Kasi by yravg** (renamed 2026-11-15; repo, bundle ids and data folders keep the old name). The app and its mascot share the name.

Scope: the public landing page (`site/index.html`) and the brand sheet (`site/brand/index.html`). The app's own UI keeps its tokens in `src/tokens.css` and palettes in `src/palettes.css`; nothing here changes them.

## World

The product is a black pill at the top edge of the screen, so the page is set at night: a warm near-black ground (`#0C0B09`, not a cool blue-black) where the pill and the captions glow the way they do on a real screen. One accent only: **subtitle yellow** `#FFD23F`, the colour of a film subtitle. It marks the actions (download buttons, chips) and the words being captioned. Kasi brings the second family: caramel fur, cream face plate, amber eye rims.

Style reference: rama2555.github.io/nusa (structure and pacing: big headline, one live demo with state chips, short sections). Deliberately not borrowed: its purple-blue glow, its font (Bricolage Grotesque), its copy, and its eyes-only mascot.

## Type

- Display: **Gabarito** 800–900, tracking −0.035em to −0.04em, `text-wrap: balance`. Hero up to 6rem.
- Body and UI: **Figtree** 400–700, 17px / 1.55, measure ≤ 62ch.
- Numbers in metadata use tabular figures.

## Tokens (in `site/style.css` `:root`)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` / `--bg-2` / `--bg-3` | `#0C0B09` / `#15130F` / `#1D1A15` | ground, raised panels, icon tiles |
| `--line` / `--line-2` | `#2B2721` / `#3B352D` | hairlines, outlines |
| `--text` / `--text-2` / `--text-3` | `#F6F1E8` / `#C2B8A9` / `#978D7F` | text tiers (all ≥ 4.5:1 on `--bg`) |
| `--yellow` / `--on-yellow` | `#FFD23F` / `#1B1505` | accent and text on it |
| `--pill` | `#000` | the island |
| `--ease-out` / `--spring` | `cubic-bezier(.16,1,.3,1)` / `cubic-bezier(.34,1.56,.64,1)` | motion |

## Kasi

Source of truth: `site/kasi.js` (`Kasi.svg(opts)`, `Kasi.icon(size)`); the files in `site/assets/kasi/` and `site/assets/icon.svg` are exports (`node site/brand/export.cjs`). Rules, poses, expressions, size ladder and motion are laid out in `site/brand/index.html`. In short:

- Flat colours only; no outlines, gradients, blush or cat mouth.
- Full head with amber eye rims from 64 px; the **mark** (no rims, bigger eyes) below 64 px and in the 32 px resting pill.
- Kasi hangs under the pill, never sits on it (the pill touches the screen's top edge).
- One Kasi per screen. Kasi never talks. No Kasi on real error states.
- Signature motion: the 180° head turn on each translated line; ears twitch while sound plays; it drops from the pill on a spring when captions start.

## Page structure

Hero (badge, two-line headline, lede, OS-aware download, live version and size) → live demo (a call, the pill at the top of the screen, Kasi hanging under it, seven state chips, auto-advancing) → Meet Kasi (eyes follow the pointer, click to turn) with a six-state strip → features as a two-column hairline list → private (flow with the internet crossed out) → make it yours (draggable tabs, palettes, resting styles) → new in 1.4 → download (Windows, macOS) → questions → footer.

## Data

Version, installer sizes and links come live from the GitHub releases API with a built-in fallback (v1.4.5). The installer download count shows only from 500 (`MIN_COUNT` in `main.js`); `latest.json` fetches by the apps are not counted. Demo call text is sample text and says so.
