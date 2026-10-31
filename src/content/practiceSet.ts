import { WEAK_SET_SLUG, WEAK_SET_TITLE, content } from './store';

/**
 * What a practice route is actually a set of.
 *
 * Two screens ask that question — the flashcards/quiz screen and the question browser — and
 * the answer is not always "the sets in the URL". So the decision lives here, once.
 *
 * The plan says *which* questions, not how to fetch them: `weak` comes from the progress
 * database and this module may not reach there — `src/content/` must never import `src/db/`.
 * The screens do that part, while the rule and the heading stay single-sourced and testable
 * without the app.
 */
export type PracticeSetPlan =
  /** The virtual "moje błędy" set: whatever currently sits in the bottom bucket. */
  | { kind: 'weak' }
  /** Course sets or a whole area, straight from the bundle. */
  | { kind: 'sets'; slugs: readonly string[] };

/** @param slugs the route's set slugs, already split */
export function planPracticeSet(slugs: readonly string[]): PracticeSetPlan {
  if (slugs.length === 1 && slugs[0] === WEAK_SET_SLUG) return { kind: 'weak' };
  return { kind: 'sets', slugs };
}

/** The heading for a plan — the same one on both screens that render it. */
export function practiceSetTitle(plan: PracticeSetPlan): string {
  if (plan.kind === 'weak') return WEAK_SET_TITLE;
  return content.titleForSets([...plan.slugs]);
}
