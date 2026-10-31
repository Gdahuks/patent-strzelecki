import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it } from 'vitest';

/**
 * The rule two screens read a practice route by.
 *
 * A package test rather than a plain one because the titles come from the bundle: importing
 * the store at all needs `assets/content/`, which lives outside this repository.
 */
const PRESENT = existsSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../assets/content/content.json'),
);

/**
 * Imported inside the suite: `practiceSet` reads the store for its titles, and the store
 * requires the bundle as it loads — a top-level import would throw before `skipIf` runs.
 */
let planPracticeSet: typeof import('./practiceSet').planPracticeSet;
let practiceSetTitle: typeof import('./practiceSet').practiceSetTitle;

describe.skipIf(!PRESENT)('planPracticeSet', () => {
  beforeAll(async () => {
    ({ planPracticeSet, practiceSetTitle } = await import('./practiceSet'));
  });

  it('reads the virtual set of my mistakes', () => {
    assert.deepEqual(planPracticeSet(['moje-bledy']), { kind: 'weak' });
    assert.equal(practiceSetTitle(planPracticeSet(['moje-bledy'])), 'Moje błędy');
  });

  it('is a plain set of sets', () => {
    const plan = planPracticeSet(['zg-budowa']);

    assert.deepEqual(plan, { kind: 'sets', slugs: ['zg-budowa'] });
    assert.equal(practiceSetTitle(plan), 'Budowa broni i przepisy ISSF');
  });
});
