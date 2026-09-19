/**
 * Citation verification — the only module allowed to mark an item verified.
 *
 * `verdict/decisionTable.js` counts nothing this file did not bless, and
 * nothing else in the codebase writes `citation.status`. Together those two
 * facts are what make "an unverified quote cannot support the verdict" a
 * structural property rather than a convention.
 *
 * THE SINGLE RE-REQUEST, AND WHY IT PROVABLY TERMINATES
 *
 *   - `attempt` is a local on a straight-line path. There is no loop and no
 *     recursion around the re-quote call, and exactly one call site.
 *   - MAX is `Math.min(config.citation.maxRetries, 1)`, and the config module
 *     itself clamps that key to 1, so `CITATION_MAX_RETRIES=99` in .env
 *     cannot create a loop.
 *   - Re-verification runs the identical `verifyOne`, so a second failure
 *     cannot be re-queued.
 *
 * Two rules stop the model gaming the retry:
 *   1. The requote schema carries no `stance` and no verdict. Told its quote
 *      failed, a model will otherwise flip a stance to neutral to make the
 *      problem go away. Stance is frozen from attempt 0.
 *   2. `wrong_source` rejections are NOT retried. Quoting E3's text under
 *      E1's id is a provenance error, not a transcription error, and it
 *      stays on the record.
 */
import { matchQuote, withMatchedText } from './match.js';
import { runGuards, applyGuards, statusForSimilarity, truncateQuote } from './guards.js';
import { config } from '../config/index.js';
import { passageForChunk, readSource } from '../corpus/sourceStore.js';

/**
 * Verify one model claim about one evidence item.
 *
 * The quote is matched ONLY against the passage of the evidence id the model
 * cited. If it fails there but matches a different item, that is reported as
 * `wrong_source` rather than quietly accepted.
 */
export function verifyOne({ item, evidence, byId, attempt = 0 }) {
  const ev = byId.get(item.evidence_id);
  if (!ev) {
    return {
      status: 'rejected', tier: 'none', similarity: 0, span: null,
      guards_fired: ['unknown_evidence_id'],
      reason: `The model cited "${item.evidence_id}", which was not in the evidence set.`,
      attempt,
    };
  }

  const rawQuote = String(item.verbatim_quote ?? '');
  if (!rawQuote.trim()) {
    return {
      status: 'rejected', tier: 'none', similarity: 0, span: null,
      guards_fired: ['empty_quote'],
      reason: 'No quote was supplied for this passage.',
      attempt,
    };
  }

  const { quote, truncated } = truncateQuote(rawQuote);

  // Match against the SOURCE OF TRUTH, not against whatever text happened to
  // survive into the evidence packet: the packet is truncated for the model,
  // and a quote near the tail would otherwise fail for the wrong reason.
  const sourceText = resolveSourceText(ev);

  const match = withMatchedText(sourceText, matchQuote(sourceText, quote));
  const guards = runGuards({
    quote, matchedText: match.matchedText, match, sourceType: ev.sourceType,
  });
  let status = applyGuards(statusForSimilarity(match), guards);
  let reason = '';

  if (status === 'rejected' && match.tier === 'none') {
    // Did it come from somewhere else in the set? That is a different, worse
    // failure than a mistranscription, and it is not retryable.
    const elsewhere = findElsewhere(byId, ev.evidence_id, quote);
    if (elsewhere) {
      guards.push({ id: 'wrong_source', action: 'reject', reason: `The quote appears in ${elsewhere} rather than ${ev.evidence_id}.` });
      reason = `Quote attributed to ${ev.evidence_id} but actually found in ${elsewhere}.`;
    } else {
      reason = 'The quote does not appear in the cited passage.';
    }
  } else if (status === 'rejected') {
    reason = guards.find((g) => g.action === 'reject')?.reason ?? 'Quote verification failed.';
  } else if (status === 'partially_verified') {
    reason = guards.find((g) => g.action === 'demote')?.reason
      ?? `Approximate match (${match.similarity.toFixed(2)}), below the ${config.citation.fuzzyVerify} verification threshold.`;
  }

  return {
    status,
    tier: match.tier,
    similarity: Number(match.similarity.toFixed(4)),
    span: match.span,
    matchedText: match.matchedText,
    guards_fired: guards.map((g) => g.id),
    guards,
    reason,
    truncated,
    threshold: config.citation.fuzzyVerify,
    attempt,
  };
}

/** Prefer the stored full document text; fall back to the packet passage. */
function resolveSourceText(ev) {
  const meta = ev.meta ?? {};
  if (meta.doc_id && Number.isFinite(Number(meta.char_start))) {
    const fromStore = passageForChunk(meta.doc_id, Number(meta.char_start), Number(meta.char_end));
    if (fromStore) return fromStore;
    const whole = readSource(meta.doc_id);
    if (whole?.text) return whole.text;
  }
  return ev.fullText || ev.passage || '';
}

