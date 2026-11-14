import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_MASK, cleanChars, formatMasked, maskTemplate, caretFor, isComplete } from '../../v2/js/core/codemask.js';

const full = 'ABCD2345EFGH6789JKMN0123PQ';

test('kortkode: skilletegn settes inn mens man skriver', () => {
  assert.equal(formatMasked(cleanChars('abc', CARD_MASK), CARD_MASK), 'ABC');
  assert.equal(formatMasked(cleanChars('abcd', CARD_MASK), CARD_MASK), 'ABCD-');
  assert.equal(formatMasked(cleanChars('abcd2', CARD_MASK), CARD_MASK), 'ABCD-2');
  assert.equal(formatMasked(cleanChars(full, CARD_MASK), CARD_MASK), 'ABCD-2345-EFGH-6789-JKMN-0123-PQ');
});

test('kortkode: innliming med og uten skilletegn, og hele QR-innholdet', () => {
  const want = 'ABCD-2345-EFGH-6789-JKMN-0123-PQ';
  assert.equal(formatMasked(cleanChars(want, CARD_MASK), CARD_MASK), want);
  assert.equal(formatMasked(cleanChars('TD2:' + full, CARD_MASK), CARD_MASK), want);
  assert.equal(formatMasked(cleanChars(' abcd 2345 efgh 6789 jkmn 0123 pq ', CARD_MASK), CARD_MASK), want);
  assert.equal(cleanChars(full + 'XYZ', CARD_MASK).length, 26); // for lang tekst kuttes
});

test('kortkode: forvekslingstegn rettes som ellers i appen', () => {
  assert.equal(cleanChars('OIL', CARD_MASK), '011');
});

test('mal, markørposisjon og ferdig-sjekk', () => {
  assert.equal(maskTemplate(CARD_MASK), '____-____-____-____-____-____-__');
  assert.equal(caretFor(0, CARD_MASK), 0);
  assert.equal(caretFor(3, CARD_MASK), 3);
  assert.equal(caretFor(4, CARD_MASK), 5);
  assert.equal(caretFor(5, CARD_MASK), 6);
  assert.equal(caretFor(26, CARD_MASK), 32);
  assert.equal(isComplete(full, CARD_MASK), true);
  assert.equal(isComplete(full.slice(1), CARD_MASK), false);
});
