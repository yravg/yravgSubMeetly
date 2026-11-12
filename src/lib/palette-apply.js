// The theme the person picked (a palette over the one Tide structure, see scripts/gen-palettes.mjs).
// Kept in localStorage so every page of the same origin (app, side panel, Minutes) agrees, and a change
// in one shows in the others through the 'storage' event.
import { PALETTES } from './palettes.js';

export const PALETTE_KEY = 'ysmPalette';
export const DEFAULT_PALETTE = 'tide';
export const PALETTE_IDS = PALETTES.map((p) => p.id);
/** Names the earlier reskin picker stored, mapped to the palette with the same hue. */
export const LEGACY_PALETTE = { yraverage: 'teal', coretax: 'azure', modern: 'violet' };

export function normalizePalette(v) {
  const id = LEGACY_PALETTE[v] || v;
  return PALETTE_IDS.includes(id) ? id : DEFAULT_PALETTE;
}

export function getPalette() {
  try { return normalizePalette(localStorage.getItem(PALETTE_KEY)); } catch { return DEFAULT_PALETTE; }
}

/** Sets data-palette on <html> (Tide, the default, carries none). */
export function applyPalette(v) {
  const id = normalizePalette(v);
  const root = document.documentElement;
  if (id === DEFAULT_PALETTE) delete root.dataset.palette; else root.dataset.palette = id;
  return id;
}

const PICKED_KEY = 'ysmPaletteSet';

/** True once the person picked a theme on this device (a copy from the helper must not override that). */
export function isPaletteExplicit() {
  try { return localStorage.getItem(PICKED_KEY) === '1'; } catch { return false; }
}

/** Applies and remembers a theme. `explicit` = the person chose it here, as opposed to a copy from elsewhere. */
export function setPalette(v, { explicit = true } = {}) {
  const id = applyPalette(v);
  try {
    localStorage.setItem(PALETTE_KEY, id);
    if (explicit) localStorage.setItem(PICKED_KEY, '1');
  } catch { /* private window */ }
  return id;
}

/** Another page changed the theme: follow it. */
export function watchPalette(onChange) {
  addEventListener('storage', (e) => {
    if (e.key !== PALETTE_KEY) return;
    onChange?.(applyPalette(e.newValue));
  });
}
