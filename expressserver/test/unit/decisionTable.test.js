import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, coverage, LABELS } from '../../src/verdict/decisionTable.js';
import { aggregate } from '../../src/verdict/aggregate.js';

const CLAIM = 'Under Section 302 of the Indian Penal Code, murder is punishable with death or imprisonment for life.';

const ev = (stance, status, over = {}) => ({
  stance,
  citation: { status },
  claim_span: over.claim_span ?? CLAIM,
  passage: over.passage ?? 'Whoever commits murder shall be punished with death, or imprisonment for life.',
  ...over,
});

test('R0 — nothing verified means Insufficient Evidence, not a guess', () => {
  const r = decide({ subClaimText: CLAIM, items: [ev('supporting', 'rejected'), ev('contradicting', 'rejected')] });
  assert.equal(r.rule_id, 'R0');
  assert.equal(r.label, LABELS.INSUFFICIENT);
});

test('R0 — neutral-only evidence also abstains', () => {
  const r = decide({ subClaimText: CLAIM, items: [ev('neutral', 'verified')] });
  assert.equal(r.rule_id, 'R0');
});

test('R0 — an empty evidence set never reaches a confident label', () => {
  assert.equal(decide({ subClaimText: CLAIM, items: [] }).label, LABELS.INSUFFICIENT);
});

test('R1 — a named provision we cannot show we read abstains', () => {
  const r = decide({
    subClaimText: CLAIM,
    items: [ev('supporting', 'verified')],
    refKeys: ['IPC:S302'],
    verifiedRefKeys: ['IPC:S304A'],
  });
  assert.equal(r.rule_id, 'R1');
  assert.equal(r.label, LABELS.INSUFFICIENT);
});

test('R2 — verified contradiction wins', () => {
  const r = decide({ subClaimText: CLAIM, items: [ev('contradicting', 'verified')] });
  assert.equal(r.rule_id, 'R2');
  assert.equal(r.label, LABELS.CONTRADICTED);
});

test('R3 — full coverage, nothing against, nothing unaddressed', () => {
  const r = decide({
    subClaimText: CLAIM,
    items: [ev('supporting', 'verified')],
    refKeys: ['IPC:S302'],
    verifiedRefKeys: ['IPC:S302'],
  });
  assert.equal(r.rule_id, 'R3');
  assert.equal(r.label, LABELS.SUPPORTED);
});

test('R3 does not fire when the model reports an unaddressed aspect', () => {
  const r = decide({
    subClaimText: CLAIM,
    items: [ev('supporting', 'verified')],
    unaddressed: ['whether the punishment applies to attempts'],
  });
  assert.notEqual(r.rule_id, 'R3');
});

test('R4 — a verified missing condition produces Misleading Context', () => {
  const r = decide({
    subClaimText: 'The RTI Act gives any citizen the right to obtain information from any public authority.',
    items: [ev('supporting', 'verified', { claim_span: 'The RTI Act gives any citizen the right to obtain information from any public authority.' })],
    missingCondition: { present: true, citation: { status: 'verified' } },
  });
  assert.equal(r.rule_id, 'R4');
  assert.equal(r.label, LABELS.MISLEADING);
});

test('R4 — the deterministic second door: partial coverage plus a qualifier passage', () => {
  const claim = 'The RTI Act gives any citizen the right to obtain information from any public authority.';
  const r = decide({
    subClaimText: claim,
    items: [
      ev('supporting', 'verified', { claim_span: 'The RTI Act gives any citizen the right' }),
      ev('neutral', 'verified', {
        claim_span: '',
        passage: 'Notwithstanding anything contained in this Act, there shall be no obligation to give any citizen information...',
      }),
    ],
  });
  assert.equal(r.rule_id, 'R4');
  assert.equal(r.label, LABELS.MISLEADING);
});

