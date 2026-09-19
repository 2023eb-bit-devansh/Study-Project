/**
 * The bounded retrieval loop.
 *
 * Control flow is deterministic. The stopping rule, the ranking, the dedup
 * and the escalation conditions are all code with named thresholds you can
 * point at in a report; the language model appears exactly once, in turn 3,
 * confined to query reformulation under a hard call cap.
 *
 * Two invariants this file must never break:
 *
 *   FR12 — the retrieval stage returns a RANKED EVIDENCE SET ONLY. It never
 *          produces, states or implies a verdict. `gaps[]` is scrubbed of
 *          verdict vocabulary before it leaves, so this is enforced
 *          structurally rather than by asking a prompt nicely.
 *
 *   FR7  — the curated corpus is searched FIRST, always. Live search is
 *          reachable only after WEB_MIN_CORPUS_TURNS corpus turns have
 *          completed and the evidence is still insufficient.
 *
 * The loop ALWAYS returns. Budget exhaustion, a tool error and a dead
 * network are all normal outcomes that produce a (possibly empty) evidence
 * set plus a gap report, never an exception. An empty set then short-circuits
 * to Insufficient Evidence without the verdict model ever being called.
 *
 *   TURN 1  SEED      dense(claim) + dense(template) + exact ref lookup + keyword
 *   TURN 2  READ      expand the top unexpanded candidates (FR8)
 *   TURN 3  REFINE    the one gap-driven model call (FR9)
 *   TURN 4  ESCALATE  live search, gated (FR10)
 *   TURN 5  READ      expand anything new from turns 3-4
 *   TURN 6  STOP
 */
import { createBudget } from './budget.js';
import { createPool, toEvidence } from './fusion.js';
import { assess } from './sufficiency.js';
import { planSeedQueries, counterQuery, QUALIFIER_PATTERN } from './queryPlanner.js';
import { refineQueries } from './queryRefiner.js';
import { TOOLS } from './tools/index.js';
import { buildIdf } from './idf.js';
import { config } from '../config/index.js';
import { expandAllAliases } from '../corpus/refKey.js';
import { sha1 } from '../util/hash.js';
import { logger } from '../util/logger.js';
import { timer } from '../util/time.js';

const log = logger('retrieval');

/** Verdict vocabulary is stripped from anything the stage emits (FR12). */
const VERDICT_WORDS = /\b(supported|contradicted|misleading|verdict|true|false|correct|incorrect|proven|disproven|accurate|inaccurate)\b/gi;
const scrub = (s) => String(s ?? '').replace(VERDICT_WORDS, '[verdict language removed]');

const RECENCY_RE = /\b(recent|recently|amended|amendment|new|latest|repealed|struck down|now|currently|as of|today|still in force)\b/i;

/**
 * @param {object} o
 * @param {object} o.claim     sub-claim with .text, .claim_type, .ref_keys
 * @param {(e:object)=>void} o.emit  trace emitter
 * @param {()=>boolean} [o.cancelled]
 * @param {object} [o.weights] ranking weight override (dashboard playground)
 */
