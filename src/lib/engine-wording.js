/**
 * The Windows app calls the local program "Engine"; the extension says "Helper" / "Native Helper".
 * The words are spread over i18n tables, the install guide and static markup, so one sweep rewrites
 * what is shown instead of editing every string. Code-like uses (com.yraveragesubmin.helper,
 * helper-status, paths) are left alone; a sentence-ending full stop does not make a word code-like.
 *   node --test test/engine-wording.test.mjs
 */
const WORD = /(?<![\w\-/\\]|\w\.)(?:the Native Helper engine|mesin Native Helper|Native Helper|Native helper|native helper|Helper|helper)(?![\w\-/\\]|\.\w)/g;

export function engineWording(text) {
  return String(text).replace(WORD, (m) => (m === 'helper' ? 'engine' : m === 'the Native Helper engine' ? 'the Engine' : 'Engine'));
}

const ATTRS = ['aria-label', 'title', 'placeholder'];
function sweep1(el, a) {
  const cur = el.getAttribute(a);
  const v = cur && engineWording(cur);
  if (v && v !== cur) el.setAttribute(a, v);
}
function sweep(node) {
  if (node.nodeType === 3) {
    const v = engineWording(node.nodeValue);
    if (v !== node.nodeValue) node.nodeValue = v;
    return;
  }
  if (node.nodeType !== 1 || /^(SCRIPT|STYLE|CODE|PRE|TEXTAREA)$/.test(node.tagName)) return;
  for (const a of ATTRS) sweep1(node, a);
  node.childNodes.forEach(sweep);
}

/** Sweep `root` now and whatever is rendered into it later. */
export function watchEngineWording(root) {
  sweep(root);
  // A rewrite that changes nothing writes nothing, so the observer settles after one pass.
  new MutationObserver((list) => list.forEach((m) => {
    if (m.type === 'attributes') sweep1(m.target, m.attributeName);
    else m.addedNodes.forEach(sweep);
  })).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRS });
}
