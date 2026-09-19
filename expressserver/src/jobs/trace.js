/**
 * The trace bus.
 *
 * ONE event shape, TWO consumers:
 *
 *   the side panel   reads `stage`, `type` and `label` only, via
 *                    `?fields=summary` so `detail` never crosses the wire to
 *                    the extension;
 *   the dashboard    reads everything and renders the timeline, the score
 *                    breakdowns, the citation table and the decision table.
 *
 * A `decision` event is emitted for EVERY deterministic gate — each
 * retrieval sufficiency assessment, each citation verification, and the
 * final decision table. Those events are the figures in the report, so they
 * are designed for that rather than for debugging alone.
 */
import { appendEvent } from './jobStore.js';
import { config } from '../config/index.js';

const STAGES = ['input', 'claim_extraction', 'retrieval', 'verdict', 'citation', 'assembly'];

/** Truncate anything oversized before it enters the ring buffer. */
function capDetail(detail) {
  if (detail === undefined || detail === null) return undefined;
  const json = JSON.stringify(detail, (_k, v) =>
    (typeof v === 'string' && v.length > 4000 ? `${v.slice(0, 4000)}… [${v.length} chars]` : v));
  if (json.length <= config.jobs.traceMaxDetailChars) return JSON.parse(json);
  return {
    _truncated: true,
    _originalChars: json.length,
    preview: `${json.slice(0, config.jobs.traceMaxDetailChars)}…`,
  };
}

/** Build an emitter bound to one job and (optionally) one stage. */
export function createEmitter(jobId, defaults = {}) {
  return function emit(event) {
    return appendEvent(jobId, {
      stage: event.stage ?? defaults.stage ?? 'input',
      type: event.type ?? 'progress',
      label: String(event.label ?? ''),
      sub_claim_id: event.sub_claim_id ?? defaults.sub_claim_id ?? null,
      detail: capDetail(event.detail),
      ...(event.duration_ms !== undefined ? { duration_ms: Math.round(event.duration_ms) } : {}),
      ...(event.tokens ? { tokens: event.tokens } : {}),
      ...(event.cost_estimate_usd !== undefined ? { cost_estimate_usd: event.cost_estimate_usd } : {}),
      ...(event.budget ? { budget: event.budget } : {}),
    });
  };
}

/** Summary projection for the extension's poll. */
export function summariseEvents(events) {
  return events.map((e) => ({
    seq: e.seq,
    ts: e.ts,
    stage: e.stage,
    type: e.type,
    label: e.label,
    sub_claim_id: e.sub_claim_id ?? null,
  }));
}

export { STAGES };
