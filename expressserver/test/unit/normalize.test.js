import { test } from 'node:test';
import assert from 'node:assert/strict';
import { n1, n2, N1, N2, toOriginalSpan } from '../../src/citation/normalize.js';

test('N1 folds typography without changing meaning', () => {
  assert.equal(N1('The  “right”  to ‘know’'), 'the "right" to \'know\'');
  assert.equal(N1('life — liberty – property'), 'life - liberty - property');
  assert.equal(N1('and so on…'), 'and so on...');
});

test('N1 expands legal abbreviations', () => {
  assert.equal(N1('§302'), 'section 302');
  assert.equal(N1('Sec. 304A'), 'section 304a');
  assert.equal(N1('S. 154'), 'section 154');
  assert.equal(N1('Art. 21'), 'article 21');
  assert.equal(N1('Shreya Singhal v. Union'), 'shreya singhal v union');
  assert.equal(N1('I.P.C. and Cr.P.C.'), 'ipc and crpc');
});

test('N1 collapses digit separators so formatting is not read as a quantity', () => {
  assert.equal(N1('a fine of 1,00,000 rupees'), 'a fine of 100000 rupees');
  assert.equal(N1('२०२४'), '2024');
});

test('N1 undoes line-break de-hyphenation', () => {
  assert.equal(N1('punish-\n   ment'), 'punishment');
  // A genuine hyphen inside a line must survive.
  assert.equal(N1('sub-section'), 'sub-section');
});

test('N1 does NOT expand act abbreviations to full names', () => {
  // Expansion would change string length dramatically and wreck the
  // Levenshtein ratio; it belongs in refKey.js instead.
  assert.ok(!N1('ipc').includes('penal'));
});

test('N2 removes remaining punctuation', () => {
  assert.equal(N2('death, or imprisonment for life.'), 'death or imprisonment for life');
});

test('offset map round-trips a span back to the original text', () => {
  const src = 'Whoever  commits   murder shall be punished with death.';
  const norm = n1(src);
  const needle = 'commits murder';
  const at = norm.text.indexOf(needle);
  assert.ok(at >= 0);
  const span = toOriginalSpan(norm, at, at + needle.length);
  assert.equal(src.slice(span.start, span.end), 'commits   murder');
});

test('N2 offset map survives punctuation removal', () => {
  const src = 'death, or imprisonment for life, and fine.';
  const norm = n2(src);
  const at = norm.text.indexOf('imprisonment for life');
  const span = toOriginalSpan(norm, at, at + 'imprisonment for life'.length);
  assert.equal(src.slice(span.start, span.end), 'imprisonment for life');
});

test('empty and whitespace input do not throw', () => {
  assert.equal(N1(''), '');
  assert.equal(N1('   \n  '), '');
  assert.equal(N2(null), '');
});
