/**
 * The three-tier matching ladder.
 *
 *   Tier 0  EXACT       N1(source) contains N1(quote)
 *   Tier 1  NORMALIZED  N2(source) contains N2(quote)
 *   Tier 2  FUZZY       token sliding window over N2(source), Jaccard
 *                       prefiltered, scored by character Levenshtein ratio
 *
 * Every tier reports the matched span mapped back into the ORIGINAL source
 * string, so the UI can highlight the real text rather than a normalised
 * approximation of it.
 */
import { n1, n2, toOriginalSpan } from './normalize.js';
import { ratio } from './levenshtein.js';
import { jaccard } from '../util/text.js';
import { config } from '../config/index.js';

/** @typedef {{ tier:'exact'|'normalized'|'fuzzy'|'none', similarity:number, span:{start:number,end:number}|null, matchedText:string }} MatchResult */

const NONE = { tier: 'none', similarity: 0, span: null, matchedText: '' };

/**
 * @param {string} source  the real passage text
 * @param {string} quote   the model's verbatim_quote
 * @returns {MatchResult}
 */
export function matchQuote(source, quote) {
  if (!source || !quote) return { ...NONE };

  // ── Tier 0 — exact under conservative normalisation ────────────────
  const s1 = n1(source);
  const q1 = n1(quote);
  if (q1.text.length > 0) {
    const at = s1.text.indexOf(q1.text);
    if (at >= 0) {
      const span = toOriginalSpan(s1, at, at + q1.text.length);
      return { tier: 'exact', similarity: 1, span, matchedText: span ? source.slice(span.start, span.end) : '' };
    }
  }

  // ── Tier 1 — exact under aggressive normalisation ──────────────────
  const s2 = n2(source);
  const q2 = n2(quote);
  if (q2.text.length > 0) {
    const at = s2.text.indexOf(q2.text);
    if (at >= 0) {
      const span = toOriginalSpan(s2, at, at + q2.text.length);
      return { tier: 'normalized', similarity: 1, span, matchedText: span ? source.slice(span.start, span.end) : '' };
    }
  }

  // ── Tier 2 — fuzzy sliding window ──────────────────────────────────
  return fuzzyMatch(s2, q2);
}

/**
 * Token-window candidate generation with a Jaccard prefilter, scored by
 * character-level Levenshtein ratio.
 *
 * The prefilter is O(1)-ish per window and discards the overwhelming
 * majority before the quadratic DP runs. Window widths of n±20% absorb the
 * model dropping or adding a couple of words.
 */
function fuzzyMatch(sNorm, qNorm) {
  const { windowSlack, jaccardPrefilter, fuzzyPartial } = config.citation;

  const sTokens = tokenSpans(sNorm.text);
  const qTokens = qNorm.text.split(' ').filter(Boolean);
  if (qTokens.length === 0 || sTokens.length === 0) return { ...NONE };

  const qSet = new Set(qTokens);
  const qJoined = qTokens.join(' ');
  const n = qTokens.length;

  const widths = [...new Set([
    Math.max(1, Math.floor(n * (1 - windowSlack))),
    n,
    Math.max(1, Math.ceil(n * (1 + windowSlack))),
  ])];

  let best = { ...NONE };

  for (const w of widths) {
    if (w > sTokens.length) continue;
    for (let i = 0; i + w <= sTokens.length; i++) {
      const window = sTokens.slice(i, i + w);
      if (jaccard(qSet, new Set(window.map((t) => t.text))) < jaccardPrefilter) continue;

      const joined = window.map((t) => t.text).join(' ');
      // Only compute a full DP for windows that could beat what we have.
      const r = ratio(joined, qJoined, Math.max(best.similarity, fuzzyPartial * 0.9));
      if (r > best.similarity) {
        const span = toOriginalSpan(sNorm, window[0].start, window[w - 1].end);
        best = { tier: 'fuzzy', similarity: r, span, matchedText: '' };
      }
    }
  }
  return best.similarity > 0 ? best : { ...NONE };
}

/** Tokens of a normalised string with their [start,end) offsets in it. */
function tokenSpans(text) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    const isSpace = i === text.length || text[i] === ' ';
    if (!isSpace && start < 0) start = i;
    else if (isSpace && start >= 0) { out.push({ text: text.slice(start, i), start, end: i }); start = -1; }
  }
  return out;
}

/** Attach the original-text slice for a fuzzy hit. */
export function withMatchedText(source, result) {
  if (!result.span) return result;
  return { ...result, matchedText: source.slice(result.span.start, result.span.end) };
}
