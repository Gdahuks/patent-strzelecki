import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { ALL_SET_SLUG, CATEGORIES } from './categories';
import { profileAvailable, profileBands } from './examPool';
import { content as store } from './store';
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

describe.skipIf(!PRESENT)('subject areas on the real bundle', () => {
  const content = bundle();
  const assigned = new Set(
    content.sets.filter((set) => set.slug !== ALL_SET_SLUG).flatMap((set) => set.questionIds),
  );
  const unassigned = content.questions
    .filter((question) => !assigned.has(question.id))
    .map((question) => question.id);
  const wpa = idsOf([WPA_SET_SLUG], content.sets);

  /** Areas whose *sets* claim a question, before the general area yields it. */
  function claimedBy(id: string): string[] {
    return CATEGORIES.filter((category) => {
      if (idsOf(category.setSlugs, content.sets).has(id)) return true;
      return category.includeUnassigned === true && unassigned.includes(id);
    }).map((category) => category.slug);
  }

  it('leaves no question outside the exam except the police set', () => {
    // The one that would break silently: a question in no area is a question the paper can
    // never ask, and nothing on screen would say so.
    const orphans = content.questions
      .filter((question) => !wpa.has(question.id) && store.areaOf(question.id) === undefined)
      .map((question) => question.id);

    assert.deepEqual(orphans, []);
  });

  it('gives every question exactly one area', () => {
    // The partition is the whole model: the paper draws a slot from one area and the
    // diagnosis counts the answer in one row, so those two can never disagree. Asserted
    // against the resolution the app actually uses, not against a copy of the rule.
    for (const question of content.questions) {
      const area = store.areaOf(question.id);
      if (area === undefined) continue;
      assert.equal(
        store.questionsForSets([area]).some((entry) => entry.id === question.id),
        true,
        question.id,
      );
      const others = CATEGORIES.filter(
        (category) =>
          category.slug !== area
          && store.questionsForSets([category.slug]).some((entry) => entry.id === question.id),
      );
      assert.deepEqual(others, [], question.id);
    }
  });

  it('resolves the double-filed questions in favour of the narrower area', () => {
    // The course files the Act's own sanctions — art. 51 and art. 18 ust. 5 — under both
    // "UoBiA" and "Prawo karne". Any *other* pair of sets claiming the same question means
    // the course regrouped and the map needs revisiting, since the general flag would then be
    // silently deciding something nobody looked at.
    const contested = content.questions
      .map((question) => ({ id: question.id, areas: claimedBy(question.id) }))
      .filter((entry) => entry.areas.length > 1);

    for (const entry of contested) {
      assert.deepEqual([...entry.areas].sort(), ['zg-prawo-karne', 'zg-uobia'], entry.id);
      assert.equal(store.areaOf(entry.id), 'zg-prawo-karne', entry.id);
    }
    assert.equal(contested.length, 43);
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
        ['zg-uobia', 252],
        ['zg-bezpieczenstwo', 24],
        ['zg-regulaminy', 36],
        ['zg-budowa', 84],
        ['zg-prawo-karne', 60],
      ],
      advice,
    );

    const inAreas = content.questions.filter(
      (question) => store.areaOf(question.id) !== undefined,
    );
    assert.equal(inAreas.length, 456, `pula patentowa: ${inAreas.length} — ${advice}`);
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
