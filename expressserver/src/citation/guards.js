/**
 * Hard guards, applied BEFORE the similarity ratio is consulted.
 *
 * The number guard is the single highest-value component in this system for
 * a legal fact checker. Consider:
 *
 *   source: "...imprisonment for a term which may extend to seven years..."
 *   quote:  "...imprisonment for a term which may extend to ten years..."
 *
 * That scores ~0.97 on character Levenshtein. The ratio says verified. The
 * claim is false. Numbers ARE the claim in penalty law, in limitation
 * periods, in age thresholds, in RTI's thirty-day rule. One multiset
 * comparison catches every instance of it.
 *
 * The negation guard DEMOTES rather than rejects, because legal drafting is
 * negation-dense and the guard will produce some false alarms. Demotion
 * halves an item's weight in the decision table instead of discarding it.
 */
import { N1, N2 } from './normalize.js';
import { numericTokens, sameMultiset } from '../util/text.js';
import { NEGATION_WORDS } from '../util/stopwords.js';
import { config } from '../config/index.js';

/** @typedef {{ id:string, action:'reject'|'demote', reason:string, detail?:string }} GuardHit */

const NEGATION_RE = new RegExp(`\\b(?:${NEGATION_WORDS.join('|')})\\b`, 'g');

function countNegations(text) {
  return (String(text).match(NEGATION_RE) ?? []).length;
}

/**
 * @param {object} o
 * @param {string} o.quote          the model's verbatim_quote
 * @param {string} o.matchedText    the passage span the ladder matched
 * @param {import('./match.js').MatchResult} o.match
 * @param {string} o.sourceType     'corpus' | 'web' | 'web_unverifiable'
 * @returns {GuardHit[]}
 */
export function runGuards({ quote, matchedText, match, sourceType }) {
  const hits = [];
  const q = String(quote ?? '');
  const normQuote = N2(q);

  // ── source availability ────────────────────────────────────────────
  // A grounded search result gives a URI and a title, not page text. If we
  // could not fetch the page, there is nothing to verify a quote against,
  // and an unverifiable source may never support a verdict.
  if (sourceType === 'web_unverifiable') {
    hits.push({
      id: 'source_unavailable',
      action: 'reject',
      reason: 'The cited web page could not be fetched, so its text is unavailable for verification.',
    });
    return hits;
  }

  // ── length ─────────────────────────────────────────────────────────
  // A very short quote can match by accident. An exact Tier-0 hit is
  // exempt: if it appears character-for-character, it is genuinely there.
  if (normQuote.length < config.citation.minQuoteChars && match.tier !== 'exact') {
    hits.push({
      id: 'quote_too_short',
      action: 'reject',
      reason: `Quote is ${normQuote.length} characters; ${config.citation.minQuoteChars} are required for a non-exact match.`,
    });
  }

  if (match.tier === 'none') return hits;

  // ── number integrity ───────────────────────────────────────────────
  // Numeric tokens are taken from N1-normalised text, where digit
  // separators have already collapsed ("1,00,000" → "100000") so that
  // formatting differences are not read as different quantities.
  if (config.citation.numberGuard) {
    const qNums = numericTokens(N1(q));
    const mNums = numericTokens(N1(matchedText ?? ''));
    if (!sameMultiset(qNums, mNums)) {
      hits.push({
        id: 'number_mismatch',
        action: 'reject',
        reason: 'Numbers in the quote do not match the source passage.',
        detail: `quote=[${qNums.join(', ')}] source=[${mNums.join(', ')}]`,
      });
    }
  }

  // ── negation integrity ─────────────────────────────────────────────
  if (config.citation.negationGuard) {
    const qNeg = countNegations(normQuote);
    const mNeg = countNegations(N2(matchedText ?? ''));
    if (qNeg !== mNeg) {
      hits.push({
        id: 'negation_mismatch',
        action: 'demote',
        reason: 'The quote and the source passage contain a different number of negations.',
        detail: `quote=${qNeg} source=${mNeg}`,
      });
    }
  }

  return hits;
}

/** Apply guard actions to a tier/similarity, producing a final status. */
export function applyGuards(baseStatus, guards) {
  if (guards.some((g) => g.action === 'reject')) return 'rejected';
  if (guards.some((g) => g.action === 'demote')) {
    return baseStatus === 'verified' ? 'partially_verified' : 'rejected';
  }
  return baseStatus;
}

/** Similarity → status, before guards. */
export function statusForSimilarity(match) {
  if (match.tier === 'exact' || match.tier === 'normalized') return 'verified';
  if (match.similarity >= config.citation.fuzzyVerify) return 'verified';
  if (match.similarity >= config.citation.fuzzyPartial) return 'partially_verified';
  return 'rejected';
}

/** Long quotes are truncated and re-matched rather than rejected outright. */
export function truncateQuote(quote) {
  const max = config.citation.maxQuoteChars;
  const q = String(quote ?? '');
  return q.length <= max ? { quote: q, truncated: false } : { quote: q.slice(0, max), truncated: true };
}
