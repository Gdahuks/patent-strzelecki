/**
 * Where each exam profile takes its questions from.
 *
 * This is the one place that joins a profile to the content bundle: the engine stays free of
 * bundle imports so it can be tested without the app, and the screens stay free of the
 * question of what „the WPA pool" means.
 */

import type { Question } from './types';
import { content } from './store';
import { type ExamProfile, NotEnoughQuestionsError, drawExam } from '../engine/exam';

/**
 * Each layer's questions, in the profile's order — the shape `drawExam` and `buildPool` want.
 *
 * A layer names its category by slug and `questionsForSets` resolves both categories and plain
 * course sets, so the police exam (one layer, the course's `wpa` set) needs no special case.
 */
export function profileLayers(profile: ExamProfile): Question[][] {
  return profile.layers.map((layer) => content.questionsForSets([layer.category]));
}

/** Every question the profile can ask, deduplicated — layers overlap. */
export function profileQuestions(profile: ExamProfile): Question[] {
  return content.questionsForSets(profile.layers.map((layer) => layer.category));
}

/**
 * Whether this build's bundle can actually serve the profile.
 *
 * Answered by composing one paper and seeing whether it holds — not by counting. A pool of
 * 456 says nothing when one area lost its set, and counting per layer is not enough either:
 * the areas overlap, so an earlier layer can take away everything a later one had. Two areas
 * of two questions each, holding the same two questions, pass every arithmetic check and
 * still cannot make a paper.
 *
 * Offering an exam that fails right after the tap is the worse failure, so a profile the
 * bundle can't serve is offered one option fewer.
 */
export function profileAvailable(profile: ExamProfile): boolean {
  try {
    drawExam(profileLayers(profile), profile);
    return true;
  } catch (error) {
    if (error instanceof NotEnoughQuestionsError) return false;
    throw error;
  }
}

/**
 * Past exam mistakes that this profile can actually ask about again.
 *
 * The mistakes already come from this profile's own attempts — `missedQuestionIds` filters by
 * profile. This is the second, narrower guard: a profile's pool comes from the content bundle,
 * and the bundle can change under a database that outlives it. A question dropped from the
 * course's WPA list would otherwise come back on a WPA paper through an old attempt.
 *
 * It also filters out what the patent profile stopped asking when the paper's composition
 * changed: the 200 police-exam questions and the handful outside the regulation's scope.
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
