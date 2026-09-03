import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it } from 'vitest';

import { ALL_SET_SLUG, CATEGORIES, lawArticle, namesForeignSource } from './categories';
import type { ContentBundle } from './types';
import { PATENT_PROFILE, WPA_PROFILE } from '../engine/exam';

/**
 * The subject-area map checked against the real bundle.
 *
 * This map is a silent assumption: nothing on screen says which area a question belongs to,
 * so an error here shows up as **material the user simply never sees** — the worst kind of
 * defect in a learning app. Hence a test on real content and not only on the rules.
 *
 * The test **skips itself** when there's no bundle, the same way `acts.package.test.ts` does:
 * `assets/content/` lives outside this repository because it carries the course's questions.
 */
const DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../../assets/content');
const PRESENT = existsSync(join(DIRECTORY, 'content.json'));

/** The course's own list of 200 questions for the police exam — a different exam entirely. */
const WPA_SET_SLUG = 'wpa';

function bundle(): ContentBundle {
  return JSON.parse(readFileSync(join(DIRECTORY, 'content.json'), 'utf8')) as ContentBundle;
}

function idsOf(slugs: readonly string[], sets: ContentBundle['sets']): Set<string> {
  const byslug = new Map(sets.map((set) => [set.slug, set]));
  return new Set(slugs.flatMap((slug) => byslug.get(slug)?.questionIds ?? []));
}

/**
 * Everything this suite reads is loaded in `beforeAll`, nothing at the top of the file and
 * nothing in the body of `describe`.
 *
 * Both would run where the bundle is absent — a top-level import of the store throws as the
 * module graph is built (the store requires the bundle), and a `describe` body runs during
 * collection even for a suite that `skipIf` will skip. A fresh clone and CI are exactly that
 * case, so the loads have to sit in a hook, which runs only for a suite that isn't skipped.
 */
let store: typeof import('./store').content;
let profileBands: typeof import('./examPool').profileBands;
let profileAvailable: typeof import('./examPool').profileAvailable;
let content: ContentBundle;
let unassigned: string[];
let wpa: Set<string>;

