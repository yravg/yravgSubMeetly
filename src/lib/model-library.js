// The engine's model library (PMM-028/029/030), pure so node tests it: which catalog rows the
// filter (On device / All / Recommended) and the search let through, the languages a model serves,
// whether it may be deleted, and the "Languages on this device" list. The island has the same rules
// in poni_core::library.

export const FILTERS = ['device', 'all', 'recommended'];

// `…/opus-mt-en-id` → ['en', 'id'].
export function pairLangs(id) {
  const m = /\/opus-mt-([a-z]+)-([a-z]+)$/.exec(id || '');
  return m ? [m[1], m[2]] : null;
}

// Whisper and the LLMs serve every language with one download; a pair serves its own.
export function languagesOf(m, names = {}) {
  const p = m.kind === 'translate-pair' && pairLangs(m.id);
  return p ? `${names[p[0]] || p[0]} → ${names[p[1]] || p[1]}` : 'All languages';
}

// Never the model in use (the engine refuses it too); only what is on disk.
export const canDelete = (m) => !!m.downloaded && !m.selected && !m.pulling && !m.moving;

function recommended(m, res, src, tgt) {
  if (m.kind === 'translate-pair') {
    const p = pairLangs(m.id);
    return !!p && p[0] === src && p[1] === tgt;
  }
  return m.id === res?.recommended?.id || (m.kind === 'asr' && !!m.selected);
}

// The rows to show, in the engine's order.
export function libraryRows(res, { filter = 'all', query = '', src = '', tgt = '', names = {} } = {}) {
  const q = query.trim().toLowerCase();
  const catalog = Array.isArray(res?.catalog) ? res.catalog : [];
  return catalog
    .filter((m) => (filter === 'device' ? !!m.downloaded : filter === 'recommended' ? recommended(m, res, src, tgt) : true))
    .filter((m) => !q || [m.label, m.id, m.kind, languagesOf(m, names)].some((h) => String(h || '').toLowerCase().includes(q)));
}

// For each caption language: speech (Whisper, multilingual), translation (Whisper itself into
// English, else the chosen LLM), and the fast pairs into it, each with whether it is on this device.
export function languageRows(res, codes, names = {}) {
  const catalog = Array.isArray(res?.catalog) ? res.catalog : [];
  const asr = catalog.find((m) => m.kind === 'asr' && m.selected);
  const llm = catalog.find((m) => m.kind === 'translate' && m.selected);
  const speech = !asr ? 'Speech model not chosen' : asr.downloaded ? 'Speech on device' : 'Speech model not downloaded';
  const llmText = !llm ? 'translation off' : `translated by ${llm.label || llm.id}, ${llm.downloaded ? 'on device' : 'not downloaded'}`;
  return codes.map((code) => {
    const parts = [speech, code === 'en' ? 'translated by Whisper itself' : llmText];
    for (const p of catalog.filter((m) => m.kind === 'translate-pair' && pairLangs(m.id)?.[1] === code)) {
      const from = pairLangs(p.id)[0];
      parts.push(`fast pair from ${names[from] || from}: ${p.downloaded ? 'on device' : 'not downloaded'}`);
    }
    return { code, name: names[code] || code, text: parts.join(' · ') };
  });
}

// Where the engine reads a model downloaded by hand (engine `models::manual_dir`).
export const manualDir = (id) => `%USERPROFILE%\\yravgSubMeetly-models\\${id.replace('/', '--')}`;
