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
  {
    slug: 'zg-ogolne',
    title: 'Ogólne',
    setSlugs: ['ustawa'],
    includeUnassigned: true,
    general: true,
    actName: 'Ustawa',
  },
  { slug: 'zg-wask', title: 'Węższe', setSlugs: ['karne'], ownsArticles: ['51'] },
];

const sets = (entries: Record<string, string[]>) => new Map(Object.entries(entries));
/** Questions as the bundle carries them: an id and, sometimes, a legal basis. */
const questions = (...entries: (string | [string, string])[]) =>
  entries.map((entry) =>
    typeof entry === 'string' ? { id: entry } : { id: entry[0], law: entry[1] },
  );

describe('partitionQuestions', () => {
  it('gives a question filed in two areas to the narrower one', () => {
    const areas = partitionQuestions(
      sets({ ustawa: ['a', 'shared'], karne: ['shared'] }),
      questions('a', ['shared', 'Ustawa - Art. 51']),
      AREAS,
    );

    assert.equal(areas.get('shared'), 'zg-wask');
    assert.equal(areas.get('a'), 'zg-ogolne');
  });

  it('sends a question with no thematic set to the area that takes them', () => {
    const areas = partitionQuestions(
      sets({ ustawa: ['a'], wszystkie: ['a', 'loose'] }),
      questions('a', 'loose'),
      AREAS,
    );

    // The umbrella set says nothing about a subject, so "loose" counts as unassigned.
    assert.equal(areas.get('loose'), 'zg-ogolne');
  });

  it('leaves a question outside every area when nothing claims it', () => {
    const areas = partitionQuestions(sets({ wpa: ['w'], karne: ['k'] }), questions('w', 'k'), [AREAS[1]]);

    assert.equal(areas.has('w'), false);
    assert.equal(areas.get('k'), 'zg-wask');
  });

  it('ignores a set naming a question the bundle does not carry', () => {
    // Otherwise the ghost gets an area, is counted in `seen`, lands in `missed`, and then
    // vanishes when the drill turns ids back into questions.
    const areas = partitionQuestions(sets({ karne: ['k', 'ghost'] }), questions('k'), AREAS);

    assert.deepEqual([...areas], [['k', 'zg-wask']]);
  });

  it('keeps a contested question where the cited article says it belongs', () => {
    // The narrower area declares the articles it owns, so the set's name stops deciding: an
    // owned article keeps the question there, anything else hands it to the general area.
    const areas = partitionQuestions(
      sets({ ustawa: ['karne', 'obowiazek'], karne: ['karne', 'obowiazek'] }),
      questions(['karne', 'Ustawa - Art. 51, ust. 2'], ['obowiazek', 'Ustawa - Art. 18, ust. 6']),
      AREAS,
    );

    assert.equal(areas.get('karne'), 'zg-wask');
    assert.equal(areas.get('obowiazek'), 'zg-ogolne');
  });

  it('leaves a contested question with the narrower area when it cites no article', () => {
    // Nothing to decide by, so the course's own filing stands — the fallback has to be the
    // behaviour from before the articles were declared.
    const areas = partitionQuestions(
      sets({ ustawa: ['x'], karne: ['x'] }),
      questions(['x', 'Ustawa, bez artykułu']),
      AREAS,
    );

    assert.equal(areas.get('x'), 'zg-wask');
  });

  it('lets another act keep the question, whatever its article number is', () => {
    // `ownsArticles` are the Act's articles, so only a basis citing the Act can be measured
    // against them. Art. 263 of the penal code is penal law; reading its number as if it were
    // the Act's would hand it to the group where a single mistake fails the paper.
    const areas = partitionQuestions(
      sets({ ustawa: ['kk'], karne: ['kk'] }),
      questions(['kk', 'KK - Art. 263, § 2']),
      AREAS,
    );

    assert.equal(areas.get('kk'), 'zg-wask');
  });

  it('leaves out an unfiled question whose basis names a source no area covers', () => {
    // The stamp duty on a promesa is neither the Act nor anything issued under it, and the
    // catch-all would otherwise put it where a single mistake fails the paper.
    const areas = partitionQuestions(
      sets({ wszystkie: ['oplata', 'praktyka'] }),
      questions(['oplata', 'Wykaz przedmiotów opłaty skarbowej pkt 21'], 'praktyka'),
      AREAS,
    );

    assert.equal(areas.has('oplata'), false);
    assert.equal(areas.get('praktyka'), 'zg-ogolne');
  });

  it('keeps an unfiled question whose basis is unrecognised rather than foreign', () => {
    // One question in the bundle carries the course author's note where a citation belongs.
    // Excluding by "does not look like a citation" would throw it out of the exam; the rule
    // excludes only sources it can name.
    const areas = partitionQuestions(
      sets({ wszystkie: ['notka'] }),
      questions(['notka', 'Pytanie jest POPRAWNE, serio. Nie pisz mi o nim.']),
      AREAS,
    );

    assert.equal(areas.get('notka'), 'zg-ogolne');
  });

  it('gives every question exactly one area', () => {
    const areas = partitionQuestions(
      sets({ ustawa: ['a', 'shared'], karne: ['shared', 'k'], wszystkie: ['loose'] }),
      questions('a', ['shared', 'Ustawa - Art. 51'], ['k', 'Ustawa - Art. 51'], 'loose'),
      AREAS,
    );

    assert.equal(areas.size, 4);
    assert.deepEqual(
      [...new Set(areas.values())].sort(),
      ['zg-ogolne', 'zg-wask'],
    );
  });
});
