import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counted } from '../../src/player/plural.ts';

// Expected forms are the English and German grammar for these nouns, written out here, not taken from the catalogs.
test('counted phrases follow the plural rules of English and German', () => {
  const arrows = { en: { one: '{n} arrow', other: '{n} arrows' }, de: { one: '{n} Pfeil', other: '{n} Pfeile' } } as const;
  assert.deepEqual([0, 1, 2, 11].map(n => counted('en', n, arrows.en)), ['0 arrows', '1 arrow', '2 arrows', '11 arrows']);
  assert.deepEqual([0, 1, 2, 21].map(n => counted('de', n, arrows.de)), ['0 Pfeile', '1 Pfeil', '2 Pfeile', '21 Pfeile']);
  assert.equal(counted('en', 1, { one: '{n} near miss', other: '{n} near misses' }), '1 near miss');
  assert.equal(counted('en', 3, { one: '{n} near miss', other: '{n} near misses' }), '3 near misses');
});