export async function retrieve({ claim, emit = () => {}, cancelled = () => false, weights, budgetOverrides }) {
  const t = timer();
  const budget = createBudget(budgetOverrides ?? {});
  const pool = createPool(weights ?? config.ranking);
  const wantedRefKeys = expandAllAliases(claim.ref_keys ?? []);

  let webCalls = 0;
  let corpusTurns = 0;
  let lastAssessment = null;
  let llmUsage = { calls: 0, promptTokens: 0, outputTokens: 0 };

  const trace = (type, label, detail) => emit({
    stage: 'retrieval', type, label,
    sub_claim_id: claim.id,
    detail,
    budget: budget.snapshot(),
  });

  /** Run one tool, fold its hits into the pool, and trace it. */
  async function runTool(name, args, label) {
    if (cancelled()) return { admitted: 0, skipped: 0, aborted: true };

    const fingerprint = sha1(`${name}:${JSON.stringify(args)}`);
    if (!pool.claimQuery(fingerprint)) {
      trace('tool_result', `Skipped repeat query: ${label}`, { tool: name, args, skipped: 'duplicate_query' });
      return { admitted: 0, skipped: 0, duplicate: true };
    }
    if (!budget.consume('toolCalls')) {
      trace('progress', `Budget stopped "${label}" — ${budget.reason()}`, { tool: name, args });
      return { admitted: 0, skipped: 0, blocked: true };
    }

    trace('tool_call', label, { tool: name, args });
    const tt = timer();

    let result;
    try {
      result = await TOOLS[name](args);
    } catch (err) {
      // A failing tool is a gap, not a crash. The loop continues.
      trace('warning', `${name} failed: ${err.message}`, { tool: name, args, error: err.message });
      return { admitted: 0, skipped: 0, failed: true };
    }

    let admitted = 0;
    let reinforced = 0;
    let skipped = 0;
    // "Progress" means this turn moved the pool at all — a new candidate, or
    // an existing one whose score rose because a second route corroborated
    // it. It deliberately does NOT test an absolute score floor: whether the
    // evidence is GOOD ENOUGH is gate G3's job, and conflating the two makes
    // a turn that admitted eight relevant passages look like it did nothing.
    let progress = 0;

    for (const hit of result.hits ?? []) {
      pool.markSeen(hit.chunk_id);

      const refHit = hit.refHit
        || (hit.meta?.ref_key && wantedRefKeys.includes(hit.meta.ref_key))
        || (hit.meta?.ref_key_alt && wantedRefKeys.includes(hit.meta.ref_key_alt));

      // A repeat hit is still merged, never discarded: a chunk that dense
      // search already returned and that keyword search then finds again is
      // corroborated by two routes, and that is precisely what the fusion
      // formula exists to reward. Only the COUNTS treat it as already-seen.
      const { created, scoreBefore, scoreAfter } = pool.upsert({ ...hit, refHit: Boolean(refHit) });

      if (created) {
        admitted++;
        progress++;
        budget.addEvidenceChars((hit.text ?? '').length);
      } else {
        skipped++;
        if (scoreAfter > scoreBefore) { reinforced++; progress++; }
      }
    }

    trace('tool_result',
      `${label}: ${admitted} new${reinforced ? `, ${reinforced} reinforced` : ''}${skipped ? `, ${skipped} already seen` : ''}`,
      {
        tool: name,
        args,
        mode: result.mode,
        admitted,
        reinforced,
        skipped_already_seen: skipped,
        duration_ms: Math.round(tt.ms()),
        ...(result.dropped?.length ? { dropped_web_sources: result.dropped } : {}),
        ...(result.searchQueries ? { google_search_queries: result.searchQueries } : {}),
        ...(result.error ? { error: result.error } : {}),
        hits: (result.hits ?? []).slice(0, 8).map((h) => ({
          chunk_id: h.chunk_id,
          ref_key: h.meta?.ref_key ?? '',
          title: h.meta?.doc_title ?? '',
          heading: h.meta?.heading ?? '',
          status: h.meta?.status ?? '',
          denseSim: Number((h.denseSim ?? 0).toFixed(4)),
        })),
      });

    return { admitted, reinforced, skipped, progress };
  }

  /** Close a turn: assess, trace the gates, decide whether to stop. */
  function closeTurn(turnName, progress) {
    const a = assess({
      subClaimText: claim.text,
      refKeys: claim.ref_keys ?? [],
      candidates: pool.ranked(),
      progress,
      turnsDone: budget.used.turns,
      budget,
    });
    lastAssessment = a;
    trace('decision', gateLabel(turnName, a), {
      gate: 'retrieval_sufficiency',
      turn: turnName,
      ...a,
      candidates: pool.forTrace(10),
    });
    return a;
  }

  // ── boot ─────────────────────────────────────────────────────────────
  await buildIdf().catch((err) => log.warn(`IDF unavailable: ${err.message}`));
  trace('stage_start', `Searching the legal corpus for: ${claim.text.slice(0, 90)}`, {
    claim: claim.text,
    ref_keys: claim.ref_keys ?? [],
    claim_type: claim.claim_type,
    limits: budget.limits,
  });

  // ── TURN 1 — SEED ────────────────────────────────────────────────────
  budget.consume('turns');
  corpusTurns++;
  const plan = planSeedQueries(claim);
  trace('progress', `Turn 1: ${plan.length} parallel queries`, { plan: plan.map((p) => ({ tool: p.tool, label: p.label, args: p.args })) });

  let progress = 0;
  for (const step of plan) {
    const r = await runTool(step.tool, step.args, step.label);
    progress += r.progress ?? 0;
  }
  let a = closeTurn('seed', progress);

  // ── TURN 2 — READ + COUNTER-EVIDENCE ─────────────────────────────────
  //
  // Two jobs in one turn. First expand the best hits into their surrounding
  // text (FR8). Then go looking for what would QUALIFY or REFUTE the claim,
  // scoped to whichever Act the seed turn actually landed on. A fact checker
  // that only searches for text matching the claim will confidently report
  // "Supported" for a claim whose governing exception it never read.
  const expanded = new Set();
  if (!a.sufficient && !cancelled() && !budget.exhausted() && budget.consume('turns')) {
    corpusTurns++;
    progress = 0;

    for (const c of pool.ranked(2)) {
      if (c.isWeb || expanded.has(c.chunk_id)) continue;
      expanded.add(c.chunk_id);
      const r = await runTool('read_passage', { chunk_id: c.chunk_id, window: config.retrieval.neighbourWindow }, `read around ${c.meta?.ref_key || c.chunk_id}`);
      progress += r.progress ?? 0;
    }

    const dominant = dominantActCode(pool.ranked(5));
    const counter = await runTool(
      'search_corpus',
      { query: counterQuery(claim), act_code: dominant ?? undefined },
      `counter-evidence${dominant ? ` in ${dominant}` : ''}: exceptions and limitations`,
    );
    progress += counter.progress ?? 0;

    if (dominant) {
      const qualifiers = await runTool(
        'keyword_search',
        { regex: QUALIFIER_PATTERN, act_code: dominant, n_results: 6 },
        `qualifier language in ${dominant}`,
      );
      progress += qualifiers.progress ?? 0;
    }

    a = closeTurn('read+counter', progress);
  }

  // ── TURN 3 — REFINE (the one model call) ─────────────────────────────
  if (!a.sufficient && !cancelled() && !budget.exhausted() && budget.consume('turns')) {
    corpusTurns++;
    progress = 0;
    if (budget.consume('llmCalls')) {
      trace('llm_call', 'Reformulating the search from the gap report', { gaps: a.gaps.map(scrub) });
      try {
        const refined = await refineQueries({ claim, gaps: a.gaps, seen: pool.ranked(8) });
        llmUsage = {
          calls: llmUsage.calls + 1,
          promptTokens: llmUsage.promptTokens + (refined.usage?.prompt ?? 0),
          outputTokens: llmUsage.outputTokens + (refined.usage?.output ?? 0),
        };
        trace('llm_result', `Suggested ${refined.queries.length} new queries`, {
          model: refined.model,
          duration_ms: Math.round(refined.ms),
          tokens: refined.usage,
          queries: refined.queries,
          ref_keys: refined.ref_keys,
        });

        for (const key of refined.ref_keys ?? []) {
          const r = await runTool('lookup_legal_reference', { ref_key: key, include_equivalents: true }, `exact lookup ${key}`);
          progress += r.progress ?? 0;
        }
        for (const q of refined.queries) {
          const r = await runTool('search_corpus', { query: q.query, act_code: q.act_code }, `refined: ${q.query}`);
          progress += r.progress ?? 0;
        }
      } catch (err) {
        trace('warning', `Query refinement unavailable: ${err.message}`, { error: err.message });
      }
    }
    a = closeTurn('refine', progress);
  }

  // ── TURN 4 — ESCALATE to live search ─────────────────────────────────
  const escalation = shouldEscalate({ assessment: a, claim, corpusTurns, webCalls, pool });
  if (!a.sufficient && !cancelled() && escalation.escalate && budget.consume('turns')) {
    progress = 0;
    if (budget.consume('llmCalls')) {
      webCalls++;
      trace('progress', `Corpus insufficient — escalating to live search (${escalation.reasons.join(', ')})`, escalation);
      const r = await runTool('web_search', { query: claim.text }, 'live web search');
      progress += r.progress ?? 0;
    }
    a = closeTurn('escalate', progress);
  } else if (!a.sufficient && !escalation.escalate) {
    trace('progress', `Live search not used: ${escalation.reasons.join(', ')}`, escalation);
  }

  // ── TURN 5 — READ AGAIN ──────────────────────────────────────────────
  if (!a.sufficient && !cancelled() && !budget.exhausted() && budget.consume('turns')) {
    progress = 0;
    for (const c of pool.ranked(3)) {
      if (c.isWeb || expanded.has(c.chunk_id)) continue;
      expanded.add(c.chunk_id);
      const r = await runTool('read_passage', { chunk_id: c.chunk_id, window: config.retrieval.neighbourWindow }, `read around ${c.meta?.ref_key || c.chunk_id}`);
      progress += r.progress ?? 0;
      break; // one expansion is enough at this point in the budget
    }
    a = closeTurn('read_again', progress);
  }

  // ── TURN 6 — STOP ────────────────────────────────────────────────────
  const evidence = pool.ranked(config.retrieval.finalK).map(toEvidence);
  const sufficiency = a?.sufficient ? 'sufficient'
    : budget.exhausted() ? 'budget_exhausted'
      : 'insufficient';

  trace('stage_end',
    `Retrieval finished: ${evidence.length} passages, ${sufficiency}`,
    {
      sufficiency,
      stop_reason: a?.stopReason || budget.reason(),
      gaps: (a?.gaps ?? []).map(scrub),
      turns: budget.used.turns,
      tool_calls: budget.used.toolCalls,
      llm_calls: budget.used.llmCalls,
      web_used: webCalls > 0,
      duration_ms: Math.round(t.ms()),
      final: pool.forTrace(config.retrieval.finalK),
    });

  return {
    evidence,
    sufficiency,
    // FR12: no verdict, and no verdict vocabulary, leaves this stage.
    gaps: (a?.gaps ?? []).map(scrub),
    gates: a?.gates ?? {},
    metrics: a?.metrics ?? {},
    turns: budget.used.turns,
    toolCalls: budget.used.toolCalls,
    llmCalls: budget.used.llmCalls,
    webUsed: webCalls > 0,
    budgetExhausted: budget.exhausted(),
    stopReason: a?.stopReason || budget.reason(),
    usage: llmUsage,
    ms: Math.round(t.ms()),
  };
}

