/**
 * The final verdict rule. A pure function: no model, no I/O, no clock.
 *
 * This is the piece that makes the four labels defensible. The verdict model
 * returns an ADVISORY `provisional_verdict`; it never decides anything. The
 * label a user sees comes from this table, driven only by evidence that
 * `citation/verifier.js` marked verified.
 *
 * Rules are evaluated top-down, first match wins, and R7 makes the table
 * exhaustive so there is no path that falls through to undefined.
 *
 * The design point worth defending in the report: **Misleading Context has
 * exactly two entrances and both require verified quoted text.** There is no
 * route to it from uncertainty, low retrieval scores, model hedging, or "the
 * answer feels complicated" — those all land on Insufficient Evidence via
 * R0/R6/R7. Uncertainty maps to abstention; Misleading Context requires
 * positive, verified evidence of the omission.
 */
import { config } from '../config/index.js';
import { QUALIFIER_RE } from '../util/stopwords.js';
import { N2 } from '../citation/normalize.js';

export const LABELS = {
  SUPPORTED: 'Supported',
  CONTRADICTED: 'Contradicted',
  MISLEADING: 'Misleading Context',
  INSUFFICIENT: 'Insufficient Evidence',
  NOT_CHECKABLE: 'Not Checkable',
};

/**
 * Weighted count of verified evidence taking a given stance.
 * partially_verified counts half: an approximate quote match is real
 * signal, but not the same as text that is demonstrably there.
 */
function weigh(items, stance) {
  const { weightVerified, weightPartial } = config.verdict;
  let total = 0;
  for (const it of items) {
    if (it.stance !== stance) continue;
    if (it.citation?.status === 'verified') total += weightVerified;
    else if (it.citation?.status === 'partially_verified') total += weightPartial;
  }
  return total;
}

/**
 * Fraction of the sub-claim covered by the claim spans of verified items.
 * Computed as a union over normalised character positions so two items
 * addressing the same half of a claim do not double-count it.
 */
export function coverage(subClaimText, items) {
  const claim = N2(subClaimText);
  if (!claim) return 0;
  const covered = new Array(claim.length).fill(false);
  for (const it of items) {
    if (it.citation?.status === 'rejected') continue;
    const span = N2(it.claim_span ?? '');
    if (!span) continue;
    const at = claim.indexOf(span);
    if (at < 0) continue;
    for (let i = at; i < at + span.length; i++) covered[i] = true;
  }
  return covered.filter(Boolean).length / claim.length;
}

/**
 * @param {object} o
 * @param {string} o.subClaimText
 * @param {Array}  o.items              per-evidence items with .citation attached
 * @param {string[]} o.refKeys          ref_keys the claim named ([] if none)
 * @param {string[]} o.verifiedRefKeys  ref_keys carried by verified evidence
 * @param {string[]} o.unaddressed      model's unaddressed_claim_aspects
 * @param {object}  o.missingCondition  model's missing_condition object
 * @returns {{label:string, rule_id:string, inputs:object, thresholds:object}}
 */
export function decide({
  subClaimText,
  items = [],
  refKeys = [],
  verifiedRefKeys = [],
  unaddressed = [],
  missingCondition = null,
}) {
  const S = weigh(items, 'supporting');
  const C = weigh(items, 'contradicting');
  const N = items.filter((i) => i.stance === 'neutral' && i.citation?.status === 'verified').length;

  const cov = coverage(subClaimText, items);

  // A claim that names a provision must be backed by evidence we can show
  // we actually read. Otherwise "Section 302 says X" could be marked
  // Supported off a passage that never mentions Section 302.
  const refOk = refKeys.length === 0 || refKeys.some((k) => verifiedRefKeys.includes(k));

  const U = (unaddressed ?? []).filter(Boolean);

  // The missing condition must survive the SAME citation verification as
  // every other quote. A "misleading" verdict cannot rest on an unverified
  // assertion that something is missing.
  const MCq = Boolean(
    missingCondition?.present
    && (!config.verdict.requireMissingConditionQuote || missingCondition.citation?.status === 'verified'),
  );

  // Deterministic second door: a verified passage that itself contains an
  // exception or qualifier, while the claim is not fully covered.
  const qualifier = items.some(
    (i) => i.citation?.status !== 'rejected' && QUALIFIER_RE.test(i.passage ?? ''),
  );

  const thresholds = {
    weightVerified: config.verdict.weightVerified,
    weightPartial: config.verdict.weightPartial,
    minEvidence: config.verdict.minEvidence,
    coverageFull: config.verdict.coverageFull,
    requireMissingConditionQuote: config.verdict.requireMissingConditionQuote,
  };
  const inputs = { S, C, N, coverage: Number(cov.toFixed(3)), refOk, unaddressed: U, MCq, qualifier, refKeys, verifiedRefKeys };

  const MIN = config.verdict.minEvidence;
  const FULL = config.verdict.coverageFull;
  const mcGate = MCq || (cov < FULL && qualifier);

  const out = (rule_id, label, why) => ({ label, rule_id, why, inputs, thresholds });

  // R0 — nothing was verified at all. Covers nothing-retrieved,
  // neutral-only, and every-quote-rejected in one rule.
  if (S + C === 0) {
    return out('R0', LABELS.INSUFFICIENT,
      'No cited passage could be verified against its source, so there is nothing to decide from.');
  }

  // R1 — the claim names a provision we cannot show we read.
  if (!refOk) {
    return out('R1', LABELS.INSUFFICIENT,
      `The claim refers to ${refKeys.join(', ')}, but no verified passage came from that provision.`);
  }

  // R2 — verified evidence states the opposite.
  if (C >= MIN && S < C) {
    return out('R2', LABELS.CONTRADICTED,
      'Verified source text contradicts the claim.');
  }

  // R3 — verified support, nothing against it, and the whole claim is covered.
  //
  // `!mcGate` is what keeps the table honest at this row. Without it, a claim
  // whose evidence set contains a VERIFIED missing condition would still be
  // labelled Supported purely because the supporting passage happened to
  // cover the claim text — full coverage would silently outrank a proven
  // omission. Excluding the gate here (rather than reordering the rules)
  // keeps evaluation order and rule numbering identical, so the table still
  // reads top-down, first match wins.
  if (S >= MIN && C === 0 && cov >= FULL && U.length === 0 && !mcGate) {
    return out('R3', LABELS.SUPPORTED,
      'Verified source text supports the claim, and no part of the claim is left unaddressed.');
  }

  // R4 — true as far as it goes, but a verified condition or exception is missing.
  if (S >= MIN && C === 0 && mcGate) {
    return out('R4', LABELS.MISLEADING,
      MCq
        ? 'The claim is supported as far as it goes, but a verified passage states a condition or exception the claim omits.'
        : 'The claim is only partly covered by the evidence, and a verified passage contains a qualifying exception the claim omits.');
  }

  // R5 — verified evidence on both sides: true in one scope, false in another.
  if (S >= MIN && C >= MIN && S >= C) {
    return out('R5', LABELS.MISLEADING,
      'Verified passages both support and contradict the claim, so it holds in one scope but not another.');
  }

  // R6 — only approximate quote matches survived.
  if (S + C > 0 && S + C < MIN) {
    return out('R6', LABELS.INSUFFICIENT,
      'Only approximate quote matches were found; that is not strong enough to assert a verdict.');
  }

  // R7 — fail closed (FR18).
  return out('R7', LABELS.INSUFFICIENT,
    'The verified evidence does not cover the claim well enough to reach a confident verdict.');
}
