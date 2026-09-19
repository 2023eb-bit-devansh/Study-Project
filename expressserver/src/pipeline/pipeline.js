/**
 * The six-stage orchestrator.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THE EVIDENCE-FIRST INVARIANT LIVES HERE.
 *
 *  `runVerdict` is called from exactly one place in this file, and that call
 *  site is guarded by `evidence.length === 0`. An empty evidence set returns
 *  Insufficient Evidence directly, with zero model cost and without the
 *  verdict model ever seeing the claim.
 *
 *  The other half of the invariant is in `citation/verifier.js`, the only
 *  module that may set `citation.status = 'verified'`, and
 *  `verdict/decisionTable.js`, which counts nothing else.
 *
 *  Nothing may bypass either.
 * ════════════════════════════════════════════════════════════════════════
 */
import { runInputStage } from './stages/01_input.js';
import { runClaimExtraction } from './stages/02_claimExtraction.js';
import { retrievalAgent } from '../retrieval/agent.js';
import { runVerdict, makeRequoter } from './stages/04_verdict.js';
import { verifyWithRetry } from '../citation/verifier.js';
import { assembleSubClaim, assembleResult, DISCLAIMER } from './stages/06_assembly.js';
import { LABELS } from '../verdict/decisionTable.js';
import { describeGaps } from '../retrieval/sufficiency.js';
import { timer } from '../util/time.js';
import { AppError } from '../util/errors.js';

class Cancelled extends Error {
  constructor() { super('Cancelled by the user'); this.name = 'Cancelled'; }
}

/**
 * @param {object} o
 * @param {object} o.job
 * @param {(e:object)=>void} o.emit
 * @param {()=>boolean} o.cancelled
 * @param {(patch:object)=>void} o.onProgress  writes back to the job record
 */
