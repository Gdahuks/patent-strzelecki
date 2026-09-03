import { category } from './categories';
import { WEAK_SET_SLUG, WEAK_SET_TITLE, content } from './store';

/**
 * What a practice route is actually a set of.
 *
 * Three screens ask that question — the flashcards/quiz screen, the question browser, and the
 * area screen, which builds the links — and the answer is not always "the sets in the URL".
 * Two of them used to work it out for themselves, and the third copy of the rule is where a
 * bug came from: the browser resolved a drill of six exam mistakes to all 252 questions of the
 * area, under the area's own title, because it knew nothing about `?bledy`. So the decision
 * lives here, once.
 *
 * The plan says *which* questions, not how to fetch them: `weak` and `mistakes` come from the
 * database (progress buckets and exam history respectively) and this module may not reach
 * there — `src/content/` must never import `src/db/`. The screens do that part, which is two
 * lines, while the rule and the heading stay single-sourced and testable without the app.
 */
export type PracticeSetPlan =
  /** The virtual "moje błędy" set: whatever currently sits in the bottom bucket. */
  | { kind: 'weak' }
  /** One subject area, narrowed to the questions its exams caught you on. */
  | { kind: 'mistakes'; area: string; profile: string }
  /** Course sets or a whole area, straight from the bundle. */
  | { kind: 'sets'; slugs: readonly string[] };

/**
 * @param slugs the route's set slugs, already split
 * @param examProfileId the `?bledy=<profil>` parameter, if the route carries one
 */
export function planPracticeSet(
  slugs: readonly string[],
  examProfileId?: string,
): PracticeSetPlan {
  if (slugs.length === 1 && slugs[0] === WEAK_SET_SLUG) return { kind: 'weak' };

  // The narrowing is an area's own measurement, so it only means something on an area route:
  // the counter that promises those questions lives on the area screen. On a course set the
  // parameter says nothing and the whole set is shown.
  const area = slugs.length === 1 ? category(slugs[0]) : undefined;
  if (examProfileId && area) return { kind: 'mistakes', area: area.slug, profile: examProfileId };

  return { kind: 'sets', slugs };
}

/** The heading for a plan — the same one on both screens that render it. */
export function practiceSetTitle(plan: PracticeSetPlan): string {
  if (plan.kind === 'weak') return WEAK_SET_TITLE;
  if (plan.kind === 'mistakes') return `Pomyłki: ${content.titleForSets([plan.area])}`;
  return content.titleForSets([...plan.slugs]);
}
