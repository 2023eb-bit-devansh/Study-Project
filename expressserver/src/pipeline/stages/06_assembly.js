/**
 * Stage 6 — result assembly (FR17, FR18, FR19).
 *
 * The deterministic decision table runs here, and its inputs, thresholds and
 * firing rule are emitted as a `decision` trace event. The dashboard renders
 * that with the firing row highlighted and the real numbers substituted —
 * one screenshot that answers "how did it decide?" completely.
 */
import { decide, LABELS } from '../../verdict/decisionTable.js';
import { aggregate, explain } from '../../verdict/aggregate.js';
import { describeGaps } from '../../retrieval/sufficiency.js';
import { sourceLabel } from '../../corpus/metadata.js';

export const DISCLAIMER =
  'This is an automated evidence check, not legal advice. It reports what the retrieved sources say '
  + 'and whether each quotation could be matched back to its source. Always consult a qualified lawyer '
  + 'before acting on any legal question.';

/** Build the user-facing result for one sub-claim. */
export function assembleSubClaim({ claim, retrieval, verdict, report, emit }) {
  const items = (report ?? []).map(({ item, citation }) => {
    const ev = verdict.byId.get(item.evidence_id);
    return {
      evidence_id: item.evidence_id,
      chunk_id: ev?.chunk_id ?? '',
      source_label: ev?.sourceLabel ?? sourceLabel(ev?.meta ?? {}),
      source_url: ev?.sourceUrl || null,
      source_type: ev?.sourceType ?? 'corpus',
      status_meta: ev?.meta?.status ?? null,
      passage: ev?.passage ?? '',
      stance: item.stance,
      claim_span: item.claim_span ?? '',
      verbatim_quote: item.verbatim_quote ?? '',
      reasoning: item.reasoning ?? '',
      retrieval_score: ev?.score ?? 0,
      score_components: ev?.components ?? null,
      citation: {
        status: citation.status,
        tier: citation.tier,
        similarity: citation.similarity,
        guards_fired: citation.guards_fired,
        reason: citation.reason,
        // Offsets into `passage`, so the UI can highlight the verified run.
        span: citation.span,
        attempt: citation.attempt,
      },
    };
  });

  // Which of the provisions the claim named are actually backed by a
  // verified passage? This is what gate R1 consumes.
  const verifiedRefKeys = [];
  for (const it of items) {
    if (it.citation.status !== 'verified') continue;
    const ev = verdict.byId.get(it.evidence_id);
    const meta = ev?.meta ?? {};
    if (meta.ref_key) verifiedRefKeys.push(meta.ref_key);
    if (meta.ref_key_alt) verifiedRefKeys.push(meta.ref_key_alt);
  }

  // The missing condition is verified by the SAME machinery as every other
  // quote — there is no privileged path to Misleading Context.
  const mcItem = verdict.missingCondition?.present
    ? items.find((i) => i.evidence_id === verdict.missingCondition.evidence_id)
    : null;
  const missingCondition = verdict.missingCondition?.present
    ? { ...verdict.missingCondition, citation: mcItem?.citation ?? { status: 'rejected' } }
    : null;

  const decision = decide({
    subClaimText: claim.text,
    items,
    refKeys: claim.ref_keys ?? [],
    verifiedRefKeys,
    unaddressed: verdict.unaddressed,
    missingCondition,
  });

  emit({
    stage: 'assembly', type: 'decision',
    label: `${decision.rule_id} → ${decision.label}`,
    sub_claim_id: claim.id,
    detail: {
      gate: 'final_decision_table',
      ...decision,
      provisional_verdict: verdict.provisionalVerdict,
      // The delta between the model's unconstrained read and the
      // evidence-gated label is one of the most interesting numbers in the
      // evaluation, so it is recorded on every run.
      differs_from_provisional: decision.label !== verdict.provisionalVerdict,
    },
  });

  return {
    id: claim.id,
    text: claim.text,
    claim_type: claim.claim_type,
    checkability: claim.checkability,
    ref_keys: claim.ref_keys ?? [],
    label: decision.label,
    rule_id: decision.rule_id,
    explanation: buildExplanation(decision, retrieval, verdict),
    provisional_verdict: verdict.provisionalVerdict,
    evidence: items,
    decision,
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

/** Plain language for someone with no legal training (NFR 4.3). */
function buildExplanation(decision, retrieval, verdict) {
  const base = decision.why;
  if (decision.label !== LABELS.INSUFFICIENT) {
    return verdict.provisionalReason ? `${base} ${verdict.provisionalReason}` : base;
  }
  const gaps = describeGaps(retrieval.gaps ?? []);
  const detail = gaps.length ? ` Specifically, ${gaps.join('; ')}.` : '';
  const truncated = retrieval.budgetExhausted
    ? ' The search was stopped at its step limit, so this is not a conclusion that no such evidence exists.'
    : '';
  return `${base}${detail}${truncated}`;
}

/** The whole-request result. */
export function assembleResult({ subResults, skipped, emit }) {
  if (subResults.length === 0) {
    const label = LABELS.NOT_CHECKABLE;
    emit({
      stage: 'assembly', type: 'decision',
      label: `${label} — no factual claim to check`,
      detail: { gate: 'final_decision_table', label, rule_id: 'NC', skipped },
    });
    return {
      label,
      explanation: skipped.length
        ? `Nothing here can be fact-checked. ${skipped[0].checkability_reason || ''}`.trim()
        : 'No checkable factual claim was found in the submitted content.',
      sub_claims: [],
      skipped_claims: skipped,
      disclaimer: DISCLAIMER,
    };
  }

  const { label, rule } = aggregate(subResults);
  emit({
    stage: 'assembly', type: 'stage_end',
    label: `Final verdict: ${label}`,
    detail: { label, aggregation_rule: rule, per_claim: subResults.map((r) => ({ id: r.id, label: r.label, rule_id: r.rule_id })) },
  });

  return {
    label,
    explanation: explain(label, subResults),
    aggregation_rule: rule,
    sub_claims: subResults,
    skipped_claims: skipped,
    disclaimer: DISCLAIMER,
  };
}
