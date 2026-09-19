import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchQuote, withMatchedText } from '../../src/citation/match.js';
import { runGuards, applyGuards, statusForSimilarity, truncateQuote } from '../../src/citation/guards.js';

const IPC420 = 'Whoever cheats and thereby dishonestly induces the person deceived to deliver any property to any person shall be punished with imprisonment of either description for a term which may extend to seven years, and shall also be liable to fine.';

function verify(source, quote, sourceType = 'corpus') {
  const match = withMatchedText(source, matchQuote(source, quote));
  const guards = runGuards({ quote, matchedText: match.matchedText, match, sourceType });
  return { match, guards, status: applyGuards(statusForSimilarity(match), guards) };
}

test('a true quote passes every guard', () => {
  const r = verify(IPC420, 'shall be punished with imprisonment of either description for a term which may extend to seven years, and shall also be liable to fine.');
  assert.equal(r.status, 'verified');
  assert.deepEqual(r.guards, []);
});

test('THE NUMBER GUARD: seven→ten is rejected despite ~0.98 similarity', () => {
  const r = verify(IPC420, 'shall be punished with imprisonment of either description for a term which may extend to ten years, and shall also be liable to fine.');
  assert.ok(r.match.similarity > 0.95, `similarity was ${r.match.similarity}`);
  assert.equal(statusForSimilarity(r.match), 'verified', 'the ratio alone would have accepted it');
  assert.equal(r.status, 'rejected');
  assert.ok(r.guards.some((g) => g.id === 'number_mismatch' && g.action === 'reject'));
});

test('digit formatting alone is not a number mismatch', () => {
  const src = 'the total amount of such penalty shall not exceed 25,000 rupees';
  const r = verify(src, 'the total amount of such penalty shall not exceed 25000 rupees');
  assert.ok(!r.guards.some((g) => g.id === 'number_mismatch'), JSON.stringify(r.guards));
});

test('the negation guard demotes by exactly one tier, it does not reject outright', () => {
  // Legal drafting is negation-dense, so this guard will produce some false
  // alarms. Demotion halves an item's weight in the decision table instead of
  // discarding it, which is why the action is 'demote' rather than 'reject'.
  const r = verify(IPC420, 'shall not be punished with imprisonment of either description for a term which may extend to seven years, and shall also be liable to fine.');
  assert.ok(r.guards.some((g) => g.id === 'negation_mismatch' && g.action === 'demote'));

  const base = statusForSimilarity(r.match);
  const expected = base === 'verified' ? 'partially_verified' : 'rejected';
  assert.equal(r.status, expected, 'demotion must move exactly one tier down from the base status');
});

test('a number-word and its digit form are the same quantity', () => {
  // "within thirty days" and "within 30 days" are a formatting difference,
  // not a changed legal proposition, and the guard must not reject one for
  // the other.
  const src = 'shall provide the information within thirty days of the receipt of the request';
  const r = verify(src, 'shall provide the information within 30 days of the receipt of the request');
  assert.ok(!r.guards.some((g) => g.id === 'number_mismatch'), JSON.stringify(r.guards));
});

test('an unfetchable web source can never support a verdict', () => {
  const r = verify(IPC420, 'shall be punished with imprisonment of either description for a term which may extend to seven years, and shall also be liable to fine.', 'web_unverifiable');
  assert.equal(r.status, 'rejected');
  assert.ok(r.guards.some((g) => g.id === 'source_unavailable'));
});

test('a short non-exact match is rejected, but a short exact one is not', () => {
  const src = 'All citizens shall have the right to information under this Act.';
  const short = verify(src, 'right to information');
  assert.equal(short.match.tier, 'exact');
  assert.equal(short.status, 'verified', 'an exact hit is exempt from the length floor');

  const shortFuzzy = verify(src, 'a right to the information');
  assert.notEqual(shortFuzzy.match.tier, 'exact');
  assert.equal(shortFuzzy.status, 'rejected');
});

test('overlong quotes are truncated, not rejected', () => {
  const long = 'x'.repeat(900);
  const t = truncateQuote(long);
  assert.equal(t.truncated, true);
  assert.equal(t.quote.length, 600);
});
