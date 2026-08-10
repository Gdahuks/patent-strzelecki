import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { plural } from './plural';

/** The most common case in the app — used here to exercise the whole rule. */
function pytania(count: number): string {
  return `${count} ${plural(count, 'pytanie', 'pytania', 'pytań')}`;
}

describe('plural', () => {
  it('distinguishes the three basic forms', () => {
    assert.equal(pytania(1), '1 pytanie');
    assert.equal(pytania(2), '2 pytania');
    assert.equal(pytania(3), '3 pytania');
    assert.equal(pytania(4), '4 pytania');
    assert.equal(pytania(5), '5 pytań');
  });

  it('zero takes the genitive', () => {
    assert.equal(pytania(0), '0 pytań');
  });

  it('the teens take the genitive despite their ending', () => {
    // This is where counting by the last digit alone falls apart: 13 has the same one as 3.
    assert.equal(pytania(11), '11 pytań');
    assert.equal(pytania(12), '12 pytań');
    assert.equal(pytania(13), '13 pytań');
    assert.equal(pytania(14), '14 pytań');
  });

  it('above twenty, the form goes back to following the ending', () => {
    assert.equal(pytania(21), '21 pytań');
    assert.equal(pytania(22), '22 pytania');
    assert.equal(pytania(25), '25 pytań');
  });

  it("hundreds don't break the teens exception", () => {
    assert.equal(pytania(101), '101 pytań');
    assert.equal(pytania(102), '102 pytania');
    // 111 falls outside the exception (11 isn't 12–14), but it still takes the genitive
    // plural — because of the trailing 1.
    assert.equal(pytania(111), '111 pytań');
    assert.equal(pytania(112), '112 pytań');
    assert.equal(pytania(213), '213 pytań');
  });

  it('declines the verb too, not just the noun', () => {
    assert.equal(plural(1, 'wróci', 'wrócą', 'wróci'), 'wróci');
    assert.equal(plural(2, 'wróci', 'wrócą', 'wróci'), 'wrócą');
    assert.equal(plural(22, 'wróci', 'wrócą', 'wróci'), 'wrócą');
    assert.equal(plural(5, 'wróci', 'wrócą', 'wróci'), 'wróci');
  });
});