describe.skipIf(!PRESENT)('subject areas on the real bundle', () => {
  beforeAll(async () => {
    store = (await import('./store')).content;
    ({ profileBands, profileAvailable } = await import('./examPool'));

    content = bundle();
    const assigned = new Set(
      content.sets.filter((set) => set.slug !== ALL_SET_SLUG).flatMap((set) => set.questionIds),
    );
    unassigned = content.questions
      .filter((question) => !assigned.has(question.id))
      .map((question) => question.id);
    wpa = idsOf([WPA_SET_SLUG], content.sets);
  });

  /** Areas whose *sets* claim a question, before the general area yields it. */
  function claimedBy(id: string): string[] {
    return CATEGORIES.filter((category) => {
      if (idsOf(category.setSlugs, content.sets).has(id)) return true;
      return category.includeUnassigned === true && unassigned.includes(id);
    }).map((category) => category.slug);
  }

  it('leaves no question outside the exam except the police set and foreign subjects', () => {
    // The one that would break silently: a question in no area is a question the paper can
    // never ask, and nothing on screen would say so. Two groups are outside on purpose — the
    // police list, and the handful whose basis names a source no § 19 area covers.
    const orphans = content.questions
      .filter((question) => !wpa.has(question.id) && store.areaOf(question.id) === undefined)
      .map((question) => ({ id: question.id, law: question.law ?? '' }));

    for (const orphan of orphans) {
      assert.ok(
        namesForeignSource(orphan.law),
        `${orphan.id} jest poza zagadnieniami, a jego podstawa to ${orphan.law || '‹brak›'}`,
      );
    }
    assert.equal(orphans.length, 3, 'poza egzaminem: opłata skarbowa ×2 i termin z KPA');
  });

  it('gives every question exactly one area', () => {
    // The partition is the whole model: the paper draws a slot from one area and the
    // diagnosis counts the answer in one row, so those two can never disagree.
    for (const question of content.questions) {
      const area = store.areaOf(question.id);
      if (area === undefined) continue;
      const holders = CATEGORIES.filter((category) =>
        store.questionsForSets([category.slug]).some((entry) => entry.id === question.id),
      );
      assert.deepEqual(holders.map((category) => category.slug), [area], question.id);
    }
  });

  it('splits the double-filed questions by the article they cite', () => {
    // The course files 43 questions under both "UoBiA" and "Prawo karne", and they are two
    // different things: the Act's own penal chapter, and the permit regime of the same Act.
    // Deciding by the set's name kept obligations of a licence holder out of the opening four.
    const contested = content.questions.filter((question) => claimedBy(question.id).length > 1);
    const penal = contested.filter((question) =>
      ['49', '49a', '50', '51', '51a'].includes(lawArticle(question.law ?? '') ?? ''),
    );

    assert.equal(contested.length, 43);
    // Comparing bare article numbers only means something while every contested basis names
    // the Act — the rule checks the act too, and this is what keeps the assertion honest.
    for (const question of contested) {
      assert.ok(
        (question.law ?? '').trimStart().startsWith('UoBiA'),
        `sporne pytanie cytuje inny akt: „${question.law}" (${question.id})`,
      );
    }
    assert.equal(penal.length, 24, 'art. 50 i 51 — rozdział „Przepisy karne"');
    for (const question of penal) {
      assert.equal(store.areaOf(question.id), 'zg-prawo-karne', question.id);
    }
    for (const question of contested.filter((entry) => !penal.includes(entry))) {
      assert.equal(store.areaOf(question.id), 'zg-uobia', question.id);
    }
  });

  it('recognises where every question that can open the paper comes from', () => {
    // The exclusion rule only knows the sources it is told about, so a content refresh could
    // bring a new one into the group where a single mistake fails the paper. This turns the
    // question around: every basis in the critical pool has to start with something on this
    // list, so an unrecognised one fails the build with its own text and becomes a decision.
    //
    // Prefixes, not normalised names: the course writes a basis in whatever shape it likes
    // („UoBiA - Art. 18, ust. 6", „§2 ust. 1 rozporządzenia w sprawie przewożenia…"), and
    // three attempts at a general normaliser were worse than reading the first word. The
    // author's note is on the list on purpose — it is known, and the question under it is
    // about storing ammunition in an S1 cabinet, which belongs here.
    // Only prefixes that are actually there. `KK`, `§` and a lowercase `rozporządzenie` were
    // on this list and appear nowhere in the critical pool — a dead entry is worse than a
    // missing one, because it pre-approves a source nobody has looked at.
    const accepted = [
      'UoBiA',
      'Rozporządzenie',
      'Ogólne zasady bezpieczeństwa',
      'Pytanie jest POPRAWNE',
    ];
    const critical = PATENT_PROFILE.layers
      .filter((layer) => layer.critical)
      .flatMap((layer) => layer.sources.map((source) => source.category));

    for (const slug of critical) {
      for (const question of store.questionsForSets([slug])) {
        const law = (question.law ?? '').trimStart();
        assert.ok(
          law === '' || accepted.some((prefix) => law.startsWith(prefix)),
          `nieznane źródło w puli krytycznej: „${law}" (${question.id})`,
        );
      }
    }
  });

  it('keeps the police set out of the licence exam', () => {
    for (const id of wpa) {
      assert.equal(store.areaOf(id), undefined, id);
    }
  });

  it('accounts for every question in the bundle', () => {
    // The numbers are frozen on purpose, so that a refreshed content bundle stops the build
    // instead of quietly changing what the exam asks about. They also have to add up: the
    // areas partition the licence pool, so their sizes sum to it exactly.
    const advice = 'paczka treści odświeżona? sprawdź CATEGORIES i liczby w tym teście';
    const sizes = new Map(
      CATEGORIES.map((category) => [category.slug, store.questionsForSets([category.slug]).length]),
    );

    assert.deepEqual(
      [...sizes],
      [
        ['zg-uobia', 268],
        ['zg-bezpieczenstwo', 24],
        ['zg-regulaminy', 36],
        ['zg-budowa', 84],
        ['zg-prawo-karne', 41],
      ],
      advice,
    );

    const inAreas = content.questions.filter(
      (question) => store.areaOf(question.id) !== undefined,
    );
    assert.equal(inAreas.length, 453, `pula patentowa: ${inAreas.length} — ${advice}`);
    assert.equal(
      [...sizes.values()].reduce((sum, size) => sum + size, 0),
      inAreas.length,
      'suma zagadnień musi się równać puli — inaczej zagadnienia nie są rozłączne',
    );
    assert.equal(wpa.size, 200, `zestaw wpa: ${wpa.size} — ${advice}`);
  });

  it('lets both profiles compose a paper from this bundle', () => {
    // The one thing no unit test can see: the engine knows areas by slug and never resolves
    // them, so a typo in a source's category passes types, lint and every test on fixtures —
    // and then shows up as an exam quietly missing from the switch.
    for (const profile of [PATENT_PROFILE, WPA_PROFILE]) {
      profileBands(profile).forEach((pools, bandIndex) => {
        const layer = profile.layers[bandIndex];
        pools.forEach((questions, sourceIndex) => {
          const source = layer.sources[sourceIndex];
          const needed = Math.min(layer.count, source.max ?? layer.count);
          assert.ok(
            questions.length >= needed,
            `${profile.id}: źródło ${source.category} ma ${questions.length} pytań, `
              + `potrzeba ${needed}`,
          );
        });
      });

      assert.ok(profileAvailable(profile), profile.id);
    }
  });
});
