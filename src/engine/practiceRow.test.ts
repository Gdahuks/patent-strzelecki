import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { practiceRowLabel } from './practiceRow';

const ROW = {
  title: 'Ustawa',
  count: 33,
  ratio: 0.5,
  needsWork: 1,
  learning: 2,
  mastered: 3,
  untouched: 27,
  weak: false,
};

describe('the practice row label', () => {
  it('inflects the question count the way the row shows it', () => {
    for (const [count, words] of [
      [1, '1 pytanie'],
      [3, '3 pytania'],
      [5, '5 pytań'],
      [13, '13 pytań'],
      [22, '22 pytania'],
      [33, '33 pytania'],
      [93, '93 pytania'],
    ] as const) {
      assert.match(practiceRowLabel({ ...ROW, count }), new RegExp(`^Ustawa\\. ${words},`));
    }
  });

  it('reads the whole row as one sentence', () => {
    assert.equal(
      practiceRowLabel(ROW),
      'Ustawa. 33 pytania, 50 procent. Do poprawy 1, w trakcie 2, opanowane 3, nietknięte 27',
    );
  });

  it('says what the mistakes set holds, as the row does, and has no untouched questions', () => {
    assert.equal(
      practiceRowLabel({ ...ROW, title: 'Moje błędy', count: 2, weak: true }),
      'Moje błędy. 2 pytania z pomyłkami, 50 procent. Do poprawy 1, w trakcie 2, opanowane 3',
    );
  });
});
