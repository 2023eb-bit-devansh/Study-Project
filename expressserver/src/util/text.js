/**
 * Generic text helpers shared by retrieval (IDF, sufficiency, near-dup) and
 * the corpus chunker.
 *
 * Citation-grade normalisation lives in `citation/normalize.js`, not here —
 * that one has to preserve an offset map back into the original string and
 * has different, stricter rules.
 */
import { STOPWORDS } from './stopwords.js';

/** Lowercase, strip punctuation, split on whitespace. */
export function tokenize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Naive suffix stripping. Enough to make "punishable"/"punished" collide. */
export function stem(t) {
  if (t.length <= 4) return t;
  for (const suf of ['ations', 'ation', 'ingly', 'ising', 'izing', 'ings', 'ing', 'able', 'ible', 'edly', 'ed', 'es', 'ly', 's']) {
    if (t.length - suf.length >= 4 && t.endsWith(suf)) return t.slice(0, -suf.length);
  }
  return t;
}

/** Content tokens: stopwords removed, stemmed, de-duplicated in order. */
export function contentTokens(s) {
  const out = [];
  const seen = new Set();
  for (const t of tokenize(s)) {
    if (STOPWORDS.has(t) || t.length < 3) continue;
    const st = stem(t);
    if (seen.has(st)) continue;
    seen.add(st);
    out.push(st);
  }
  return out;
}

/**
 * Number-words canonicalised to their digit form.
 *
 * "within thirty days" and "within 30 days" are the SAME quantity, and a
 * model quoting one where the source has the other is a formatting
 * difference, not a changed legal proposition. Comparing the surface tokens
 * would make the number guard reject a genuine quote — measured, not
 * hypothesised: it was the only false rejection in the threshold sweep.
 *
 * Compound numerals ("twenty five") are canonicalised token-by-token rather
 * than summed, which is enough for the multiset comparison the guard does.
 */
const NUMBER_WORDS = new Map([
  ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'], ['five', '5'],
  ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'], ['ten', '10'],
  ['eleven', '11'], ['twelve', '12'], ['thirteen', '13'], ['fourteen', '14'],
  ['fifteen', '15'], ['sixteen', '16'], ['seventeen', '17'], ['eighteen', '18'],
  ['nineteen', '19'], ['twenty', '20'], ['thirty', '30'], ['forty', '40'],
  ['fifty', '50'], ['sixty', '60'], ['seventy', '70'], ['eighty', '80'],
  ['ninety', '90'], ['hundred', '100'], ['thousand', '1000'],
  ['lakh', '100000'], ['lakhs', '100000'],
  ['crore', '10000000'], ['crores', '10000000'],
  ['million', '1000000'], ['billion', '1000000000'],
]);

/**
 * NOTE: callers that care about correctness (the citation number guard)
 * must pass text that has already been through `citation/normalize.js` N1,
 * which collapses digit separators so `1,00,000` arrives as `100000`.
 */
export function numericTokens(s) {
  const out = [];
  for (const t of tokenize(s)) {
    // Leading zeros are stripped so "07" and "7" compare equal.
    if (/^\d+$/.test(t)) out.push(String(Number(t)));
    else if (NUMBER_WORDS.has(t)) out.push(NUMBER_WORDS.get(t));
  }
  return out.sort();
}

/** Is this token a digit run or a number-word? */
export function isNumberLike(token) {
  const t = String(token ?? '').toLowerCase();
  return /^\d+$/.test(t) || NUMBER_WORDS.has(t);
}

/** Multiset equality, used by the citation number guard. */
export function sameMultiset(a, b) {
  if (a.length !== b.length) return false;
  const x = [...a].sort(); const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const v of A) if (B.has(v)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Character n-gram set, used for near-duplicate candidate merging. */
export function ngrams(s, n = 5) {
  const t = String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const set = new Set();
  for (let i = 0; i + n <= t.length; i++) set.add(t.slice(i, i + n));
  return set;
}

export function truncate(s, max, suffix = '…') {
  const str = String(s ?? '');
  return str.length <= max ? str : str.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

/** Collapse whitespace without touching anything else. */
export const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
