/**
 * Combine per-sub-claim labels into the one label shown to the user.
 *
 * Mode `strictest`. Note the fourth row: a mix of Supported and Insufficient
 * deliberately does NOT become Misleading Context. "We verified one half and
 * could not check the other half" is an evidence gap, not a demonstrated
 * omission — and conflating the two is exactly how Misleading Context turns
 * into a dumping ground.
 */
import { LABELS } from './decisionTable.js';

export function aggregate(subResults) {
  const labels = subResults.map((r) => r.label);
  if (labels.length === 0) return { label: LABELS.INSUFFICIENT, rule: 'AGG-EMPTY' };
  if (labels.length === 1) return { label: labels[0], rule: 'AGG-SINGLE' };

  if (labels.includes(LABELS.CONTRADICTED)) return { label: LABELS.CONTRADICTED, rule: 'AGG-1' };
  if (labels.includes(LABELS.MISLEADING)) return { label: LABELS.MISLEADING, rule: 'AGG-2' };
  if (labels.every((l) => l === LABELS.SUPPORTED)) return { label: LABELS.SUPPORTED, rule: 'AGG-3' };
  return { label: LABELS.INSUFFICIENT, rule: 'AGG-4' };
}

/** Plain-language summary for the result card (NFR 4.3). */
export function explain(label, subResults) {
  const n = subResults.length;
  if (n === 1) return subResults[0].explanation;
  const counts = subResults.reduce((acc, r) => { acc[r.label] = (acc[r.label] ?? 0) + 1; return acc; }, {});
  const parts = Object.entries(counts).map(([l, c]) => `${c} ${l.toLowerCase()}`);
  return `This statement was split into ${n} checkable claims: ${parts.join(', ')}. The overall result takes the strictest of them.`;
}
