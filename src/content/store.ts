/**
 * Access to the content bundle.
 *
 * The content itself is compiled into the app as a JSON module — 650 KB of text loads once
 * at startup and needs no disk access. Separately, on first launch, lessons and images get
 * materialized to disk (see materialize.ts), because the WebView needs a file for the
 * relative image paths to resolve against.
 */

import { ALL_SET_SLUG, CATEGORIES, category } from './categories';
import type { Category } from './categories';
import type { ContentBundle, Lesson, Question, QuestionSet } from './types';

/**
 * A virtual set: it isn't in the content bundle, it's assembled from the progress database.
 * The slug is reserved — the course has no set by this name.
 */
export const WEAK_SET_SLUG = 'moje-bledy';
export const WEAK_SET_TITLE = 'Moje błędy';

const bundle = require('../../assets/content/content.json') as ContentBundle;

const questionsById = new Map(bundle.questions.map((question) => [question.id, question]));
const lessonsBySlug = new Map(bundle.lessons.map((lesson) => [lesson.slug, lesson]));
const setsBySlug = new Map(bundle.sets.map((set) => [set.slug, set]));

/**
 * Questions the course files under no subject at all — see `Category.includeUnassigned`.
 *
 * Computed once from the bundle: everything that belongs to no set except the umbrella one.
 */
const unassignedIds: string[] = (() => {
  const assigned = new Set<string>();
  for (const set of bundle.sets) {
    if (set.slug === ALL_SET_SLUG) continue;
    for (const id of set.questionIds) assigned.add(id);
  }
  return bundle.questions
    .filter((question) => !assigned.has(question.id))
    .map((question) => question.id);
})();

/** Ids an area claims from the course's sets, before the narrower area gets its say. */
function claimedBy(entry: Category): Set<string> {
  const ids = new Set(
    entry.setSlugs.flatMap((setSlug) => setsBySlug.get(setSlug)?.questionIds ?? []),
  );
  if (entry.includeUnassigned) for (const id of unassignedIds) ids.add(id);
  return ids;
}

/**
 * The one area each question belongs to — the single source of that fact in the app.
 *
 * Areas are a partition (see `categories.ts`), and this map is what makes them one: a narrower
 * area takes a question the general area also claims. Everything about areas is read from
 * here — the pools the paper is drawn from, the rows of the diagnosis, the questions behind an
 * area's flashcards — so the paper and the numbers about it cannot drift apart.
 *
 * The 200 WPA questions are in no area at all; the map simply has no entry for them.
 */
const areaByQuestion: Map<string, string> = (() => {
  const areas = new Map<string, string>();
  const general = CATEGORIES.filter((entry) => entry.general);

  for (const entry of CATEGORIES) {
    if (entry.general) continue;
    for (const id of claimedBy(entry)) areas.set(id, entry.slug);
  }
  for (const entry of general) {
    for (const id of claimedBy(entry)) if (!areas.has(id)) areas.set(id, entry.slug);
  }
  return areas;
})();

/**
 * Each area's questions, in bundle order.
 *
 * Built from `areaByQuestion` rather than from the sets, so an area's list is exactly the
 * questions the area owns. Bundle order, not set order: it is stable across content refreshes
 * of the sets themselves, and nothing downstream depends on the old order — the practice deck
 * orders by bucket and the exam draws at random.
 */
const idsByArea: Map<string, string[]> = (() => {
  const lists = new Map<string, string[]>(CATEGORIES.map((entry) => [entry.slug, []]));
  for (const question of bundle.questions) {
    const area = areaByQuestion.get(question.id);
    if (area) lists.get(area)?.push(question.id);
  }
  return lists;
})();

/**
 * Question ids behind a slug, which may name either a course set or one of our categories.
 *
 * Having this in one place is what keeps the practice screen, the question browser and the
 * exam drawing from the same definition of a subject area.
 */
function idsForSlug(slug: string): string[] {
  const entry = category(slug);
  if (!entry) return setsBySlug.get(slug)?.questionIds ?? [];
  return idsByArea.get(entry.slug) ?? [];
}

export const content = {
  version: bundle.version,
  scrapedAt: bundle.scrapedAt,
  source: bundle.source,

  lessons: [...bundle.lessons].sort((a, b) => a.order - b.order),
  sets: bundle.sets,
  questions: bundle.questions,
  glossary: bundle.glossary ?? [],

  lessonSlugs: new Set(bundle.lessons.map((lesson) => lesson.slug)) as ReadonlySet<string>,

  lesson(slug: string): Lesson | undefined {
    return lessonsBySlug.get(slug);
  },

  set(slug: string): QuestionSet | undefined {
    return setsBySlug.get(slug);
  },

  question(id: string): Question | undefined {
    return questionsById.get(id);
  },

  /**
   * Questions for one or several sets at once, without duplicates.
   * Compound sets ("uobia,pzss") are just a shorthand in the course, so we assemble them
   * ourselves. A slug naming one of our exam categories resolves the same way, which is why
   * the practice and question-browser screens needed no change to gain them.
   */
  questionsForSets(slugs: string[]): Question[] {
    const seen = new Set<string>();
    const result: Question[] = [];
    for (const slug of slugs) {
      for (const id of idsForSlug(slug)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const question = questionsById.get(id);
        if (question) result.push(question);
      }
    }
    return result;
  },

  /** Sets attached to a lesson, in the order the course lists them. */
  setsForLesson(slug: string): QuestionSet[] {
    return (lessonsBySlug.get(slug)?.sets ?? [])
      .map((setSlug) => setsBySlug.get(setSlug))
      .filter((set): set is QuestionSet => set !== undefined);
  },

  /** Questions by id, in the given order, skipping any unknown ids. */
  questionsByIds(ids: string[]): Question[] {
    return ids
      .map((id) => questionsById.get(id))
      .filter((question): question is Question => question !== undefined);
  },

  /**
   * The subject area a question belongs to, or undefined when it belongs to none.
   *
   * The exam records nothing about areas on an answer: this is derivable from the question
   * alone, so storing it would be a second copy of the same fact — and it was one, until the
   * copy started disagreeing with this. Deriving it also means the whole attempt history
   * counts, including papers taken before the areas existed.
   */
  areaOf(questionId: string): string | undefined {
    return areaByQuestion.get(questionId);
  },

  /** A set's title — for practice screen headers. */
  titleForSets(slugs: string[]): string {
    const titles = slugs.map((slug) => {
      if (slug === WEAK_SET_SLUG) return WEAK_SET_TITLE;
      return category(slug)?.title ?? setsBySlug.get(slug)?.title ?? slug;
    });
    return titles.length === 1 ? titles[0] : titles.join(' + ');
  },

};
