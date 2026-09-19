/**
 * Stage 4 — the evidence-based verdict (FR13, FR14).
 *
 * One structured call, temperature 0, NO tools — so the structured-output /
 * googleSearch incompatibility never arises here.
 *
 * The model never sees a URL, a chunk id or a retrieval score, and
 * `evidence_id` is a schema `enum` over the ids actually supplied. Anything
 * that still arrives out of set is dropped and raises a warning, which would
 * itself be a finding worth reporting.
 */
import { generateStructured } from '../../providers/gemini/generate.js';
import { buildVerdictSchema, buildRequoteSchema } from '../../providers/gemini/schemas/index.js';
import { VERDICT_SYSTEM, verdictPrompt } from '../../prompts/verdict.prompt.js';
import { REQUOTE_SYSTEM, requotePrompt } from '../../prompts/requote.prompt.js';
import { buildEvidencePacket, subsetPacket } from '../../verdict/evidencePacket.js';
import { config } from '../../config/index.js';

export async function runVerdict({ claim, evidence, emit }) {
  const { packet, ids, byId } = buildEvidencePacket(evidence);

  emit({
    stage: 'verdict', type: 'stage_start',
    label: `Comparing the claim against ${ids.length} retrieved passage(s)`,
    sub_claim_id: claim.id,
    detail: { evidence_ids: ids, packet_chars: packet.length },
  });

  const { data, usage, ms, model } = await generateStructured({
    role: 'verdict',
    contents: verdictPrompt({ claim, evidencePacket: packet, refKeys: claim.ref_keys }),
    schema: buildVerdictSchema(ids),
    system: VERDICT_SYSTEM,
    temperature: config.gemini.tempVerdict,
    maxOutputTokens: config.gemini.maxOutputTokensVerdict,
    label: 'verdict',
  });

  // Belt and braces behind the schema enum.
  const valid = [];
  const invalid = [];
  for (const item of data.per_evidence ?? []) {
    if (ids.includes(item.evidence_id)) valid.push(item);
    else invalid.push(item);
  }
  if (invalid.length) {
    emit({
      stage: 'verdict', type: 'warning',
      label: `Dropped ${invalid.length} citation(s) referring to evidence that was never supplied`,
      sub_claim_id: claim.id,
      detail: { invalid },
    });
  }

  const missingCondition = data.missing_condition?.present && ids.includes(data.missing_condition.evidence_id)
    ? data.missing_condition
    : { present: false };

  emit({
    stage: 'verdict', type: 'llm_result',
    label: `Model's provisional read: ${data.provisional_verdict} (advisory only)`,
    sub_claim_id: claim.id,
    detail: {
      model,
      provisional_verdict: data.provisional_verdict,
      provisional_reason: data.provisional_reason,
      per_evidence: valid,
      unaddressed_claim_aspects: data.unaddressed_claim_aspects ?? [],
      missing_condition: missingCondition,
    },
    duration_ms: ms,
    tokens: usage,
  });

  return {
    items: valid,
    droppedItems: invalid,
    unaddressed: data.unaddressed_claim_aspects ?? [],
    missingCondition,
    provisionalVerdict: data.provisional_verdict,
    provisionalReason: data.provisional_reason,
    packet, ids, byId,
    usage, ms, model,
  };
}

/**
 * The single re-quote call. Its schema deliberately carries no `stance` and
 * no verdict — see `citation/verifier.js` for why.
 */
export function makeRequoter({ claim, byId, ids, emit }) {
  return async function requote(rejected) {
    const wanted = rejected.map((r) => r.evidence_id);
    const { data, usage, ms, model } = await generateStructured({
      role: 'verdict',
      contents: requotePrompt({
        claim,
        evidencePacket: subsetPacket(byId, wanted),
        rejected,
      }),
      schema: buildRequoteSchema(ids),
      system: REQUOTE_SYSTEM,
      temperature: 0,
      label: 'requote',
    });
    emit({
      stage: 'citation', type: 'llm_result',
      label: `Received ${data.per_evidence?.length ?? 0} corrected quote(s)`,
      sub_claim_id: claim.id,
      detail: { model, per_evidence: data.per_evidence ?? [] },
      duration_ms: ms,
      tokens: usage,
    });
    return data.per_evidence ?? [];
  };
}
