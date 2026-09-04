// Shared helpers for detecting whether a subtitle line still needs translation.
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

export function sourceText(line) {
  const src = (line?.src || line?.rawSrc || line?.source || '').trim();
  if (src) return src;
  return (line?.tgt || line?.rawTgt || line?.translation || '').trim();
}

export function translationText(line) {
  return (line?.tgt || line?.rawTgt || line?.translation || '').trim();
}

/**
 * Which way this specific line went. Two-way (consecutive) interpreter lines
 * carry their own `dir: { src, tgt }` — half of them run opposite to the
 * session config, so judging them by the config would call good translations
 * untranslated. Lines without `dir` fall back to the session languages.
 */
export function lineDirection(line, srcLang = 'auto', tgtLang = 'en') {
  const d = line?.dir;
  if (d && typeof d.src === 'string' && d.src && typeof d.tgt === 'string' && d.tgt) {
    return { srcLang: d.src, tgtLang: d.tgt };
  }
  return { srcLang, tgtLang };
}

export function needsTranslation(line, srcLang = 'auto', tgtLang = 'en') {
  const src = sourceText(line);
  if (!src) return false;

  const tgt = translationText(line);
  if (!tgt || tgt === src) return true;

  const dir = lineDirection(line, srcLang, tgtLang);
  if (dir.tgtLang === 'en' && CJK.test(tgt)) return true;
  if (
    dir.srcLang === 'ja' &&
    dir.tgtLang === 'en' &&
    CJK.test(tgt) &&
    !/[A-Za-z]{2,}/.test(tgt)
  ) {
    return true;
  }

  return false;
}

export function mergeLinesByTime(...groups) {
  const map = new Map();
  for (const list of groups) {
    for (const line of list || []) {
      const t0 = line.t0 ?? 0;
      const key = Math.round(t0 * 10);
      const prev = map.get(key);
      map.set(key, {
        ...prev,
        ...line,
        t0,
        t1: line.t1 ?? prev?.t1 ?? t0 + 2,
      });
    }
  }
  return [...map.values()].sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0));
}

export function pickUntranslatedLines(lists, srcLang, tgtLang) {
  return mergeLinesByTime(...lists)
    .filter((l) => needsTranslation(l, srcLang, tgtLang))
    .map((l) => ({
      t0: l.t0 ?? 0,
      t1: l.t1 ?? (l.t0 ?? 0) + 2,
      src: sourceText(l),
      rawSrc: sourceText(l),
      rawTgt: translationText(l),
      tgt: translationText(l),
      // carried so force-translate can pick the right direction per line
      ...(l.dir ? { dir: l.dir } : {}),
    }))
    .filter((l) => l.src);
}
