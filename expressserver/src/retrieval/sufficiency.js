/**
 * Retrieval sufficiency: gates G1–G4.
 *
 * BE PRECISE ABOUT WHICH SUFFICIENCY THIS IS. This gate answers "do we have
 * enough to be worth asking the verdict model?" It is NOT the final evidence
 * sufficiency rule in `verdict/decisionTable.js`, which answers "is the
 * verified evidence strong enough to assert a label?". Conflating the two is
 * the most common design error in a system shaped like this, so they live in
 * different modules with different thresholds and are traced separately.
 */
import { config } from '../config/index.js';
import { contentTokens, numericTokens, isNumberLike } from '../util/text.js';
import { N2 } from '../citation/normalize.js';
import { expandAllAliases } from '../corpus/refKey.js';

/**
 * Weighted key terms of a sub-claim. Numbers weigh double: in penalty law,
 * limitation periods and age thresholds, the number IS the claim.
 */
export function keyTerms(subClaimText) {
  // A number contributes exactly one term at weight 2 — not a weight-1
  // content term PLUS a weight-2 numeric one, which would silently give it
  // three times an ordinary word's influence over gate G2.
  //
  // The exclusion tests the SURFACE token ("seven"), not the canonicalised
  // numeric value ("7") that `numericTokens` returns, or the two would never
  // match and the double-count would come straight back.
  const terms = contentTokens(subClaimText)
    .filter((token) => !isNumberLike(token))
    .map((token) => ({ token, weight: 1 }));
  for (const n of new Set(numericTokens(subClaimText))) terms.push({ token: n, weight: 2 });
  return terms;
}

/**
 * @param {object} o
 * @param {string} o.subClaimText
 * @param {string[]} o.refKeys        ref_keys the claim named
 * @param {Array} o.candidates        ranked candidates
 * @param {number} o.newAboveFloor    candidates admitted this turn above the score floor
 * @param {object} o.budget
 */
export function assess({ subClaimText, refKeys = [], candidates = [], progress = 0, turnsDone = 99, budget }) {
  const cfg = config.sufficiency;
  const top = candidates.slice(0, config.retrieval.topK);

  // ── G1 anchor ──────────────────────────────────────────────────────
  // A claim that names a provision must have that provision (or a statutory
  // equivalent) in the top results. Otherwise we are about to reason about
  // Section 302 from the text of Section 304A.
  const wanted = expandAllAliases(refKeys);
  const G1 = refKeys.length === 0
    || top.some((c) => wanted.includes(c.meta?.ref_key) || wanted.includes(c.meta?.ref_key_alt));

  // ── G2 key-term coverage ───────────────────────────────────────────
  const terms = keyTerms(subClaimText);
  const hayText = top.map((c) => c.text).join(' ');
  const hay = N2(hayText);
  // Numeric terms are stored canonicalised ("seven" -> "7"), so they must be
  // matched against the haystack's canonicalised numbers rather than by
  // substring — otherwise every claim containing a spelled-out number would
  // score it as permanently uncovered.
  const hayNumbers = new Set(numericTokens(hayText));
  const covered = terms.filter((t) => (t.weight === 2
    ? hayNumbers.has(t.token)
    : hay.includes(N2(t.token))));
  const totalWeight = terms.reduce((a, t) => a + t.weight, 0) || 1;
  const coveredWeight = covered.reduce((a, t) => a + t.weight, 0);
  const termCoverage = coveredWeight / totalWeight;
  const G2 = termCoverage >= cfg.minTermCoverage;

  // ── G3 strength ────────────────────────────────────────────────────
  const topScore = top[0]?.score ?? 0;
  const strongCount = top.filter((c) => c.score >= cfg.minChunkScore).length;
  const G3 = topScore >= cfg.minTopScore && strongCount >= cfg.minChunks;

  // ── G4 progress ────────────────────────────────────────────────────
  // A turn that admitted nothing new and improved nothing is not going to
  // do better on the next one, so the loop stops rather than burning budget.
  // Never applied to the very first turn, which has nothing to compare to.
  const G4_noProgress = turnsDone > 1 && progress < 1;

  // ── G5 counter-evidence floor ──────────────────────────────────────
  // The loop may not declare itself satisfied before the counter-evidence
  // turn has run. Retrieval that only searches for text matching the claim
  // is confirmation-biased, and stopping on turn 1 is how a system reports
  // "Supported" for a claim whose governing exception it never looked at.
  const G5 = turnsDone >= config.sufficiency.minTurns;

  const uncovered = terms.filter((t) => !covered.includes(t)).map((t) => t.token);
  const gaps = [
    !G1 && `missing_reference:${refKeys.join(',')}`,
    !G2 && `uncovered_terms:${uncovered.slice(0, 8).join(',')}`,
    !G3 && `weak_evidence:top=${topScore.toFixed(2)},strong=${strongCount}`,
    !G5 && 'counter_evidence_not_yet_searched',
  ].filter(Boolean);

  const sufficient = G1 && G2 && G3 && G5;

  return {
    sufficient,
    stop: sufficient || G4_noProgress || Boolean(budget?.exhausted()),
    stopReason: sufficient ? 'sufficient'
      : budget?.exhausted() ? `budget_exhausted:${budget.reason()}`
        : G4_noProgress ? 'no_progress' : '',
    gates: {
      G1, G2, G3,
      G4_progress: !G4_noProgress,
      G5_counter_evidence_done: G5,
    },
    metrics: {
      termCoverage: Number(termCoverage.toFixed(3)),
      topScore: Number(topScore.toFixed(3)),
      strongCount,
      candidates: candidates.length,
      progress,
    },
    thresholds: {
      minTermCoverage: cfg.minTermCoverage,
      minTopScore: cfg.minTopScore,
      minChunkScore: cfg.minChunkScore,
      minChunks: cfg.minChunks,
      minTurns: cfg.minTurns,
    },
    gaps,
    uncovered,
  };
}

/** Human-readable gap list for the Insufficient Evidence explanation. */
export function describeGaps(gaps) {
  return gaps.map((g) => {
    const [kind, detail] = g.split(':');
    if (kind === 'missing_reference') return `we could not confirm we read ${detail}`;
    if (kind === 'uncovered_terms') return `no source passage mentioned ${detail.split(',').slice(0, 4).join(', ')}`;
    if (kind === 'weak_evidence') return 'no passage matched the claim strongly enough';
    return g;
  });
}
