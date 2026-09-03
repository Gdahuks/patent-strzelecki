import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { type Category, partitionQuestions } from './categories';

/**
 * The partition rule on four invented questions.
 *
 * The real map is checked against the content bundle in `categories.package.test.ts`, and that
 * test skips itself where the bundle is absent — which is every fresh clone. This one holds the
 * rule itself: which area wins a question the course files twice, and where a question with no
 * subject at all goes.
 */
const AREAS: Category[] = [
  { slug: 'zg-ogolne', title: 'Ogólne', setSlugs: ['ustawa'], includeUnassigned: true, general: true },
  { slug: 'zg-wask', title: 'Węższe', setSlugs: ['karne'] },
];

const sets = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

describe('partitionQuestions', () => {
  it('gives a question filed in two areas to the narrower one', () => {
    const areas = partitionQuestions(
      sets({ ustawa: ['a', 'shared'], karne: ['shared'] }),
      ['a', 'shared'],
      AREAS,
    );

    assert.equal(areas.get('shared'), 'zg-wask');
    assert.equal(areas.get('a'), 'zg-ogolne');
  });

  it('sends a question with no thematic set to the area that takes them', () => {
    const areas = partitionQuestions(
      sets({ ustawa: ['a'], wszystkie: ['a', 'loose'] }),
      ['a', 'loose'],
      AREAS,
    );

    // The umbrella set says nothing about a subject, so "loose" counts as unassigned.
    assert.equal(areas.get('loose'), 'zg-ogolne');
  });

  it('leaves a question outside every area when nothing claims it', () => {
    const areas = partitionQuestions(sets({ wpa: ['w'], karne: ['k'] }), ['w', 'k'], [AREAS[1]]);

    assert.equal(areas.has('w'), false);
    assert.equal(areas.get('k'), 'zg-wask');
  });

  it('ignores a set naming a question the bundle does not carry', () => {
    // Otherwise the ghost gets an area, is counted in `seen`, lands in `missed`, and then
    // vanishes when the drill turns ids back into questions.
    const areas = partitionQuestions(sets({ karne: ['k', 'ghost'] }), ['k'], AREAS);

    assert.deepEqual([...areas], [['k', 'zg-wask']]);
  });

  it('gives every question exactly one area', () => {
    const areas = partitionQuestions(
      sets({ ustawa: ['a', 'shared'], karne: ['shared', 'k'], wszystkie: ['loose'] }),
      ['a', 'shared', 'k', 'loose'],
      AREAS,
    );

    assert.equal(areas.size, 4);
    assert.deepEqual(
      [...new Set(areas.values())].sort(),
      ['zg-ogolne', 'zg-wask'],
    );
  });
});