test('an UNVERIFIED missing condition cannot produce Misleading Context', () => {
  const r = decide({
    subClaimText: CLAIM,
    items: [ev('supporting', 'verified')],
    missingCondition: { present: true, citation: { status: 'rejected' } },
  });
  assert.notEqual(r.label, LABELS.MISLEADING);
});

test('R5 — verified evidence on both sides', () => {
  const r = decide({
    subClaimText: CLAIM,
    items: [ev('supporting', 'verified'), ev('contradicting', 'verified')],
  });
  assert.equal(r.rule_id, 'R5');
  assert.equal(r.label, LABELS.MISLEADING);
});

test('R6 — partial matches alone are not enough to assert', () => {
  const r = decide({ subClaimText: CLAIM, items: [ev('supporting', 'partially_verified')] });
  assert.equal(r.rule_id, 'R6');
  assert.equal(r.label, LABELS.INSUFFICIENT);
});

test('R7 — fail closed: supported but poorly covered and no qualifier', () => {
  const r = decide({
    subClaimText: CLAIM,
    items: [ev('supporting', 'verified', { claim_span: 'murder', passage: 'Whoever commits murder shall be punished.' })],
  });
  assert.equal(r.rule_id, 'R7');
  assert.equal(r.label, LABELS.INSUFFICIENT);
});

test('Misleading Context is never reachable from uncertainty alone', () => {
  // Every "we are not sure" shape must land on Insufficient Evidence.
  const uncertain = [
    { items: [] },
    { items: [ev('neutral', 'verified')] },
    { items: [ev('supporting', 'rejected')] },
    { items: [ev('supporting', 'partially_verified')] },
  ];
  for (const u of uncertain) {
    const r = decide({ subClaimText: CLAIM, ...u });
    assert.equal(r.label, LABELS.INSUFFICIENT, `rule ${r.rule_id} leaked to ${r.label}`);
  }
});

test('coverage is a union, so two items on the same span do not double-count', () => {
  const claim = 'aaa bbb ccc ddd';
  const one = coverage(claim, [ev('supporting', 'verified', { claim_span: 'aaa bbb' })]);
  const two = coverage(claim, [
    ev('supporting', 'verified', { claim_span: 'aaa bbb' }),
    ev('supporting', 'verified', { claim_span: 'aaa bbb' }),
  ]);
  assert.equal(one, two);
  assert.ok(one > 0 && one < 1);
});

test('aggregation takes the strictest label', () => {
  const S = { label: LABELS.SUPPORTED }, C = { label: LABELS.CONTRADICTED };
  const M = { label: LABELS.MISLEADING }, I = { label: LABELS.INSUFFICIENT };
  assert.equal(aggregate([S, C]).label, LABELS.CONTRADICTED);
  assert.equal(aggregate([S, M]).label, LABELS.MISLEADING);
  assert.equal(aggregate([S, S]).label, LABELS.SUPPORTED);
  // Supported + Insufficient is an evidence GAP, not a demonstrated omission.
  assert.equal(aggregate([S, I]).label, LABELS.INSUFFICIENT);
  assert.equal(aggregate([]).label, LABELS.INSUFFICIENT);
});

test('every rule id is reachable and the table is exhaustive', () => {
  const seen = new Set();
  const scenarios = [
    { items: [] },
    { items: [ev('supporting', 'verified')], refKeys: ['IPC:S302'], verifiedRefKeys: [] },
    { items: [ev('contradicting', 'verified')] },
    { items: [ev('supporting', 'verified')] },
    { items: [ev('supporting', 'verified')], missingCondition: { present: true, citation: { status: 'verified' } } },
    { items: [ev('supporting', 'verified'), ev('contradicting', 'verified')] },
    { items: [ev('supporting', 'partially_verified')] },
    { items: [ev('supporting', 'verified', { claim_span: 'murder', passage: 'x' })] },
  ];
  for (const s of scenarios) seen.add(decide({ subClaimText: CLAIM, ...s }).rule_id);
  for (const rule of ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']) {
    assert.ok(seen.has(rule), `rule ${rule} was never reached by the scenario set`);
  }
});
