/**
 * The ONE language-model call inside retrieval.
 *
 * The model is confined to the single thing it is genuinely better at than a
 * rule: turning a gap report into a better query. It cannot change the
 * stopping rule, the ranking, or what counts as sufficient — all of that is
 * code. The report line is: "a wrong model output here degrades recall but
 * cannot alter the loop's control flow."
 */
import { Type } from '@google/genai';
import { generateStructured } from '../providers/gemini/generate.js';
import { config } from '../config/index.js';
import { ACT_CODES } from '../corpus/refKey.js';
import { truncate } from '../util/text.js';
import { GUARDRAIL } from '../prompts/guardrails.js';

const schema = {
  type: Type.OBJECT,
  properties: {
    queries: {
      type: Type.ARRAY,
      description: 'Up to 3 replacement search queries, most promising first.',
      items: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: 'Natural-language query, 3-20 words.' },
          act_code: { type: Type.STRING, enum: ['ANY', ...ACT_CODES] },
          rationale: { type: Type.STRING, description: 'Which gap this addresses. Max 120 chars.' },
        },
        required: ['query'],
      },
    },
    ref_keys: {
      type: Type.ARRAY,
      description: 'Canonical references worth an exact lookup, e.g. "IPC:S302", "CONST:A19(1)(a)".',
      items: { type: Type.STRING },
    },
  },
  required: ['queries'],
};

const SYSTEM = `${GUARDRAIL}

You reformulate search queries for a legal evidence retrieval system over a curated corpus of
Indian statutes and judgments. You are given a claim, the gaps the retriever could not fill, and
the titles of passages it has already seen.

Write queries phrased the way a STATUTE or a JUDGMENT is phrased, not the way a claim is phrased.
Statutes say "shall be punished with", "no obligation to give", "shall not be enforceable by any
court". Prefer that register.

Do not repeat a query that has evidently already been tried. Do not state or imply whether the
claim is true or false — you are finding text, not judging it.`;

/**
 * @param {object} o
 * @param {object} o.claim
 * @param {string[]} o.gaps
 * @param {Array} o.seen  candidates already in the pool
 */
export async function refineQueries({ claim, gaps, seen }) {
  const seenList = seen.slice(0, 8).map((c, i) =>
    `  ${i + 1}. [${c.meta?.ref_key || c.meta?.doc_title || 'source'}] ${truncate(c.text ?? '', 160)}`).join('\n');

  const prompt = [
    `CLAIM: ${claim.text}`,
    claim.ref_keys?.length ? `PROVISIONS NAMED: ${claim.ref_keys.join(', ')}` : 'PROVISIONS NAMED: none',
    `CLAIM TYPE: ${claim.claim_type}`,
    '',
    `GAPS THE RETRIEVER COULD NOT FILL:\n${gaps.map((g) => `  - ${g}`).join('\n') || '  - (none reported)'}`,
    '',
    `ALREADY RETRIEVED (do not re-fetch these):\n${seenList || '  (nothing yet)'}`,
    '',
    'Return up to 3 better queries, plus any canonical reference keys worth an exact lookup.',
  ].join('\n');

  const { data, usage, ms, model } = await generateStructured({
    role: 'retrieval',
    contents: prompt,
    schema,
    system: SYSTEM,
    temperature: config.gemini.tempRefiner,
    label: 'query_refiner',
  });

  return {
    queries: (data.queries ?? []).slice(0, 3),
    ref_keys: (data.ref_keys ?? []).slice(0, 3),
    usage, ms, model,
  };
}
