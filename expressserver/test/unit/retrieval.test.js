import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBudget } from '../../src/retrieval/budget.js';
import { createPool, scoreCandidate } from '../../src/retrieval/fusion.js';
import { assess, keyTerms } from '../../src/retrieval/sufficiency.js';
import { shouldEscalate } from '../../src/retrieval/heuristicDriver.js';
import { config } from '../../src/config/index.js';

const cand = (id, over = {}) => ({
  chunk_id: id,
  text: over.text ?? `passage ${id} about murder and punishment with death`,
  meta: { ref_key: over.ref_key ?? '', act_code: over.act_code ?? 'IPC', doc_type: 'act', ...over.meta },
  denseSim: over.denseSim ?? 0.5,
  refHit: over.refHit ?? false,
  exactHit: over.exactHit ?? false,
  isWeb: over.isWeb ?? false,
  isNeighbour: over.isNeighbour ?? false,
  routes: over.routes ?? ['dense'],
});

test('budget counters stop the loop independently and never throw', () => {
  const b = createBudget({ turns: 2, toolCalls: 3, llmCalls: 1, evidenceChars: 100, deadlineMs: 60_000 });
  assert.equal(b.consume('turns'), true);
  assert.equal(b.consume('turns'), true);
  assert.equal(b.consume('turns'), false, 'returns false rather than throwing');
  assert.ok(b.exhausted());
  assert.match(b.reason(), /turn limit/);

  const c = createBudget({ turns: 9, toolCalls: 1, llmCalls: 0, evidenceChars: 1e6, deadlineMs: 60_000 });
  assert.equal(c.consume('llmCalls'), false, 'a zero llm budget blocks the refiner');
  assert.equal(c.consume('toolCalls'), true);
  assert.equal(c.consume('toolCalls'), false);
  assert.match(c.reason(), /tool-call limit/);
});

test('an expired deadline blocks every further consumption', () => {
  const b = createBudget({ turns: 99, toolCalls: 99, llmCalls: 99, evidenceChars: 1e9, deadlineMs: 0 });
  assert.equal(b.consume('turns'), false);
  assert.ok(b.exhausted());
  assert.match(b.reason(), /deadline/);
});

test('fusion: an exact reference hit outranks a higher dense score', () => {
  // This is the whole argument for hybrid retrieval. 304A is semantically
  // closer to "punishment for causing death" than 302, and pure dense
  // retrieval puts it first.
  const withRef = scoreCandidate(cand('a', { denseSim: 0.72, refHit: true, exactHit: true }));
  const denseOnly = scoreCandidate(cand('b', { denseSim: 0.81 }));
  assert.ok(withRef.score > denseOnly.score, `${withRef.score} !> ${denseOnly.score}`);
});

test('fusion: every component is in [0,1] and the total cannot exceed 1', () => {
  const perfect = scoreCandidate(cand('a', { denseSim: 1, refHit: true, exactHit: true }));
  assert.equal(perfect.score, 1);
  const worst = scoreCandidate(cand('b', { denseSim: 0, isWeb: true, isNeighbour: true }));
  assert.equal(worst.score, 0);
});

test('a repeat hit from a second route reinforces rather than being discarded', () => {
  // Dropping the repeat would cap a chunk at its dense-only score and make
  // the exact_hit component unreachable whenever keyword and dense hits
  // overlap — which is the common case.
  const pool = createPool();
  const first = pool.upsert(cand('x', { denseSim: 0.6, routes: ['dense'] }));
  assert.equal(first.created, true);
  const second = pool.upsert(cand('x', { denseSim: 0, exactHit: true, routes: ['exact'] }));
  assert.equal(second.created, false);
  assert.ok(second.scoreAfter > second.scoreBefore, 'the second route must raise the score');
  assert.deepEqual(second.candidate.routes.sort(), ['dense', 'exact']);
});

test('identical passages under different ids are folded together', () => {
  const pool = createPool();
  pool.upsert(cand('corpus-1', { text: 'Whoever commits murder shall be punished with death.' }));
  pool.upsert(cand('web-1', { text: 'Whoever commits murder shall be punished with death.', isWeb: true }));
  assert.equal(pool.size(), 1, 'the same passage must not count as two pieces of evidence');
});

test('a repeated query is never executed twice', () => {
  const pool = createPool();
  assert.equal(pool.claimQuery('fp1'), true);
  assert.equal(pool.claimQuery('fp1'), false);
});

test('key terms weigh numbers double, and count them exactly once', () => {
  // Numbers ARE the claim in penalty law, so they weigh double in gate G2 —
  // but a number must not also survive as an ordinary weight-1 content term,
  // or it silently gets three times an ordinary word's influence.
  const terms = keyTerms('punishable with imprisonment for seven years');
  const numeric = terms.filter((t) => t.weight === 2);
  assert.equal(numeric.length, 1, JSON.stringify(terms));
  assert.equal(numeric[0].token, '7', 'stored canonicalised so "seven" and "7" agree');
  assert.equal(terms.filter((t) => t.token === 'seven').length, 0, 'no surface duplicate');
});

