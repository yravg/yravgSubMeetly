/**
 * Kasi in the app window: the one mascot on a screen for the welcome, empty, thinking and done
 * states, and the hero's ask bar at rest. Never on errors: errors get plain words.
 *
 * Each state is an animated sticker (an SMIL SVG that plays on its own in an <img>, no script) and,
 * for people who ask for less motion, the still pose it starts from. Both are exports of
 * site/kasi.js (site/brand/stickers/ and site/assets/kasi/), copied into src/kasi/;
 * test/kasi-art.test.mjs keeps the copies byte for byte equal to their sources.
 */

/** state -> [sticker, still], file names in src/kasi/ without ".svg". */
export const KASI_STATES = Object.freeze({
  // The hero at rest: ready, the pill waiting for sound.
  ready: ['kasi-idle', 'kasi-head'],
  // First run: ears up, ready to hear the first call.
  welcome: ['kasi-listening', 'kasi-listen'],
  // Nothing yet: dozing.
  empty: ['kasi-dozing', 'kasi-doze'],
  // Loading, drafting: looking up, a paw under the chin.
  thinking: ['kasi-thinking', 'kasi-think'],
  // All caught up: got it.
  done: ['kasi-got-it', 'kasi-happy'],
});

/**
 * Where each sticker puts Kasi's head in its 256-unit square: [centre y, scale] (the build's
 * `translate(128 y) scale(s)`; test/kasi-art.test.mjs reads them back from the files). The still
 * poses frame the head tightly (`viewBox="-104 -118 208 190"`).
 */
export const STICKER_HEAD = Object.freeze({
  'kasi-idle': [154.97, 0.93],
  'kasi-listening': [153.11, 0.93],
  'kasi-dozing': [141.02, 0.93],
  'kasi-thinking': [141.02, 0.93],
  'kasi-got-it': [166.13, 0.93],
});
/** The head's width and its chin (the head's lowest point), in kasi.js units. */
const HEAD_W = 208, CHIN = 61, STILL_BOTTOM = 72, STILL_H = 190;

/**
 * How a picture frames the head, so a sticker and a still show the same Kasi at the same size:
 * `zoom` = picture width / head width, `foot` = the empty share of the picture's height under the
 * chin (CSS moves the picture down by it, so the chin rests where the box ends).
 */
export function kasiFrame(file) {
  const head = STICKER_HEAD[file];
  if (!head) return { zoom: 1, foot: (STILL_BOTTOM - CHIN) / STILL_H };
  const [cy, s] = head;
  return { zoom: 256 / (HEAD_W * s), foot: (256 - (cy + CHIN * s)) / 256 };
}

/** Whether the person asked the system for less motion. */
export function prefersReducedMotion(win = globalThis) {
  try { return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** The picture for `state`: the sticker, or its still pose when motion is reduced. */
export function kasiSrc(state, reduce = prefersReducedMotion()) {
  const pair = KASI_STATES[state];
  if (!pair) throw new Error(`no Kasi for state "${state}"`);
  return `kasi/${pair[reduce ? 1 : 0]}.svg`;
}

/**
 * An <img> of Kasi in `state` (decorative: the words beside it say what it means), carrying its
 * frame as `--kasi-zoom` and `--kasi-foot` for app.css.
 */
export function kasiImg(state, cls = '', reduce = prefersReducedMotion()) {
  const src = kasiSrc(state, reduce);
  const { zoom, foot } = kasiFrame(src.slice(5, -4));
  return `<img class="kasi-art${cls ? ` ${cls}` : ''}" src="${src}" alt="" data-kasi="${state}" style="--kasi-zoom:${zoom.toFixed(4)};--kasi-foot:${foot.toFixed(4)}" />`;
}
