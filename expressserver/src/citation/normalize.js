/**
 * Citation-grade text normalisation.
 *
 * Implemented as a character TRANSDUCER: alongside the normalised string it
 * emits a map from each output index back to the index it came from in the
 * original. That map is what lets the UI highlight the matched span inside
 * the real, un-normalised passage — "here is the exact text, highlighted" is
 * what makes the evidence-first claim credible to a reader rather than
 * merely asserted.
 *
 * Two levels:
 *   N1 — conservative. Used for the exact-match tier. Folds only the things
 *        that are genuinely typographic: unicode forms, quote and dash
 *        variants, line-break de-hyphenation, legal token abbreviations,
 *        digit separators, whitespace.
 *   N2 — aggressive. N1 plus punctuation → space. Used for the fuzzy tier.
 *
 * DELIBERATELY NOT DONE: abbreviation expansion ("ipc" → "indian penal
 * code"). It changes string lengths dramatically, which wrecks the
 * Levenshtein ratio and manufactures false positives. Abbreviation
 * resolution belongs in `corpus/refKey.js`, not in a quote matcher.
 */

/** Ordered token expansions, applied on the already-lowercased string. */
const LEGAL_TOKENS = [
  [/§/g, 'section '],
  [/\bsec\.\s*/gi, 'section '],
  [/\bsecs\.\s*/gi, 'sections '],
  [/\bs\.\s*(?=\d)/gi, 'section '],
  [/\bart\.\s*/gi, 'article '],
  [/\bcl\.\s*/gi, 'clause '],
  [/\bsub-?sec\.\s*/gi, 'subsection '],
  [/\bsub-?s\.\s*/gi, 'subsection '],
  [/\bvs?\.\s*/gi, 'v '],
  [/\bversus\b/gi, 'v'],
  [/\bi\.p\.c\./gi, 'ipc'],
  [/\bcr\.p\.c\./gi, 'crpc'],
  [/\bi\.e\.a\./gi, 'iea'],
  [/\ba\.i\.r\./gi, 'air'],
  [/\bs\.c\.c\./gi, 'scc'],
  [/\bu\.o\.i\./gi, 'uoi'],
];

const QUOTE_MAP = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-',
  '―': '-', '−': '-',
};
const DEVANAGARI_DIGITS = '०१२३४५६७८९';
const ZERO_WIDTH = /[​-‍﻿­]/;

/**
 * @typedef {{ text: string, map: Int32Array }} Normalized
 * `map[i]` is the index in the ORIGINAL string that produced `text[i]`.
 */

/**
 * Level-1 normalisation.
 * @param {string} input
 * @returns {Normalized}
 */
