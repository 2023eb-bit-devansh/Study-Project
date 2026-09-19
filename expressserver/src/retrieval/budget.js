/**
 * Five independent counters. Any one hitting zero ends the loop.
 *
 * `consume()` returns false rather than throwing: an exhausted budget is a
 * normal, expected outcome, not an error. The retrieval agent ALWAYS returns
 * — with whatever it found and a populated `gaps` list — so that downstream
 * stages see a thin evidence set rather than an exception. An empty evidence
 * set then short-circuits to Insufficient Evidence without ever calling the
 * verdict model, which is the evidence-first invariant.
 */
import { config } from '../config/index.js';

export function createBudget(overrides = {}) {
  const limits = {
    turns: config.retrieval.maxTurns,
    toolCalls: config.retrieval.maxToolCalls,
    llmCalls: config.retrieval.maxLlmCalls,
    evidenceChars: config.retrieval.maxEvidenceChars,
    deadlineMs: config.retrieval.deadlineMs,
    ...overrides,
  };

  const used = { turns: 0, toolCalls: 0, llmCalls: 0, evidenceChars: 0 };
  const startedAt = Date.now();

  const elapsed = () => Date.now() - startedAt;
  const outOfTime = () => elapsed() >= limits.deadlineMs;

  return {
    limits,
    used,
    elapsed,

    /**
     * @param {'turns'|'toolCalls'|'llmCalls'} kind
     * @param {number} [amount]
     * @returns {boolean} false when the budget cannot cover it
     */
    consume(kind, amount = 1) {
      if (outOfTime()) return false;
      if (used[kind] + amount > limits[kind]) return false;
      used[kind] += amount;
      return true;
    },

    /** Evidence characters are accounted for but never block a single item. */
    addEvidenceChars(n) {
      used.evidenceChars += n;
      return used.evidenceChars <= limits.evidenceChars;
    },

    exhausted() {
      return outOfTime()
        || used.turns >= limits.turns
        || used.toolCalls >= limits.toolCalls
        || used.evidenceChars >= limits.evidenceChars;
    },

    /** Why it stopped — shown in the trace and the report. */
    reason() {
      if (outOfTime()) return `deadline (${limits.deadlineMs}ms)`;
      if (used.turns >= limits.turns) return `turn limit (${limits.turns})`;
      if (used.toolCalls >= limits.toolCalls) return `tool-call limit (${limits.toolCalls})`;
      if (used.evidenceChars >= limits.evidenceChars) return `evidence size limit (${limits.evidenceChars} chars)`;
      return 'not exhausted';
    },

    /** Compact form emitted on every trace event. */
    snapshot() {
      return {
        turn: used.turns,
        max_turns: limits.turns,
        tool_calls: used.toolCalls,
        max_tool_calls: limits.toolCalls,
        llm_calls: used.llmCalls,
        max_llm_calls: limits.llmCalls,
        evidence_chars: used.evidenceChars,
        elapsed_ms: elapsed(),
      };
    },
  };
}
