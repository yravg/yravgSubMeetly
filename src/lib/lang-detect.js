// Heuristic spoken-language picker for two-way (consecutive) interpreter mode.
//
// Given a finalised utterance and the two languages the conversation is
// between, decide which one was spoken so the pipeline can translate it into
// the other. Deliberately tiny: no models, no network, no downloads — this
// runs per utterance inside the offscreen document.
//
// Order of evidence:
//   1. script  — Han/Kana/Hangul/Cyrillic/Arabic/Thai/Devanagari pin a language
//   2. stop words — small built-in lists discriminate Latin-script candidates
//   3. fallback — ties or no evidence return candidates[0]

/** Lowercase, diacritics kept. ≥25 words per language. */
export const STOP_WORDS = {
  en: ['the', 'and', 'is', 'are', 'was', 'were', 'this', 'that', 'with', 'have', 'has', 'had',
    'not', 'you', 'for', 'from', 'they', 'what', 'which', 'would', 'could', 'should', 'about',
    'there', 'their', 'been', 'will', 'your', 'but', 'all'],
  id: ['dan', 'yang', 'di', 'ke', 'dari', 'untuk', 'dengan', 'tidak', 'ini', 'itu', 'adalah',
    'saya', 'kami', 'kita', 'mereka', 'akan', 'sudah', 'bisa', 'ada', 'pada', 'dalam', 'karena',
    'atau', 'juga', 'lebih', 'harus', 'banyak', 'orang', 'apa', 'bagaimana'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'sich', 'auf', 'für',
    'von', 'dem', 'den', 'aber', 'auch', 'wir', 'sie', 'ich', 'haben', 'werden', 'wird', 'noch',
    'nur', 'oder', 'wenn', 'dass', 'sehr', 'kann'],
  fr: ['le', 'la', 'les', 'des', 'une', 'est', 'pas', 'que', 'qui', 'pour', 'dans', 'avec', 'sur',
    'plus', 'nous', 'vous', 'ils', 'elle', 'mais', 'être', 'avoir', 'cette', 'tout', 'comme',
    'sont', 'faire', 'bien', 'très', 'aussi', 'leur'],
  es: ['el', 'la', 'los', 'las', 'una', 'que', 'por', 'para', 'con', 'del', 'como', 'más', 'pero',
    'sus', 'este', 'esta', 'son', 'ser', 'hay', 'muy', 'todo', 'cuando', 'porque', 'también',
    'hacer', 'sobre', 'entre', 'desde', 'tiene', 'nosotros'],
  it: ['il', 'lo', 'la', 'gli', 'che', 'per', 'con', 'non', 'una', 'del', 'della', 'sono', 'come',
    'più', 'anche', 'questo', 'questa', 'quando', 'perché', 'molto', 'essere', 'hanno', 'nella',
    'dei', 'alla', 'loro', 'tutto', 'fare', 'ma', 'cosa'],
  nl: ['de', 'het', 'een', 'en', 'van', 'is', 'dat', 'op', 'te', 'niet', 'met', 'voor', 'zijn',
    'aan', 'er', 'maar', 'ook', 'als', 'om', 'worden', 'wordt', 'heeft', 'hebben', 'deze', 'door',
    'naar', 'over', 'wij', 'zij', 'kunnen'],
  pl: ['nie', 'jest', 'się', 'na', 'do', 'że', 'to', 'jak', 'ale', 'czy', 'oraz', 'przez', 'dla',
    'tylko', 'jeszcze', 'bardzo', 'może', 'gdy', 'który', 'która', 'wszystko', 'jestem', 'mamy',
    'będzie', 'teraz', 'dobrze', 'trzeba', 'mnie', 'ciebie', 'nasz'],
  vi: ['và', 'của', 'là', 'có', 'không', 'được', 'các', 'những', 'người', 'cho', 'với', 'trong',
    'này', 'đó', 'một', 'khi', 'đã', 'sẽ', 'để', 'thì', 'rất', 'cũng', 'nhưng', 'phải', 'làm',
    'như', 'về', 'tôi', 'chúng', 'bạn'],
  pt: ['de', 'que', 'não', 'uma', 'para', 'com', 'por', 'como', 'mais', 'mas', 'você', 'isso',
    'está', 'são', 'também', 'muito', 'quando', 'porque', 'sobre', 'entre', 'fazer', 'nós', 'seu',
    'sua', 'pelo', 'pela', 'então', 'ainda', 'já', 'todos'],
  tr: ['ve', 'bir', 'bu', 'için', 'ile', 'daha', 'çok', 'gibi', 'ama', 'değil', 'olarak', 'kadar',
    'sonra', 'şey', 'olan', 'var', 'yok', 'ben', 'sen', 'biz', 'siz', 'onlar', 'ne', 'nasıl',
    'çünkü', 'her', 'hiç', 'zaman', 'şimdi', 'böyle'],
};

const STOP_SETS = Object.fromEntries(
  Object.entries(STOP_WORDS).map(([lang, words]) => [lang, new Set(words)]),
);

/** Script → the languages it can mean. Kana is tested before Han (Japanese uses both). */
export const SCRIPT_RULES = [
  { re: /[\u3040-\u30ff]/u, langs: ['ja'] },
  { re: /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u, langs: ['ko'] },
  { re: /[\u0e00-\u0e7f]/u, langs: ['th'] },
  { re: /[\u0600-\u06ff\u0750-\u077f]/u, langs: ['ar'] },
  { re: /[\u0900-\u097f]/u, langs: ['hi'] },
  { re: /[\u0400-\u04ff]/u, langs: ['ru', 'uk'] },
  { re: /[\u4e00-\u9fff\u3400-\u4dbf]/u, langs: ['zh'] },
];

/** Letters unique to Ukrainian among the Cyrillic languages we support. */
const UK_LETTERS = /[їєґі]/iu;

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{M}']+/u)
    .filter(Boolean);
}

/**
 * Pick which of `candidates` `text` is written in.
 * Always returns one of `candidates` (or '' when there are none).
 */
export function detectLanguage(text, candidates) {
  const list = (candidates || []).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  const s = String(text || '');
  if (!s.trim()) return list[0];

  for (const rule of SCRIPT_RULES) {
    if (!rule.re.test(s)) continue;
    const hits = rule.langs.filter((l) => list.includes(l));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      // ru vs uk — only Ukrainian uses ї/є/ґ/і.
      if (hits.includes('uk') && UK_LETTERS.test(s)) return 'uk';
      if (hits.includes('ru')) return 'ru';
      return hits[0];
    }
  }

  const words = tokenize(s);
  let best = list[0];
  let bestScore = 0;
  for (const lang of list) {
    const set = STOP_SETS[lang];
    if (!set) continue;
    let score = 0;
    for (const w of words) if (set.has(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }
  return best;
}
