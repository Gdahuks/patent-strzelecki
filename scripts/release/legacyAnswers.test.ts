import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildLegacyAnswers, storesLetters, type ShippedBundle } from './legacyAnswers.ts';

const LETTERS: ShippedBundle = {
  version: 'v1',
  questions: [
    { id: 'q2', answers: { A: 'a2', B: 'b2', C: 'c2' }, correct: 'C' },
    { id: 'q1', answers: { A: 'a1', B: 'b1', C: 'c1' }, correct: 'A' },
  ],
};

describe('the legacy answers table', () => {
  it('reads each letter-era bundle as id → [A, B, C, correct]', () => {
    const table = buildLegacyAnswers([LETTERS]);

    const key = table.versions.v1;
    assert.deepEqual(table.tables[key].q1, ['a1', 'b1', 'c1', 'A']);
    assert.deepEqual(table.tables[key].q2, ['a2', 'b2', 'c2', 'C']);
  });

  it('stores one table for versions that share their answers', () => {
    const table = buildLegacyAnswers([LETTERS, { ...LETTERS, version: 'v2' }]);

    assert.equal(Object.keys(table.tables).length, 1);
    assert.equal(table.versions.v1, table.versions.v2);
  });

  it('a reshuffle is a different table', () => {
    const reshuffled: ShippedBundle = {
      version: 'v3',
      questions: [{ id: 'q1', answers: { A: 'b1', B: 'a1', C: 'c1' }, correct: 'B' }],
    };

    const table = buildLegacyAnswers([LETTERS, reshuffled]);

    assert.equal(Object.keys(table.tables).length, 2);
  });

  it('skips bundles that already carry answer ids', () => {
    const pooled = { version: 'v9', questions: [{ id: 'q1' }] } as ShippedBundle;

    assert.equal(storesLetters(pooled), false);
    assert.deepEqual(buildLegacyAnswers([pooled]), { versions: {}, tables: {} });
  });
});
