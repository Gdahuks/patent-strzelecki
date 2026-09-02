import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { ALL_SET_SLUG, CATEGORIES } from './categories';
import type { ContentBundle } from './types';

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

  /** Which areas a question falls into, the unassigned rule included. */
  function areasOf(id: string): string[] {
    return CATEGORIES.filter((category) => {
      if (idsOf(category.setSlugs, content.sets).has(id)) return true;
      return category.includeUnassigned === true && unassigned.includes(id);
    }).map((category) => category.slug);
  }

  it('leaves no question outside the exam except the police set', () => {
    // The one that would break silently: a question in no area is a question the paper can
    // never ask, and nothing on screen would say so.
    const orphans = content.questions
      .filter((question) => !wpa.has(question.id) && areasOf(question.id).length === 0)
      .map((question) => question.id);

    assert.deepEqual(orphans, []);
  });

  it('overlaps only where the Act carries its own penal provisions', () => {
    // Two areas on purpose — those questions really are both. Any *other* overlap means the
    // course regrouped its sets and the map needs revisiting.
    const overlapping = content.questions
      .map((question) => areasOf(question.id))
      .filter((areas) => areas.length > 1);

    for (const areas of overlapping) {
      assert.deepEqual([...areas].sort(), ['zg-prawo-karne', 'zg-uobia']);
    }
    assert.equal(overlapping.length, 43);
  });

  it('keeps the police set out of the licence exam', () => {
    for (const id of wpa) {
      assert.deepEqual(areasOf(id), [], id);
    }
  });

  it('accounts for every question in the bundle', () => {
    const inAreas = content.questions.filter((question) => areasOf(question.id).length > 0);

    assert.equal(inAreas.length, 456);
    assert.equal(wpa.size, 200);
    assert.equal(content.questions.length, inAreas.length + wpa.size);
  });

  it('holds enough questions in every area to compose a paper', () => {
    // `profileAvailable` makes the same check at runtime and hides the button; this one says
    // it out loud at build time, with the area's name.
    for (const category of CATEGORIES) {
      const size = content.questions.filter((question) =>
        areasOf(question.id).includes(category.slug),
      ).length;

      assert.ok(size >= 2, `${category.slug} ma ${size} pytań`);
    }
  });
});
