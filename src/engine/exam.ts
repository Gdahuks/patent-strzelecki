/**
 * Mock exam under PZSS rules, reproduced from the course's /patent-egzamin page:
 *
 *   - 10 questions, 20 minutes,
 *   - a 9/10 pass mark,
 *   - the first 4 questions come from UoBiA and the safety rules and must all be
 *     correct: any mistake in that group of four fails the exam regardless of the
 *     rest of the score.
 *
 * The module is pure — no React Native, no database — so it can be tested without the app.
 */

import type { Letter, Question } from '../content/types';
import { shuffle } from './leitner';

export const QUESTION_COUNT = 10;
export const CRITICAL_COUNT = 4;
export const PASS_THRESHOLD = 9;
export const TIME_LIMIT_SECONDS = 20 * 60;

/** Lessons that critical questions are drawn from. */
export const CRITICAL_LESSONS = ['uobia', 'bezpieczenstwo'] as const;

export interface ExamQuestion {
  question: Question;
  /** Display order of the answers — shuffled so positions can't be memorized. */
  order: Letter[];
  critical: boolean;
}

export interface ExamAnswer {
  questionId: string;
  chosen: Letter | null;
  wasCorrect: boolean;
  critical: boolean;
}

export interface ExamResult {
  score: number;
  passed: boolean;
  /** Whether the failure comes from a mistake in the critical questions despite a score above the threshold. */
  failedOnCritical: boolean;
  answers: ExamAnswer[];
}

export function isCritical(question: Question): boolean {
  return (CRITICAL_LESSONS as readonly string[]).includes(question.lesson);
}

export class NotEnoughQuestionsError extends Error {}

/**
 * Numbers of unanswered questions, counting from one.
 *
 * The exam lets you move on without picking an answer, so a skipped question used to be
 * unfindable: the warning shown when submitting only said how many there were, not which
 * ones, and finding them meant clicking back through the whole paper. This list feeds both
 * the number strip and the warning's text.
 */
export function unansweredNumbers(
  questionIds: readonly string[],
  chosen: ReadonlyMap<string, Letter | null>,
): number[] {
  const missing: number[] = [];

  questionIds.forEach((id, position) => {
    if (!chosen.get(id)) missing.push(position + 1);
  });
  return missing;
}

/**
 * Questions whose latest exam answer was wrong — read from the most recent attempt.
 *
 * Only the **latest** verdict counts, not the mere fact of having ever gotten it wrong.
 * An earlier version only collected mistakes from a handful of recent attempts, so the
 * pool never healed: a question answered correctly afterwards stayed in it until enough
 * newer attempts pushed the old one out of the window. Under this rule the window becomes
 * unnecessary — a correct answer removes the question from the pool on its own.
 *
 * @param attempts answers from past attempts, most recent first
 */
export function latestMisses(
  attempts: readonly { questionId: string; wasCorrect: boolean }[][],
): string[] {
  const verdicts = new Map<string, boolean>();

  for (const attempt of attempts) {
    for (const answer of attempt) {
      // The first verdict encountered is the most recent one, since attempts are ordered
      // newest first.
      if (!verdicts.has(answer.questionId)) verdicts.set(answer.questionId, answer.wasCorrect);
    }
  }

  return [...verdicts].filter(([, wasCorrect]) => !wasCorrect).map(([questionId]) => questionId);
}

/**
 * Builds the drawing pool from the preferred questions, topping it up from the fallback.
 *
 * An exam built from your own mistakes can't blow up just because there aren't enough of
 * them, or none happen to be critical — `drawExam` requires four critical questions and
 * ten in total. So we top the pool up to that minimum: critical questions first, then the
 * rest. The preferred questions stay in the pool in full, so the exam still focuses on
 * what you don't know.
 */
export function buildPool(preferred: Question[], fallback: Question[]): Question[] {
  const pool = [...preferred];
  const taken = new Set(pool.map((question) => question.id));

  const missingCritical = CRITICAL_COUNT - pool.filter(isCritical).length;
  if (missingCritical > 0) {
    for (const question of fallback) {
      if (pool.filter(isCritical).length >= CRITICAL_COUNT) break;
      if (isCritical(question) && !taken.has(question.id)) {
        pool.push(question);
        taken.add(question.id);
      }
    }
  }

  for (const question of fallback) {
    if (pool.length >= QUESTION_COUNT) break;
    if (!taken.has(question.id)) {
      pool.push(question);
      taken.add(question.id);
    }
  }

  return pool;
}

/**
 * Draws the exam set: the critical four first, then the rest.
 */
export function drawExam(pool: Question[], random: () => number = Math.random): ExamQuestion[] {
  const critical = pool.filter(isCritical);
  const rest = pool.filter((question) => !isCritical(question));

  if (critical.length < CRITICAL_COUNT) {
    throw new NotEnoughQuestionsError(
      `pula krytyczna ma ${critical.length} pytań, potrzeba ${CRITICAL_COUNT}`,
    );
  }
  if (pool.length < QUESTION_COUNT) {
    throw new NotEnoughQuestionsError(
      `pula ma ${pool.length} pytań, potrzeba ${QUESTION_COUNT}`,
    );
  }

  const drawnCritical = shuffle(critical, random).slice(0, CRITICAL_COUNT);
  const chosen = new Set(drawnCritical.map((question) => question.id));

  // If there aren't enough non-critical questions, we draw extra ones from the critical
  // pool — the set has to have the full ten questions.
  const fillers = shuffle([...rest, ...critical.filter((q) => !chosen.has(q.id))], random)
    .filter((question) => !chosen.has(question.id))
    .slice(0, QUESTION_COUNT - CRITICAL_COUNT);

  return [...drawnCritical, ...fillers].map((question, index) => ({
    question,
    order: shuffle(Object.keys(question.answers) as Letter[], random),
    critical: index < CRITICAL_COUNT,
  }));
}

export function gradeExam(
  questions: ExamQuestion[],
  chosen: Map<string, Letter | null>,
): ExamResult {
  const answers: ExamAnswer[] = questions.map((entry) => {
    const pick = chosen.get(entry.question.id) ?? null;
    return {
      questionId: entry.question.id,
      chosen: pick,
      wasCorrect: pick === entry.question.correct,
      critical: entry.critical,
    };
  });

  const score = answers.filter((answer) => answer.wasCorrect).length;
  const criticalMistake = answers.some((answer) => answer.critical && !answer.wasCorrect);

  return {
    score,
    passed: score >= PASS_THRESHOLD && !criticalMistake,
    failedOnCritical: criticalMistake && score >= PASS_THRESHOLD,
    answers,
  };
}

export function formatRemaining(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  return `${minutes}:${String(clamped % 60).padStart(2, '0')}`;
}
