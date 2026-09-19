/**
 * Stage 2 — claim extraction (FR4, FR5, FR6).
 *
 * Two things happen here that are worth pointing at in the report:
 *
 *   1. `ref_key` is DERIVED IN CODE from the model's raw references, using
 *      the controlled vocabulary in `corpus/refKey.js`, and a regex backstop
 *      re-scans the claim text in case the model missed one. Model output is
 *      untrusted input; the key that drives an exact database lookup must be
 *      computed rather than asserted.
 *
 *   2. If nothing is checkable, the pipeline emits `Not Checkable` and STOPS
 *      HERE — before any Chroma query and before the verdict model. The
 *      trace for such a run is two events long, and that visibly demonstrates
 *      the guard rather than merely claiming it.
 */
import { generateStructured } from '../../providers/gemini/generate.js';
import { claimExtractionSchema } from '../../providers/gemini/schemas/index.js';
import { CLAIM_EXTRACTION_SYSTEM, claimExtractionPrompt } from '../../prompts/claimExtraction.prompt.js';
import { buildRefKey, extractReferences, actCodeFor } from '../../corpus/refKey.js';
import { config } from '../../config/index.js';

export async function runClaimExtraction({ text, sourceUrl, emit }) {
  emit({ stage: 'claim_extraction', type: 'stage_start', label: 'Identifying checkable factual claims' });

  const { data, usage, ms, model } = await generateStructured({
    role: 'extraction',
    contents: claimExtractionPrompt({ text, sourceUrl }),
    schema: claimExtractionSchema,
    system: CLAIM_EXTRACTION_SYSTEM,
    temperature: config.gemini.tempExtraction,
    label: 'claim_extraction',
  });

  emit({
    stage: 'claim_extraction', type: 'llm_result',
    label: `Model returned ${data.claims?.length ?? 0} claim(s)`,
    detail: { model, ...data },
    duration_ms: ms,
    tokens: usage,
  });

  const all = (data.claims ?? []).map((c, i) => enrich(c, i, text));
  const checkable = all.filter((c) => c.checkability === 'checkable');
  const skipped = all.filter((c) => c.checkability !== 'checkable');

  emit({
    stage: 'claim_extraction', type: 'decision',
    label: checkable.length === 0
      ? 'Nothing here is a checkable factual claim — stopping before retrieval'
      : `${checkable.length} checkable claim(s); ${skipped.length} skipped`,
    detail: {
      gate: 'checkability',
      checkable: checkable.map((c) => ({ id: c.id, text: c.text, claim_type: c.claim_type, ref_keys: c.ref_keys })),
      skipped: skipped.map((c) => ({ id: c.id, text: c.text, checkability: c.checkability, reason: c.checkability_reason })),
      max_subclaims: config.claims.maxSubclaims,
    },
  });

  // Claims that name a provision go first: they have the strongest retrieval
  // path, so if the cap bites, it bites the vaguest claim rather than the
  // most answerable one.
  const ordered = [...checkable].sort((a, b) => (b.ref_keys.length - a.ref_keys.length));
  const selected = ordered.slice(0, config.claims.maxSubclaims);
  const dropped = ordered.slice(config.claims.maxSubclaims);

  if (dropped.length) {
    emit({
      stage: 'claim_extraction', type: 'progress',
      label: `Checking the first ${selected.length} of ${ordered.length} claims (MAX_SUBCLAIMS)`,
      detail: { dropped: dropped.map((c) => c.text) },
    });
  }

  emit({ stage: 'claim_extraction', type: 'stage_end', label: `Extraction complete`, duration_ms: ms });

  return {
    claims: selected,
    skipped: [...skipped, ...dropped.map((c) => ({ ...c, checkability: 'over_subclaim_limit', checkability_reason: 'Not checked in this run because of the per-request claim limit.' }))],
    inputLanguage: data.input_language ?? 'en',
    overallCheckable: checkable.length > 0,
    notCheckableReason: data.not_checkable_reason ?? '',
    usage,
  };
}

/** Attach derived ref_keys and normalise the claim record. */
function enrich(claim, index, sourceText) {
  const keys = new Set();

  for (const ref of claim.legal_refs ?? []) {
    const act = ref.act_code && ref.act_code !== 'UNKNOWN'
      ? ref.act_code
      : actCodeFor(ref.act_name || ref.raw);
    const key = buildRefKey({
      act_code: act,
      section: ref.section,
      subsection: ref.subsection,
      article: ref.article,
      clause: ref.clause,
    });
    if (key) keys.add(key);
  }

  // Code-side backstop: re-scan the claim (and, if the claim itself carries
  // no reference, the whole source text) so a model omission does not lose
  // the exact-lookup path.
  for (const r of extractReferences(claim.text)) keys.add(r.ref_key);
  if (keys.size === 0) {
    for (const r of extractReferences(sourceText)) keys.add(r.ref_key);
  }

  return {
    id: claim.id || `c${index + 1}`,
    text: String(claim.text ?? '').trim(),
    text_en: claim.text_en || claim.text,
    claim_type: claim.claim_type ?? 'other',
    checkability: claim.checkability ?? 'checkable',
    checkability_reason: claim.checkability_reason ?? '',
    assertion_polarity: claim.assertion_polarity ?? 'affirmative',
    hedged: Boolean(claim.hedged),
    legal_refs: claim.legal_refs ?? [],
    entities: claim.entities ?? {},
    quantities: claim.quantities ?? [],
    ref_keys: [...keys],
  };
}
