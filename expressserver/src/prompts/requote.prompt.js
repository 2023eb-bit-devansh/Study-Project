import { GUARDRAIL } from './guardrails.js';

export const REQUOTE_SYSTEM = `${GUARDRAIL}

One or more of the quotes you gave could not be found in the passage you attributed it to.

Return a quote that appears CHARACTER-FOR-CHARACTER in that passage, or return an empty string if no
suitable unbroken run of text exists there. An empty string is an acceptable and often correct answer
— returning a second quote that is also not in the passage is not.

Do not change your assessment of any passage. You are correcting a transcription, nothing else.`;

export function requotePrompt({ claim, evidencePacket, rejected }) {
  const list = rejected.map((r) => [
    `  ${r.evidence_id}:`,
    `    quote you gave: ${JSON.stringify(r.quote)}`,
    `    why it failed:  ${r.reason}`,
    r.similarity > 0 ? `    closest match scored ${r.similarity.toFixed(2)} (needs ${r.threshold})` : '',
  ].filter(Boolean).join('\n')).join('\n');

  return [
    `<claim>\n${claim.text}\n</claim>`,
    '',
    'PASSAGES:',
    evidencePacket,
    '',
    'THESE QUOTES FAILED VERIFICATION:',
    list,
    '',
    'Return a corrected verbatim quote for each, or an empty string.',
  ].join('\n');
}