function findElsewhere(byId, excludeId, quote) {
  for (const [id, other] of byId) {
    if (id === excludeId) continue;
    const m = matchQuote(resolveSourceText(other), quote);
    if (m.tier === 'exact' || m.tier === 'normalized' || m.similarity >= config.citation.fuzzyVerify) return id;
  }
  return null;
}

/** Verify every item of one verdict response. */
export function verifyAll({ items, byId }) {
  return items.map((item) => ({ item, citation: verifyOne({ item, byId }) }));
}

/**
 * Full verification with the single re-request.
 *
 * @param {object} o
 * @param {Array}  o.items            per_evidence from the verdict model
 * @param {Map}    o.byId             evidence packet index
 * @param {(rejected:Array)=>Promise<Array>} o.requote  performs the one retry
 * @param {(e:object)=>void} [o.emit] trace emitter
 */
export async function verifyWithRetry({ items, byId, requote, emit = () => {} }) {
  const MAX = Math.min(config.citation.maxRetries, 1);
  let attempt = 0;

  const report = verifyAll({ items, byId });
  for (const r of report) traceOne(emit, r, 0);

  const retryable = report.filter(
    (r) => r.citation.status === 'rejected' && !r.citation.guards_fired.includes('wrong_source'),
  );

  if (retryable.length > 0 && attempt < MAX && typeof requote === 'function') {
    attempt = 1; // increments exactly once; no loop, no recursion
    emit({
      stage: 'citation', type: 'llm_call',
      label: `Re-requesting ${retryable.length} quote${retryable.length === 1 ? '' : 's'} that failed verification`,
      detail: {
        attempt,
        rejected: retryable.map((r) => ({
          evidence_id: r.item.evidence_id,
          quote: r.item.verbatim_quote,
          reason: r.citation.reason,
          similarity: r.citation.similarity,
        })),
      },
    });

    let corrected = [];
    try {
      corrected = await requote(retryable.map((r) => ({
        evidence_id: r.item.evidence_id,
        quote: r.item.verbatim_quote,
        reason: r.citation.reason,
        similarity: r.citation.similarity,
        threshold: config.citation.fuzzyVerify,
      })));
    } catch (err) {
      emit({ stage: 'citation', type: 'warning', label: `Re-quote request failed: ${err.message}`, detail: { error: err.message } });
    }

    for (const fix of corrected ?? []) {
      const target = report.find((r) => r.item.evidence_id === fix.evidence_id && r.citation.status === 'rejected');
      if (!target) continue;
      if (!String(fix.verbatim_quote ?? '').trim()) {
        // An empty string is an allowed answer: the model is saying no
        // suitable unbroken run exists. That is honest, and better than a
        // second invented quote.
        target.citation.reason = 'The model confirmed no verifiable quote exists in this passage.';
        target.citation.guards_fired = [...target.citation.guards_fired, 'requote_declined'];
        continue;
      }
      // Stance is FROZEN from attempt 0 — only the quote and span may change.
      const merged = { ...target.item, verbatim_quote: fix.verbatim_quote, claim_span: fix.claim_span ?? target.item.claim_span };
      const recheck = verifyOne({ item: merged, byId, attempt: 1 });
      target.item = merged;
      target.citation = recheck;
      traceOne(emit, target, 1);
    }
  }

  // Anything still rejected is rejected permanently. No further calls.
  return report;
}

function traceOne(emit, r, attempt) {
  emit({
    stage: 'citation',
    type: 'decision',
    label: `${r.item.evidence_id}: ${describe(r.citation)}`,
    detail: {
      gate: 'citation_verification',
      evidence_id: r.item.evidence_id,
      attempt,
      status: r.citation.status,
      tier: r.citation.tier,
      similarity: r.citation.similarity,
      guards_fired: r.citation.guards_fired,
      guards: r.citation.guards,
      reason: r.citation.reason,
      thresholds: {
        verify: config.citation.fuzzyVerify,
        partial: config.citation.fuzzyPartial,
        minQuoteChars: config.citation.minQuoteChars,
      },
      quote: r.item.verbatim_quote,
      matched: r.citation.matchedText,
    },
  });
}

function describe(c) {
  if (c.status === 'verified') {
    return c.tier === 'exact' ? 'quote matched the source exactly'
      : c.tier === 'normalized' ? 'quote matched after normalising punctuation'
        : `quote matched closely (${c.similarity.toFixed(2)})`;
  }
  if (c.status === 'partially_verified') return `approximate match (${c.similarity.toFixed(2)}) — counted at half weight`;
  return `REJECTED — ${c.reason}`;
}
