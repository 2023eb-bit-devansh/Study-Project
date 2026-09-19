import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReference, buildRefKey, expandAliases, parentKeys,
  actCodeFor, extractReferences, formatRefKey, EQUIVALENCES,
} from '../../src/corpus/refKey.js';

test('the six common ways of writing one section all canonicalise identically', () => {
  const forms = [
    'Section 302 of the Indian Penal Code',
    'Sec. 302 of the IPC',
    'S.302, Indian Penal Code',
    'IPC 302',
    '§302 IPC',
    'section 302 ipc',
  ];
  for (const f of forms) {
    assert.equal(buildRefKey(parseReference(f)), 'IPC:S302', `failed on "${f}"`);
  }
});

test('articles and subsections build the right keys', () => {
  assert.equal(buildRefKey(parseReference('Article 19(1)(a)')), 'CONST:A19(1)(a)');
  assert.equal(buildRefKey(parseReference('Art. 21 of the Constitution')), 'CONST:A21');
  assert.equal(buildRefKey(parseReference('Section 8(1) of the RTI Act')), 'RTI:S8(1)');
  assert.equal(buildRefKey(parseReference('Section 66A of the Information Technology Act, 2000')), 'IT:S66A');
});

test('act matching is word-boundary anchored', () => {
  // "a-RTI-cle" must not resolve to the RTI Act.
  assert.equal(actCodeFor('Article 19'), null);
  assert.equal(buildRefKey(parseReference('Article 19(1)(a)')), 'CONST:A19(1)(a)');
  assert.equal(actCodeFor('the RTI Act'), 'RTI');
});

test('a year is never mistaken for a section number', () => {
  const p = parseReference('the Indian Penal Code, 1860');
  assert.equal(p.section, '', `parsed "${p.section}" as a section`);
});

test('alias expansion follows the recodification in both directions', () => {
  assert.deepEqual(expandAliases('IPC:S302').sort(), ['BNS:S103', 'IPC:S302']);
  assert.deepEqual(expandAliases('BNS:S103').sort(), ['BNS:S103', 'IPC:S302']);
  assert.ok(expandAliases('CRPC:S154').includes('BNSS:S173'));
  assert.ok(expandAliases('IEA:S25').includes('BSA:S23'));
});

test('parent keys broaden a subsection reference', () => {
  assert.deepEqual(parentKeys('RTI:S8(1)'), ['RTI:S8']);
  assert.deepEqual(parentKeys('CONST:A19(1)(a)'), ['CONST:A19(1)', 'CONST:A19']);
  assert.deepEqual(parentKeys('IPC:S302'), []);
  assert.ok(expandAliases('RTI:S8(1)').includes('RTI:S8'));
});

test('references are extracted from running claim text', () => {
  assert.deepEqual(
    extractReferences('Under Section 302 of the Indian Penal Code, murder is punishable with death.').map((r) => r.ref_key),
    ['IPC:S302'],
  );
  assert.deepEqual(
    extractReferences('Article 19(1)(a) guarantees free speech but Article 19(2) allows restrictions.').map((r) => r.ref_key),
    ['CONST:A19(1)(a)', 'CONST:A19(2)'],
  );
  // A claim naming no provision yields none — which lets gate G1 pass trivially.
  assert.deepEqual(extractReferences('The RTI Act gives any citizen the right to information.').map((r) => r.ref_key), []);
});

test('every equivalence row is well formed and symmetric', () => {
  for (const { a, b } of EQUIVALENCES) {
    assert.match(a, /^[A-Z]+:[SA][\dA-Z()]+$/, `malformed key ${a}`);
    assert.match(b, /^[A-Z]+:[SA][\dA-Z()]+$/, `malformed key ${b}`);
    assert.ok(expandAliases(a).includes(b), `${a} does not expand to ${b}`);
    assert.ok(expandAliases(b).includes(a), `${b} does not expand to ${a}`);
  }
});

test('formatting is human-readable', () => {
  assert.equal(formatRefKey('IPC:S302'), 'IPC s.302');
  assert.equal(formatRefKey('CONST:A19(1)(a)'), 'Constitution Art. 19(1)(a)');
});
