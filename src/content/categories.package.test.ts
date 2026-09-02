import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { ALL_SET_SLUG, CATEGORIES } from './categories';
import { profileAvailable, profileLayers } from './examPool';
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
    // The two numbers are the point: they are frozen on purpose, so that a refreshed content
    // bundle stops the build instead of quietly changing what the exam asks about.
    const inAreas = content.questions.filter((question) => areasOf(question.id).length > 0);
    const advice = 'paczka treści odświeżona? sprawdź CATEGORIES i liczby w tym teście';

    assert.equal(inAreas.length, 456, `pula patentowa: ${inAreas.length} — ${advice}`);
    assert.equal(wpa.size, 200, `zestaw wpa: ${wpa.size} — ${advice}`);
  });

  it('lets both profiles compose a paper from this bundle', () => {
    // The one thing no unit test can see: the engine knows layers by slug and never resolves
    // them, so a typo in `layers[].category` passes types, lint and every test on fixtures —
    // and then shows up as an exam quietly missing from the switch.
    for (const profile of [PATENT_PROFILE, WPA_PROFILE]) {
      profileLayers(profile).forEach((questions, index) => {
        const layer = profile.layers[index];
        assert.ok(
          questions.length >= layer.count,
          `${profile.id}: warstwa ${layer.category} ma ${questions.length} pytań, `
            + `potrzeba ${layer.count}`,
        );
      });

      assert.ok(profileAvailable(profile), profile.id);
    }
  });
});
