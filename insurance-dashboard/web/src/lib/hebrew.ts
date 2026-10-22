/** The Hebrew normaliser shared by every search on the site. pipeline/build_search.py carries the same rules, so the
 *  index the pipeline writes and the words a reader types meet in one form:
 *  NFKC, lower case, niqqud and cantillation dropped, final letters folded (ך→כ ם→מ ן→נ ף→פ ץ→צ), geresh, gershayim and
 *  quotes inside a word dropped (מע"מ = מעמ, ש״ח = שח), hyphen and maqaf split words (על-ידי = על ידי), thousands
 *  separators dropped from numbers (17,717 = 17717), and a word may carry the prefix letters ו ה ב ל מ ש כ (בהפסד → הפסד). */

const FINAL: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const MARKS = /[֑-ׇֽֿׁׂׅׄ]/g;
const SPLIT = /[־׀׃‎‏‪-‮⁦-⁩]/g;
const FINALS = /[ךםןףץ]/g;
/** one word: a number (digits, thousands commas, one decimal point), a run of Latin letters, or Hebrew letters with quotes inside */
export const TOKEN = /[0-9][0-9,]*(?:\.[0-9]+)?|[a-z]+|[א-ת]+(?:['"׳״`’”][א-ת]+)*/g;
const QUOTES = /['"׳״`’”]/g;
const PREFIX = 'והבלמשכ';

/** One character in its search form ('' when it is dropped). Used per character so a match maps back onto the original text. */
export function normChar(ch: string): string {
  return ch.normalize('NFKC').toLowerCase().replace(MARKS, '').replace(SPLIT, ' ').replace(FINALS, (c) => FINAL[c]);
}

export function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(MARKS, '').replace(SPLIT, ' ').replace(FINALS, (c) => FINAL[c]);
}

/** A matched word in its index form, or null when it is too short to index (a single letter, a one- or two-digit number). */
export function term(raw: string): string | null {
  const c = raw.charCodeAt(0);
  if (c >= 48 && c <= 57) {
    const t = raw.replace(/,/g, '');
    return t.replace('.', '').length >= 3 ? t : null;
  }
  const t = c >= 0x5d0 ? raw.replace(QUOTES, '') : raw;
  return t.length >= 2 ? t : null;
}

/** The words of a text in index form, in order. */
export function terms(s: string): string[] {
  const out: string[] = [];
  for (const m of normalize(s).matchAll(TOKEN)) { const t = term(m[0]); if (t) out.push(t); }
  return out;
}

/** The forms a Hebrew word takes without its prefix letters: והשקעות → השקעות, שקעות, קעות (the index keeps the ones that are words). */
export function stems(t: string): string[] {
  const out: string[] = [];
  for (let k = 1; k <= 3 && t.length - k >= 3; k++) {
    const ch = t[k - 1];
    if (!PREFIX.includes(ch) || (ch === 'ו' && k > 1)) break;
    out.push(t.slice(k));
  }
  return out;
}

/** Does the indexed word `w` match the query word `q`: the same word, or the same word behind prefix letters. */
export function matches(w: string, q: string): 0 | 1 | 2 {
  if (w === q) return 2;
  if (w.length > q.length && w.endsWith(q) && stems(w).includes(q)) return 1;
  return 0;
}

/** A caption matches a query word when one of its words starts with it, directly or behind prefix letters (for type-ahead). */
export function startsWord(words: string[], q: string): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  for (const w of words) {
    if (w.startsWith(q)) return 2;
    if (!best && stems(w).some((s) => s.startsWith(q))) best = 1;
  }
  return best;
}

/** FNV-1a over the UTF-8 bytes: which shard of the full-text index holds a word. */
export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Where the query words fall in an original text: [start, end) ranges over the original string, for highlighting. */
export function findTerms(text: string, qs: string[]): [number, number][] {
  if (!qs.length) return [];
  // the normalised text, with each output character pointing back at its source character
  let norm = '';
  const back: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const n = normChar(text[i]);
    for (let k = 0; k < n.length; k++) { norm += n[k]; back.push(i); }
  }
  back.push(text.length);
  const out: [number, number][] = [];
  for (const m of norm.matchAll(TOKEN)) {
    const t = term(m[0]);
    if (!t || !qs.some((q) => matches(t, q))) continue;
    const s = back[m.index!], e = back[m.index! + m[0].length - 1] + 1;
    out.push([s, e]);
  }
  return out;
}

/** Words a reader types for what the filings print under another name: a loan word or an English term is searched as the filers' Hebrew
 *  (סולבנסי → כושר פירעון). Applied to the text query only; the omnibox reads the same words as a kind of document. */
const SYN: [RegExp, string][] = [
  [/(^|\s)(סולבנסי|solvency|סולבנצי)(?=\s|$)/gi, '$1כושר פירעון'],
  [/(^|\s)(presentation|deck)(?=\s|$)/gi, '$1מצגת'],
  [/(^|\s)(dividend|דיווידנד)(?=\s|$)/gi, '$1דיבידנד'],
  [/(^|\s)(scr)(?=\s|$)/gi, '$1הון נדרש'],
  [/(^|\s)(ifrs ?17)(?=\s|$)/gi, '$1IFRS 17'],
];
export function expandSynonyms(q: string): string {
  return SYN.reduce((t, [re, to]) => t.replace(re, to), q);
}