/**
 * Live-search escalation conditions (FR10).
 * Corpus first, always: at least WEB_MIN_CORPUS_TURNS corpus turns must have
 * completed before the web is reachable at all.
 */
export function shouldEscalate({ assessment, claim, corpusTurns, webCalls, pool }) {
  const reasons = [];
  const blockers = [];

  if (!config.web.enabled) blockers.push('LIVE_SEARCH_ENABLED=false');
  if (corpusTurns < config.web.minCorpusTurns) blockers.push(`only ${corpusTurns} corpus turn(s) so far`);
  if (webCalls >= config.web.maxCalls) blockers.push('web call cap reached');

  const top = pool.ranked(1)[0];
  // E1 — nothing, or nothing strong enough
  if (!top || top.score < config.web.escalateMaxTopScore) reasons.push('E1:no_strong_corpus_evidence');
  // E2 — the claim names a provision the corpus does not contain
  if (assessment && assessment.gates.G1 === false) reasons.push('E2:named_provision_absent');
  // E3 — a recency marker the corpus cannot settle
  if (RECENCY_RE.test(claim.text)) reasons.push('E3:recency_marker');
  // E4 — a case holding with no matching judgment in the corpus
  if (claim.claim_type === 'case_holding' && !pool.ranked(5).some((c) => c.meta?.doc_type === 'judgment')) {
    reasons.push('E4:case_holding_without_judgment');
  }

  return {
    escalate: blockers.length === 0 && reasons.length > 0,
    reasons: blockers.length ? blockers : (reasons.length ? reasons : ['corpus evidence was sufficient']),
    triggers: reasons,
    blockers,
  };
}

/** The Act most represented among the top candidates, if any dominates. */
function dominantActCode(candidates) {
  const counts = {};
  for (const c of candidates) {
    const code = c.meta?.act_code;
    if (code) counts[code] = (counts[code] ?? 0) + 1;
  }
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return top && top[1] >= 2 ? top[0] : null;
}

function gateLabel(turn, a) {
  if (a.sufficient) return `Evidence sufficient after ${turn} (top score ${a.metrics.topScore})`;
  const failed = Object.entries(a.gates).filter(([, v]) => !v).map(([k]) => k);
  return `Not yet sufficient after ${turn} — failed ${failed.join(', ')}`;
}
