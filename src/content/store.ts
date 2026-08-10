/**
 * Access to the content bundle.
 *
 * The content itself is compiled into the app as a JSON module — 650 KB of text loads once
 * at startup and needs no disk access. Separately, on first launch, lessons and images get
 * materialized to disk (see materialize.ts), because the WebView needs a file for the
 * relative image paths to resolve against.
 */

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
   * ourselves.
   */
  questionsForSets(slugs: string[]): Question[] {
    const seen = new Set<string>();
    const result: Question[] = [];
    for (const slug of slugs) {
      for (const id of setsBySlug.get(slug)?.questionIds ?? []) {
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

  /** A set's title — for practice screen headers. */
  titleForSets(slugs: string[]): string {
    const titles = slugs.map((slug) =>
      slug === WEAK_SET_SLUG ? WEAK_SET_TITLE : (setsBySlug.get(slug)?.title ?? slug),
    );
    return titles.length === 1 ? titles[0] : titles.join(' + ');
  },
};
