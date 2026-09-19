/**
 * Deterministic seed queries for turn 1.
 *
 * The template table is claim-type driven. It is deliberately small and
 * printable: an examiner can read every query this system will ever issue on
 * turn 1, which is the whole argument for a rule-driven controller over an
 * LLM one at this layer.
 */
import { distinctiveTokens } from './idf.js';
import { squash } from '../util/text.js';

/**
 * @param {object} claim  the extracted sub-claim
 * @returns {string} a second dense query phrased the way the CORPUS phrases
 *   things, rather than the way a claim does
 */
export function templateQuery(claim) {
  const subject = squash(claim.text).replace(/^(under|according to|as per)\b[^,]*,\s*/i, '');
  switch (claim.claim_type) {
    case 'punishment_or_penalty':
      return `punishment prescribed and term of imprisonment for ${keyNoun(subject)}`;
    case 'statutory_content':
      return `text of the provision defining ${keyNoun(subject)}`;
    case 'procedural':
      return `procedure and requirements for ${keyNoun(subject)}`;
    case 'constitutional':
      return `constitutional guarantee and permitted restrictions regarding ${keyNoun(subject)}`;
    case 'case_holding':
      return `judgment holding on ${keyNoun(subject)}`;
    case 'legal_status_or_repeal':
      return `whether the provision on ${keyNoun(subject)} remains in force, was repealed, struck down or replaced`;
    case 'statistic':
      return `official figures relating to ${keyNoun(subject)}`;
    default:
      return `legal provision concerning ${keyNoun(subject)}`;
  }
}

/** A short noun-ish core of the claim, for slotting into a template. */
function keyNoun(text) {
  const trimmed = squash(text)
    .replace(/\b(is|are|was|were|shall|will|can|may|must)\b.*$/i, '')
    .trim();
  return (trimmed.length >= 12 ? trimmed : squash(text)).slice(0, 120);
}

/**
 * Counter-evidence query.
 *
 * Searching only for text that MATCHES the claim is confirmation-biased
 * retrieval, and it is the single easiest way for a fact checker to be
 * confidently wrong. A claim like "the RTI Act gives any citizen the right to
 * obtain information from any public authority" retrieves section 3 and stops
 * — while section 8(1), which exempts whole categories of information, is
 * never looked at, and the system reports Supported.
 *
 * So the loop also searches explicitly for what would QUALIFY or REFUTE the
 * claim, phrased in the register statutes actually use for exceptions.
 */
export function counterQuery(claim) {
  return `exceptions and limitations: notwithstanding anything in this Act there shall be no obligation, `
    + `this section shall not apply, provided that — concerning ${keyNoun(claim.text)}`;
}

/** Statutory qualifier language, as a pattern for literal search. */
export const QUALIFIER_PATTERN =
  '(notwithstanding|shall not apply|there shall be no obligation|nothing in this|not be enforceable|provided that|except)';

/**
 * The turn-1 query plan. Issued in parallel; the whole set counts as one
 * turn, because they are one decision rather than a sequence of them.
 */
export function planSeedQueries(claim) {
  const plan = [];

  plan.push({ tool: 'search_corpus', args: { query: claim.text }, label: 'claim as written' });
  const template = templateQuery(claim);
  if (template && template !== claim.text) {
    plan.push({ tool: 'search_corpus', args: { query: template }, label: `${claim.claim_type} template` });
  }

  for (const key of claim.ref_keys ?? []) {
    plan.push({
      tool: 'lookup_legal_reference',
      args: { ref_key: key, include_equivalents: true },
      label: `exact lookup ${key}`,
    });
  }

  // A literal search on the two rarest terms of the claim. Distinctive
  // wording is exactly what dense retrieval blurs and keyword search finds.
  const rare = distinctiveTokens(claim.text, 2);
  if (rare.length >= 2) {
    plan.push({
      tool: 'keyword_search',
      args: { regex: rare.map(escapeRegex).join('[\\s\\S]{0,400}') },
      label: `keyword: ${rare.join(' + ')}`,
    });
  } else if (rare.length === 1) {
    plan.push({ tool: 'keyword_search', args: { phrase: rare[0] }, label: `keyword: ${rare[0]}` });
  }

  // A case citation is a literal string; dense retrieval is useless on it.
  const citation = /\(\d{4}\)\s*\d+\s*[A-Z]{2,4}\s*\d+/.exec(claim.text);
  if (citation) {
    plan.push({ tool: 'keyword_search', args: { phrase: citation[0] }, label: `citation: ${citation[0]}` });
  }

  return plan;
}

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