test('G1 fails when the claim names a provision the results do not carry', () => {
  const a = assess({
    subClaimText: 'Section 302 IPC prescribes death',
    refKeys: ['IPC:S302'],
    candidates: [scoreCandidate(cand('x', { ref_key: 'IPC:S304A' }))],
    progress: 1,
    turnsDone: 3,
  });
  assert.equal(a.gates.G1, false);
  assert.ok(a.gaps.some((g) => g.startsWith('missing_reference')));
});

test('G1 passes trivially when the claim names no provision', () => {
  const a = assess({ subClaimText: 'The RTI Act gives citizens a right', refKeys: [], candidates: [], progress: 1, turnsDone: 3 });
  assert.equal(a.gates.G1, true);
});

test('G4 never fires on the first turn', () => {
  // A first turn has nothing to compare against; treating it as "no progress"
  // would kill the loop before the counter-evidence turn could run.
  const first = assess({ subClaimText: 'x', candidates: [], progress: 0, turnsDone: 1 });
  assert.equal(first.gates.G4_progress, true);
  const later = assess({ subClaimText: 'x', candidates: [], progress: 0, turnsDone: 2 });
  assert.equal(later.gates.G4_progress, false);
});

test('G5 blocks sufficiency until the counter-evidence turn has run', () => {
  const strong = [
    scoreCandidate(cand('a', { denseSim: 1, refHit: true, exactHit: true, text: 'murder death imprisonment life punishable' })),
    scoreCandidate(cand('b', { denseSim: 1, refHit: true, exactHit: true, text: 'murder death imprisonment life punishable' })),
  ];
  const args = { subClaimText: 'murder is punishable with death', refKeys: [], candidates: strong, progress: 2 };
  assert.equal(assess({ ...args, turnsDone: 1 }).sufficient, false, 'must not conclude on turn 1');
  assert.equal(assess({ ...args, turnsDone: config.sufficiency.minTurns }).sufficient, true);
});

test('live search requires the corpus to have been searched first (FR7)', () => {
  const pool = createPool();
  const weak = { assessment: { gates: { G1: false } }, claim: { text: 'x', claim_type: 'other' }, webCalls: 0, pool };
  assert.equal(shouldEscalate({ ...weak, corpusTurns: 1 }).escalate, false, 'one corpus turn is not enough');
  assert.equal(shouldEscalate({ ...weak, corpusTurns: 2 }).escalate, true);
});

test('live search is capped per sub-claim', () => {
  const pool = createPool();
  const r = shouldEscalate({
    assessment: { gates: { G1: false } },
    claim: { text: 'x', claim_type: 'other' },
    corpusTurns: 3,
    webCalls: config.web.maxCalls,
    pool,
  });
  assert.equal(r.escalate, false);
  assert.ok(r.blockers.some((b) => /cap/.test(b)));
});

test('a recency marker triggers escalation', () => {
  const pool = createPool();
  pool.upsert(cand('strong', { denseSim: 1, refHit: true, exactHit: true }));
  const r = shouldEscalate({
    assessment: { gates: { G1: true } },
    claim: { text: 'this section was recently amended', claim_type: 'legal_status_or_repeal' },
    corpusTurns: 2, webCalls: 0, pool,
  });
  assert.ok(r.triggers.includes('E3:recency_marker'));
});

test('G2 coverage matches a spelled-out number against its digit form', () => {
  // keyTerms canonicalises "seven" to "7", so coverage must compare against
  // the passage's canonicalised numbers rather than searching for "7" as a
  // substring of text that says "seven".
  const passage = 'shall be punished with imprisonment for a term which may extend to seven years';
  const a = assess({
    subClaimText: 'punishable with imprisonment for seven years',
    candidates: [scoreCandidate(cand('x', { text: passage, denseSim: 1, exactHit: true }))],
    progress: 1,
    turnsDone: 3,
  });
  assert.equal(a.metrics.termCoverage, 1, `uncovered: ${a.uncovered.join(', ')}`);
});

test('G2 notices when the passage states a DIFFERENT number', () => {
  const passage = 'shall be punished with imprisonment for a term which may extend to ten years';
  const a = assess({
    subClaimText: 'punishable with imprisonment for seven years',
    candidates: [scoreCandidate(cand('x', { text: passage, denseSim: 1 }))],
    progress: 1,
    turnsDone: 3,
  });
  assert.ok(a.uncovered.includes('7'), `uncovered was ${JSON.stringify(a.uncovered)}`);
  assert.ok(a.metrics.termCoverage < 1);
});
