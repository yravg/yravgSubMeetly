// Interpreter mode — the shape stored in settings and the rules that keep it
// valid. Two modes:
//   simultaneous : the historical one-way path, srcLang → tgtLang
//   consecutive  : two-way, a ⇄ b, direction picked per utterance
//
// Everything here is pure so both the side panel and the tests can use it.

export const INTERPRETER_MODES = ['simultaneous', 'consecutive'];

/** A language usable as one end of a two-way conversation. */
function usable(code) {
  return typeof code === 'string' && code !== '' && code !== 'auto';
}

/**
 * Read `settings.interpreter` back into a valid record, falling back to the
 * one-way behaviour every existing install already has.
 * @param {object|null} settings  the persisted settings object
 * @param {string} srcLang        current "From (speech)" language
 * @param {string} tgtLang        current "To (translation)" language
 * @returns {{mode: 'simultaneous'|'consecutive', a: string, b: string}}
 */
export function normalizeInterpreter(settings, srcLang = 'ja', tgtLang = 'en') {
  const raw = settings && typeof settings === 'object' ? settings.interpreter : null;
  const mode = raw && raw.mode === 'consecutive' ? 'consecutive' : 'simultaneous';
  const a = usable(raw?.a) ? raw.a : srcLang;
  const b = usable(raw?.b) ? raw.b : tgtLang;
  // A two-way session needs two distinct, concrete languages — anything else
  // degrades to the one-way path rather than producing a broken config.
  if (mode === 'consecutive' && (!usable(a) || !usable(b) || a === b)) {
    return { mode: 'simultaneous', a, b };
  }
  return { mode, a, b };
}

/** True when the given interpreter record drives the two-way pipeline. */
export function isConsecutive(interpreter) {
  return interpreter?.mode === 'consecutive';
}

/** The two translation pairs a consecutive session needs, as `[from, to]`. */
export function interpreterPairs(interpreter) {
  if (!isConsecutive(interpreter)) return [];
  const { a, b } = interpreter;
  return [
    [a, b],
    [b, a],
  ];
}
