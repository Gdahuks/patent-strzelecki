import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { planPracticeSet, practiceSetTitle } from './practiceSet';

/**
 * The rule three screens read a practice route by.
 *
 * A package test rather than a plain one because the titles come from the bundle: importing
 * the store at all needs `assets/content/`, which lives outside this repository.
 */
const PRESENT = existsSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../assets/content/content.json'),
);

describe.skipIf(!PRESENT)('planPracticeSet', () => {
  it('reads the virtual set of my mistakes', () => {
    assert.deepEqual(planPracticeSet(['moje-bledy']), { kind: 'weak' });
    assert.equal(practiceSetTitle(planPracticeSet(['moje-bledy'])), 'Moje błędy');
  });

  it('narrows an area to its exam mistakes when the route carries a profile', () => {
    const plan = planPracticeSet(['zg-uobia'], 'patent');

    assert.deepEqual(plan, { kind: 'mistakes', area: 'zg-uobia', profile: 'patent' });
    assert.equal(practiceSetTitle(plan), 'Pomyłki: UoBiA i przepisy wykonawcze');
  });

  it('ignores the profile on a course set, which has no such measurement', () => {
    // The counter that promises those questions lives on the area screen, and only areas have
    // one. Honouring the parameter here would narrow a set by a number nothing displays.
    const plan = planPracticeSet(['uobia'], 'patent');

    assert.deepEqual(plan, { kind: 'sets', slugs: ['uobia'] });
  });

  it('ignores the profile on several sets at once', () => {
    assert.deepEqual(planPracticeSet(['uobia', 'prawo-karne'], 'patent'), {
      kind: 'sets',
      slugs: ['uobia', 'prawo-karne'],
    });
  });

  it('is a plain set of sets without a profile', () => {
    const plan = planPracticeSet(['zg-budowa']);

    assert.deepEqual(plan, { kind: 'sets', slugs: ['zg-budowa'] });
    assert.equal(practiceSetTitle(plan), 'Budowa broni i przepisy ISSF');
  });
});