export async function runPipeline({ job, emit, cancelled, onProgress }) {
  const timings = {};
  const usage = { calls: 0, promptTokens: 0, outputTokens: 0 };

  const track = (stage, u) => {
    if (!u) return;
    usage.calls += 1;
    usage.promptTokens += u.prompt ?? 0;
    usage.outputTokens += u.output ?? 0;
    onProgress?.({ usage: { ...usage, costUsd: 0 } });
  };
  const guard = () => { if (cancelled()) throw new Cancelled(); };

  try {
    // ── Stage 1 — input ────────────────────────────────────────────────
    let text = job.confirmedText;
    if (!text) {
      const t = timer();
      const input = await runInputStage({ job, emit });
      timings.input = Math.round(t.ms());
      track('input', input.usage);

      if (input.needsConfirmation) {
        // The job parks here. `POST /api/verify/:id/confirm` resumes it with
        // the user's corrected text.
        onProgress?.({ status: 'awaiting_confirmation', transcription: input.transcription, timings });
        return { paused: true };
      }
      text = input.text;
    }
    guard();

    // ── Stage 2 — claim extraction ─────────────────────────────────────
    const t2 = timer();
    const extraction = await runClaimExtraction({ text, sourceUrl: job.input.sourceUrl, emit });
    timings.claim_extraction = Math.round(t2.ms());
    track('claim_extraction', extraction.usage);
    guard();

    // Not Checkable: stop BEFORE retrieval and before the verdict model.
    // Zero Chroma queries, zero verdict cost, a two-event trace.
    if (extraction.claims.length === 0) {
      const result = assembleResult({ subResults: [], skipped: extraction.skipped, emit });
      onProgress?.({ timings, usage: { ...usage, costUsd: 0 } });
      return { result, timings, usage };
    }

    // ── Stages 3-5, per sub-claim ──────────────────────────────────────
    const subResults = [];
    for (const claim of extraction.claims) {
      guard();

      const t3 = timer();
      const retrieval = await retrievalAgent({
        claim,
        emit,
        cancelled,
      });
      timings.retrieval = (timings.retrieval ?? 0) + Math.round(t3.ms());
      track('retrieval', { prompt: retrieval.usage.promptTokens, output: retrieval.usage.outputTokens });
      guard();

      // ══ THE INVARIANT ══════════════════════════════════════════════
      if (retrieval.evidence.length === 0) {
        emit({
          stage: 'verdict', type: 'decision',
          label: 'No evidence retrieved — the verdict model is not called',
          sub_claim_id: claim.id,
          detail: {
            gate: 'evidence_first_invariant',
            rule: 'The verdict stage is never called without a ranked evidence set.',
            evidence_count: 0,
            gaps: retrieval.gaps,
          },
        });
        subResults.push(emptyEvidenceResult(claim, retrieval));
        continue;
      }
      // ═══════════════════════════════════════════════════════════════

      const t4 = timer();
      const verdict = await runVerdict({ claim, evidence: retrieval.evidence, emit });
      timings.verdict = (timings.verdict ?? 0) + Math.round(t4.ms());
      track('verdict', verdict.usage);
      guard();

      const t5 = timer();
      emit({
        stage: 'citation', type: 'stage_start',
        label: `Checking ${verdict.items.length} quote(s) against the real source text`,
        sub_claim_id: claim.id,
      });
      const report = await verifyWithRetry({
        items: verdict.items,
        byId: verdict.byId,
        requote: makeRequoter({ claim, byId: verdict.byId, ids: verdict.ids, emit }),
        emit,
      });
      const verified = report.filter((r) => r.citation.status === 'verified').length;
      const partial = report.filter((r) => r.citation.status === 'partially_verified').length;
      const rejected = report.filter((r) => r.citation.status === 'rejected').length;
      emit({
        stage: 'citation', type: 'stage_end',
        label: `${verified} verified, ${partial} partial, ${rejected} rejected`,
        sub_claim_id: claim.id,
        detail: { verified, partial, rejected },
      });
      timings.citation = (timings.citation ?? 0) + Math.round(t5.ms());
      guard();

      subResults.push(assembleSubClaim({ claim, retrieval, verdict, report, emit }));
    }

    const result = assembleResult({ subResults, skipped: extraction.skipped, emit });
    onProgress?.({ timings, usage: { ...usage, costUsd: 0 } });
    return { result, timings, usage };
  } catch (err) {
    if (err instanceof Cancelled) return { cancelled: true, timings, usage };
    emit({
      stage: 'assembly', type: 'error',
      label: err instanceof AppError ? err.message : `Pipeline failed: ${err.message}`,
      detail: { code: err.code ?? 'internal_error', message: err.message, detail: err.detail },
    });
    throw err;
  }
}

/** Result for a sub-claim whose retrieval found nothing at all. */
function emptyEvidenceResult(claim, retrieval) {
  const gaps = describeGaps(retrieval.gaps ?? []);
  return {
    id: claim.id,
    text: claim.text,
    claim_type: claim.claim_type,
    checkability: claim.checkability,
    ref_keys: claim.ref_keys ?? [],
    label: LABELS.INSUFFICIENT,
    rule_id: 'R0',
    explanation:
      'No source passage could be retrieved for this claim, so there is nothing to decide from.'
      + (gaps.length ? ` Specifically, ${gaps.join('; ')}.` : '')
      + ' The verdict model was not called.',
    provisional_verdict: null,
    evidence: [],
    decision: {
      label: LABELS.INSUFFICIENT,
      rule_id: 'R0',
      why: 'Retrieval returned no evidence, so the verdict stage was skipped entirely.',
      inputs: { S: 0, C: 0, N: 0, coverage: 0, refOk: false, unaddressed: [], MCq: false, qualifier: false },
      thresholds: {},
    },
    retrieval: {
      sufficiency: retrieval.sufficiency,
      gaps: retrieval.gaps,
      turns: retrieval.turns,
      tool_calls: retrieval.toolCalls,
      web_used: retrieval.webUsed,
      stop_reason: retrieval.stopReason,
      metrics: retrieval.metrics,
      gates: retrieval.gates,
    },
  };
}

export { DISCLAIMER };
