/**
 * Where each exam profile takes its questions from.
 *
 * This is the one place that joins a profile to the content bundle: the engine stays free of
 * bundle imports so it can be tested without the app, and the screens stay free of the
 * question of what „the WPA pool" means.
 */

import type { Question } from './types';
import { content } from './store';
import type { ExamProfile } from '../engine/exam';

/** The whole question base, or just the sets the profile names. */
export function profileQuestions(profile: ExamProfile): Question[] {
  return profile.setSlugs ? content.questionsForSets([...profile.setSlugs]) : content.questions;
}

/**
 * Whether this build's bundle can actually serve the profile.
 *
 * A profile drawing from a named set depends on the bundle carrying that set. It does today,
 * and the scraper would notice if it stopped — but a screen that offers an exam it cannot
 * draw would fail at the worst moment, right after the tap. Offering one option fewer is the
 * better failure.
 */
export function profileAvailable(profile: ExamProfile): boolean {
  return profileQuestions(profile).length >= profile.questionCount;
}

/**
 * Past exam mistakes that this profile can actually ask about again.
 *
 * The mistakes already come from this profile's own attempts — `missedQuestionIds` filters by
 * profile. This is the second, narrower guard: a profile's pool comes from the content bundle,
 * and the bundle can change under a database that outlives it. A question dropped from the
 * course's WPA list would otherwise come back on a WPA paper through an old attempt.
 *
 * It has to be the same call on the exam screen and inside the attempt, or the count next to
 * the button would promise questions the draw can't use.
 */
export function profileMisses(missedIds: string[], pool: Question[]): Question[] {
  const inPool = new Map(pool.map((question) => [question.id, question]));
  return missedIds
    .map((id) => inPool.get(id))
    .filter((question): question is Question => question !== undefined);
}
