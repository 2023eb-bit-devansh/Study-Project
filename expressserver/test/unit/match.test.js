import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchQuote, withMatchedText } from '../../src/citation/match.js';
import { levenshtein, ratio } from '../../src/citation/levenshtein.js';

const IPC302 = 'Section 302. Punishment for murder\nWhoever commits murder shall be punished with death, or imprisonment for life, and shall also be liable to fine.';

test('levenshtein basics and the maxDist early exit', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('', 'abc'), 3);
  // Early exit returns maxDist+1 rather than the true distance.
  assert.equal(levenshtein('kitten', 'sitting', 1), 2);
  assert.equal(ratio('abc', 'abc'), 1);
});

test('tier 0: a character-for-character quote matches exactly', () => {
  const r = matchQuote(IPC302, 'Whoever commits murder shall be punished with death, or imprisonment for life, and shall also be liable to fine.');
  assert.equal(r.tier, 'exact');
  assert.equal(r.similarity, 1);
});

test('tier 1: punctuation and spacing differences still match', () => {
  const r = matchQuote(IPC302, 'Whoever commits murder shall be punished with death or  imprisonment for life and shall also be liable to fine');
  assert.equal(r.tier, 'normalized');
  assert.equal(r.similarity, 1);
});

test('tier 2: a dropped word degrades to fuzzy but stays above the verify threshold', () => {
  const r = matchQuote(IPC302, 'Whoever commits murder shall be punished with death, or imprisonment for life, and shall be liable to fine.');
  assert.equal(r.tier, 'fuzzy');
  assert.ok(r.similarity >= 0.9, `expected >= 0.9, got ${r.similarity}`);
});

test('a paraphrase does not match at all', () => {
  const r = matchQuote(IPC302, 'Murder is punishable by the death penalty or a life sentence under Indian law.');
  assert.equal(r.tier, 'none');
  assert.equal(r.similarity, 0);
});

test('word order matters — character Levenshtein is not token Jaccard', () => {
  const src = 'the accused shall not be punished under this section';
  const scrambled = matchQuote(src, 'the accused shall be punished not under this section');
  // Token-set similarity would call these identical. They are not.
  assert.ok(scrambled.similarity < 1, `reordered negation scored ${scrambled.similarity}`);
});

test('the matched span points at real source text', () => {
  const r = withMatchedText(IPC302, matchQuote(IPC302, 'imprisonment for life, and shall also be liable to fine'));
  assert.ok(r.span);
  assert.ok(IPC302.slice(r.span.start, r.span.end).includes('imprisonment for life'));
});

test('empty quote or empty source yields no match', () => {
  assert.equal(matchQuote(IPC302, '').tier, 'none');
  assert.equal(matchQuote('', 'anything').tier, 'none');
});
