/**
 * Structured-output schemas.
 *
 * The one that matters most is `verdictSchema`: `evidence_id` is an `enum`
 * built from the evidence set actually supplied, which makes "cite only what
 * you were given" a DECODE-TIME constraint rather than a polite request in a
 * prompt. Anything that still slips through is dropped post-parse and raises
 * a warning trace event — and if that warning ever fires, it is a finding
 * worth reporting.
 */
import { Type } from '@google/genai';
import { ACT_CODES } from '../../../corpus/refKey.js';

export const CLAIM_TYPES = [
  'statutory_content', 'punishment_or_penalty', 'procedural', 'constitutional',
  'case_holding', 'legal_status_or_repeal', 'statistic', 'other',
];

export const CHECKABILITY = [
  'checkable', 'opinion', 'normative_or_value', 'satire_or_humour',
  'prediction', 'legal_advice_request', 'unfalsifiable', 'insufficient_context',
];

/** Stage 1 — image transcription. Transcription ONLY; no interpretation. */
export const imageTranscriptionSchema = {
  type: Type.OBJECT,
  properties: {
    contains_text: { type: Type.BOOLEAN, description: 'Whether the image contains any readable text at all.' },
    transcribed_text: {
      type: Type.STRING,
      description: 'The visible text, verbatim. Use the literal token [illegible] for any run you cannot read.',
    },
    legibility: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
    layout_note: { type: Type.STRING, description: 'What kind of image this is, e.g. "screenshot of a tweet", "photo of a newspaper column". Max 100 chars.' },
    illegible_spans: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Short descriptions of the unreadable parts.' },
  },
  required: ['contains_text', 'transcribed_text', 'legibility'],
};

/**
 * Stage 2 — claim extraction.
 *
 * Deliberately ABSENT: `ref_key`. The model returns the raw reference and a
 * best-effort parse; `corpus/refKey.js` derives the canonical key from a
 * controlled vocabulary. Model output is untrusted input, and the key that
 * drives an exact database lookup must be computed rather than asserted.
 */
export const claimExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    input_language: { type: Type.STRING, description: 'BCP-47 tag of the input, e.g. "en", "hi".' },
    overall_checkable: { type: Type.BOOLEAN },
    not_checkable_reason: { type: Type.STRING, description: 'Empty when overall_checkable is true. Max 200 chars.' },
    claims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: '"c1", "c2", ...' },
          text: { type: Type.STRING, description: 'One atomic, self-contained claim with pronouns resolved.' },
          text_en: { type: Type.STRING, description: 'English rendering; identical to text when the input is English.' },
          claim_type: { type: Type.STRING, enum: CLAIM_TYPES },
          checkability: { type: Type.STRING, enum: CHECKABILITY },
          checkability_reason: { type: Type.STRING, description: 'Plain language, shown to the user verbatim. Max 200 chars.' },
          assertion_polarity: { type: Type.STRING, enum: ['affirmative', 'negative'] },
          hedged: { type: Type.BOOLEAN, description: 'True for "reportedly", "may", "is said to".' },
          legal_refs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                raw: { type: Type.STRING, description: 'Exactly as it appears in the input.' },
                act_name: { type: Type.STRING },
                act_code: { type: Type.STRING, enum: [...ACT_CODES, 'UNKNOWN'] },
                section: { type: Type.STRING, description: 'As printed: "302", "304A", "8".' },
                subsection: { type: Type.STRING },
                article: { type: Type.STRING },
                clause: { type: Type.STRING },
              },
              required: ['raw'],
            },
          },
          entities: {
            type: Type.OBJECT,
            properties: {
              court: { type: Type.STRING },
              year: { type: Type.INTEGER },
              case_number: { type: Type.STRING },
              case_name: { type: Type.STRING },
              jurisdiction: { type: Type.STRING },
            },
          },
          quantities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                raw: { type: Type.STRING },
                value: { type: Type.NUMBER },
                unit: { type: Type.STRING },
              },
              required: ['raw'],
            },
          },
        },
        required: ['id', 'text', 'claim_type', 'checkability', 'checkability_reason'],
      },
    },
  },
  required: ['claims', 'overall_checkable'],
};

/**
 * Stage 4 — verdict. `evidenceIds` becomes an enum, so the model physically
 * cannot address a passage it was not given.
 */
export function buildVerdictSchema(evidenceIds) {
  const ID = { type: Type.STRING, enum: evidenceIds };
  return {
    type: Type.OBJECT,
    properties: {
      per_evidence: {
        type: Type.ARRAY,
        description: 'One entry per evidence item you actually used. Omit items that say nothing about the claim.',
        items: {
          type: Type.OBJECT,
          properties: {
            evidence_id: ID,
            stance: { type: Type.STRING, enum: ['supporting', 'contradicting', 'neutral'] },
            stance_confidence: { type: Type.NUMBER, description: '0 to 1. Advisory only.' },
            claim_span: { type: Type.STRING, description: 'An EXACT substring of the claim that this passage addresses.' },
            verbatim_quote: {
              type: Type.STRING,
              description:
                'Copied character-for-character from this passage, including its punctuation and '
                + 'capitalisation. It is checked by exact string match against the source text. '
                + 'A paraphrase will be rejected and the evidence discarded.',
            },
            quote_locator_hint: { type: Type.STRING, description: 'The first five words of the quote.' },
            reasoning: { type: Type.STRING, description: 'Max 280 characters.' },
          },
          required: ['evidence_id', 'stance', 'claim_span', 'verbatim_quote'],
        },
      },
      addressed_claim_spans: { type: Type.ARRAY, items: { type: Type.STRING } },
      unaddressed_claim_aspects: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Parts of the claim that NO supplied passage speaks to.',
      },
      missing_condition: {
        type: Type.OBJECT,
        description:
          'Set present=true only when a supplied passage states a condition, exception or '
          + 'limitation that the claim omits and that materially changes it.',
        properties: {
          present: { type: Type.BOOLEAN },
          evidence_id: ID,
          quote: { type: Type.STRING, description: 'Verbatim quote of the qualifying text. Checked the same way as every other quote.' },
          explanation: { type: Type.STRING, description: 'Max 280 characters.' },
        },
        required: ['present'],
      },
      provisional_verdict: {
        type: Type.STRING,
        enum: ['Supported', 'Contradicted', 'Misleading Context', 'Insufficient Evidence'],
      },
      provisional_reason: { type: Type.STRING, description: 'Plain language for a non-lawyer. Max 400 characters.' },
    },
    required: ['per_evidence', 'provisional_verdict', 'provisional_reason'],
  };
}

/**
 * Stage 5 — the single re-quote request.
 *
 * Contains ONLY evidence_id, claim_span and verbatim_quote. No `stance`, no
 * `provisional_verdict`. Told that its quote failed, a model will otherwise
 * helpfully flip a stance to neutral to make the problem disappear — so
 * stance is frozen from the first attempt and is not re-askable.
 */
export function buildRequoteSchema(evidenceIds) {
  return {
    type: Type.OBJECT,
    properties: {
      per_evidence: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            evidence_id: { type: Type.STRING, enum: evidenceIds },
            claim_span: { type: Type.STRING },
            verbatim_quote: {
              type: Type.STRING,
              description: 'A quote that appears character-for-character in that passage, or an empty string if no suitable quote exists.',
            },
          },
          required: ['evidence_id', 'verbatim_quote'],
        },
      },
    },
    required: ['per_evidence'],
  };
}