export function n1(input) {
  const src = String(input ?? '');

  // Pass 0 — NFKC. Composition can merge or expand characters, so offsets
  // are tracked per source character rather than assumed 1:1.
  let out = '';
  const map = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const folded = ch.normalize('NFKC');
    for (const c of folded) { out += c; map.push(i); }
  }

  const step = (fn) => {
    const [nextText, nextMap] = fn(out, map);
    out = nextText;
    map.length = 0;
    map.push(...nextMap);
  };

  // Pass 1 — drop zero-width and soft hyphens.
  step((t, m) => {
    let o = ''; const mm = [];
    for (let i = 0; i < t.length; i++) {
      if (ZERO_WIDTH.test(t[i])) continue;
      o += t[i]; mm.push(m[i]);
    }
    return [o, mm];
  });

  // Pass 2 — undo line-break de-hyphenation: "punish-\n  ment" → "punishment".
  step((t, m) => {
    let o = ''; const mm = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '-') {
        let j = i + 1;
        while (j < t.length && /[ \t]/.test(t[j])) j++;
        if (j < t.length && t[j] === '\n') {
          j++;
          while (j < t.length && /[ \t]/.test(t[j])) j++;
          i = j - 1;
          continue;
        }
      }
      o += t[i]; mm.push(m[i]);
    }
    return [o, mm];
  });

  // Pass 3 — quote/dash folding, ellipsis, Devanagari digits, lowercase.
  step((t, m) => {
    let o = ''; const mm = [];
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '…') { o += '...'; mm.push(m[i], m[i], m[i]); continue; }
      const di = DEVANAGARI_DIGITS.indexOf(ch);
      if (di >= 0) { o += String(di); mm.push(m[i]); continue; }
      const mapped = QUOTE_MAP[ch] ?? ch.toLowerCase();
      for (const c of mapped) { o += c; mm.push(m[i]); }
    }
    return [o, mm];
  });

  // Pass 4 — legal token expansion.
  for (const [re, replacement] of LEGAL_TOKENS) {
    step((t, m) => applyRegex(t, m, re, replacement));
  }

  // Pass 5 — digit separators inside numbers: "1,00,000" → "100000".
  step((t, m) => applyRegex(t, m, /(?<=\d)[,](?=\d)/g, ''));

  // Pass 6 — collapse all whitespace to a single space, then trim.
  step((t, m) => {
    let o = ''; const mm = [];
    let i = 0;
    while (i < t.length && /\s/.test(t[i])) i++;          // leading
    let pendingSpaceFrom = -1;
    for (; i < t.length; i++) {
      if (/[\s ]/.test(t[i])) { if (pendingSpaceFrom < 0) pendingSpaceFrom = m[i]; continue; }
      if (pendingSpaceFrom >= 0) { o += ' '; mm.push(pendingSpaceFrom); pendingSpaceFrom = -1; }
      o += t[i]; mm.push(m[i]);
    }
    return [o, mm];
  });

  return { text: out, map: Int32Array.from(map) };
}

/** Apply a regex replacement while carrying the offset map along. */
function applyRegex(text, map, re, replacement) {
  re.lastIndex = 0;
  let o = ''; const mm = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index;
    for (let i = last; i < start; i++) { o += text[i]; mm.push(map[i]); }
    // The whole replacement is attributed to the first source character of
    // the match, which keeps the highlight anchored at the right place.
    for (const c of replacement) { o += c; mm.push(map[start]); }
    last = start + m[0].length;
  }
  for (let i = last; i < text.length; i++) { o += text[i]; mm.push(map[i]); }
  return [o, mm];
}

/**
 * Level-2 normalisation: N1, then every remaining punctuation character
 * becomes a space, then whitespace is re-collapsed.
 * @returns {Normalized}
 */
export function n2(input) {
  const first = n1(input);
  let o = ''; const mm = [];
  let pendingSpaceFrom = -1;
  for (let i = 0; i < first.text.length; i++) {
    const ch = first.text[i];
    const isSep = /[^\p{L}\p{N}]/u.test(ch);
    if (isSep) { if (pendingSpaceFrom < 0) pendingSpaceFrom = first.map[i]; continue; }
    if (pendingSpaceFrom >= 0 && o.length > 0) { o += ' '; mm.push(pendingSpaceFrom); }
    pendingSpaceFrom = -1;
    o += ch; mm.push(first.map[i]);
  }
  return { text: o, map: Int32Array.from(mm) };
}

/** Convenience wrappers when the offset map is not needed. */
export const N1 = (s) => n1(s).text;
export const N2 = (s) => n2(s).text;

/**
 * Map a [start, end) span in normalised space back to the original string.
 * @param {Normalized} norm @param {number} start @param {number} end
 */
export function toOriginalSpan(norm, start, end) {
  if (norm.map.length === 0 || start >= norm.map.length) return null;
  const from = norm.map[Math.max(0, Math.min(start, norm.map.length - 1))];
  const lastIdx = Math.max(0, Math.min(end - 1, norm.map.length - 1));
  // +1 so the span is end-exclusive over the original characters.
  const to = norm.map[lastIdx] + 1;
  return { start: from, end: Math.max(from, to) };
}
