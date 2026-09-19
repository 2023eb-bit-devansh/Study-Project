import { test } from 'node:test';
import assert from 'node:assert/strict';
import { one, and, or, eq, gte, lte, inList, all } from '../../src/providers/chroma/where.js';

test('a multi-key filter is rejected at build time, not by a Chroma 500', () => {
  // Chroma requires exactly one top-level key. Catching this in a builder
  // beats catching it mid-request during a demo.
  assert.throws(() => one({ a: 1, b: 2 }), /exactly one top-level key/);
  assert.doesNotThrow(() => one({ a: 1 }));
});

test('$and and $or require at least two conditions', () => {
  assert.throws(() => and(eq('a', 1)), /\$and needs >= 2/);
  assert.throws(() => or(eq('a', 1)), /\$or needs >= 2/);
  assert.deepEqual(and(eq('a', 1), eq('b', 2)), { $and: [{ a: { $eq: 1 } }, { b: { $eq: 2 } }] });
});

test('the neighbour-expansion filter is legal', () => {
  const f = and(eq('doc_id', 'ipc-1860'), gte('seq', 11), lte('seq', 13));
  assert.equal(Object.keys(f).length, 1);
  assert.equal(f.$and.length, 3);
  for (const c of f.$and) assert.equal(Object.keys(c).length, 1);
});

test('$in rejects an empty list', () => {
  assert.throws(() => inList('ref_key', []), /non-empty array/);
  assert.deepEqual(inList('ref_key', ['IPC:S302', 'BNS:S103']), { ref_key: { $in: ['IPC:S302', 'BNS:S103'] } });
});

test('all() handles a dynamic number of conditions', () => {
  assert.equal(all(), undefined);
  assert.deepEqual(all(eq('a', 1)), { a: { $eq: 1 } });
  assert.equal(Object.keys(all(eq('a', 1), eq('b', 2)))[0], '$and');
  assert.equal(all(null, undefined, eq('a', 1)).a.$eq, 1);
});
