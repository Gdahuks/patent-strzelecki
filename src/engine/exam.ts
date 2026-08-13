/**
 * Mock exams, in two flavours — the app reproduces two real exams rather than offering a
 * configurator like the course website does:
 *
 *   - the PZSS licence exam ("patent"), taken from the course's /patent-egzamin page:
 *     10 questions, 20 minutes, a 9/10 pass mark, and the first 4 questions drawn from
 *     UoBiA and the safety rules, all of which must be correct — any mistake in that group
 *     of four fails the exam regardless of the rest of the score;
 *   - the firearms-licence exam taken before a police committee ("WPA"), whose rules come
 *     straight from § 4 of the exam regulation the app ships offline (Dz.U. 2023 poz. 1475):
 *     20 questions, 30 minutes, a pass mark of 18. It has no critical group — that one is a
 *     PZSS invention, not a statutory rule.
 *
 * Everything that differs between them lives in `ExamProfile`, so the screens carry no
 * arithmetic of their own. The module is pure — no React Native, no database — so it can be
 * tested without the app.
 */

import type { Letter, Question } from '../content/types';
import { shuffle } from './leitner';

export type ExamProfileId = 'patent' | 'wpa';

export interface ExamProfile {
  id: ExamProfileId;
  /** Label on the switch, and the name the exam is known by. */
  title: string;
  questionCount: number;
  /** Questions at the front of the paper that must all be correct. Zero means no such group. */
  criticalCount: number;
  passThreshold: number;
  timeLimitSeconds: number;
  /** Lessons that critical questions are drawn from — empty when the profile has none. */
  criticalLessons: readonly string[];
  /**
   * Content sets the pool is drawn from, or `null` for the whole question base.
   *
   * The WPA list is the course's own selection of 200 questions, shipped in the bundle —
   * not a rule we derive from the regulation's subject-matter scope. Deriving it would put
   * us in the position of deciding which questions the exam covers, and the course authors
   * have already made that call.
   */
  setSlugs: readonly string[] | null;
}

export const PATENT_PROFILE: ExamProfile = {
  id: 'patent',
  title: 'Patent PZSS',
  questionCount: 10,
  criticalCount: 4,
  passThreshold: 9,
  timeLimitSeconds: 20 * 60,
  criticalLessons: ['uobia', 'bezpieczenstwo'],
  setSlugs: null,
};

export const WPA_PROFILE: ExamProfile = {
  id: 'wpa',
  title: 'WPA',
  questionCount: 20,
  criticalCount: 0,
  passThreshold: 18,
  timeLimitSeconds: 30 * 60,
  criticalLessons: [],
  setSlugs: ['wpa'],
};

export const EXAM_PROFILES: readonly ExamProfile[] = [PATENT_PROFILE, WPA_PROFILE];

/**
 * The profile for an id, falling back to the licence exam.
 *
 * Both callers hand over something they don't control: a route parameter and a column read
 * back out of the database. An attempt saved by a future version under an id this build
 * doesn't know must still open, so this never throws.
 */
export function examProfile(id: string | null | undefined): ExamProfile {
  return EXAM_PROFILES.find((profile) => profile.id === id) ?? PATENT_PROFILE;
}

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
  /**
   * Whether the failure comes from a mistake in the critical questions despite a score above
   * the threshold.
   */
  failedOnCritical: boolean;
  answers: ExamAnswer[];
}

export function isCritical(question: Question, profile: ExamProfile): boolean {
  return profile.criticalLessons.includes(question.lesson);
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
 * them, or none happen to be critical — `drawExam` requires a full paper, and the licence
 * exam additionally requires four critical questions. So we top the pool up to that
 * minimum: critical questions first, then the rest. The preferred questions stay in the
 * pool in full, so the exam still focuses on what you don't know.
 */
export function buildPool(
  preferred: Question[],
  fallback: Question[],
  profile: ExamProfile,
): Question[] {
  const pool = [...preferred];
  const taken = new Set(pool.map((question) => question.id));
  const criticalInPool = () => pool.filter((question) => isCritical(question, profile)).length;

  if (criticalInPool() < profile.criticalCount) {
    for (const question of fallback) {
      if (criticalInPool() >= profile.criticalCount) break;
      if (isCritical(question, profile) && !taken.has(question.id)) {
        pool.push(question);
        taken.add(question.id);
      }
    }
  }

  for (const question of fallback) {
    if (pool.length >= profile.questionCount) break;
    if (!taken.has(question.id)) {
      pool.push(question);
      taken.add(question.id);
    }
  }

  return pool;
}

/**
 * Draws the exam set: the critical questions first, then the rest.
 *
 * A profile with no critical group skips that split entirely rather than asking for zero
 * critical questions — the whole pool is then one flat draw.
 */
export function drawExam(
  pool: Question[],
  profile: ExamProfile,
  random: () => number = Math.random,
): ExamQuestion[] {
  const hasCritical = profile.criticalCount > 0;
  const critical = hasCritical ? pool.filter((question) => isCritical(question, profile)) : [];
  const rest = hasCritical
    ? pool.filter((question) => !isCritical(question, profile))
    : pool;

  if (critical.length < profile.criticalCount) {
    throw new NotEnoughQuestionsError(
      `pula krytyczna ma ${critical.length} pytań, potrzeba ${profile.criticalCount}`,
    );
  }
  if (pool.length < profile.questionCount) {
    throw new NotEnoughQuestionsError(
      `pula ma ${pool.length} pytań, potrzeba ${profile.questionCount}`,
    );
  }

  const drawnCritical = shuffle(critical, random).slice(0, profile.criticalCount);
  const chosen = new Set(drawnCritical.map((question) => question.id));

  // If there aren't enough non-critical questions, we draw extra ones from the critical
  // pool — the paper has to be complete.
  const fillers = shuffle([...rest, ...critical.filter((q) => !chosen.has(q.id))], random)
    .filter((question) => !chosen.has(question.id))
    .slice(0, profile.questionCount - profile.criticalCount);

  return [...drawnCritical, ...fillers].map((question, index) => ({
    question,
    order: shuffle(Object.keys(question.answers) as Letter[], random),
    critical: index < profile.criticalCount,
  }));
}

export function gradeExam(
  questions: ExamQuestion[],
  chosen: Map<string, Letter | null>,
  profile: ExamProfile,
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
    passed: score >= profile.passThreshold && !criticalMistake,
    failedOnCritical: criticalMistake && score >= profile.passThreshold,
    answers,
  };
}

/**
 * How long an attempt took, as `M:SS` — the „Czas rozwiązywania" line.
 *
 * Exact, not "about N minutes". The app knows this to the millisecond and already formats a
 * clock for the countdown, so rounding threw away information for nothing — and the rounding
 * had a floor of one minute, which turned a paper handed in after forty seconds into a lie.
 *
 * This is **wall-clock time**, not time on the exam's own clock: the countdown stops while
 * the app sits in the background, so an attempt can span more wall-clock time than the limit
 * allows. Hence the bare duration, never „18:42 z 20:00" — that comparison would sooner or
 * later read „34:10 z 20:00".
 *
 * Both summaries use this — the one right after the exam and the one reached from history —
 * so the two can't drift apart.
 */
export function solvingTime(milliseconds: number): string {
  return formatRemaining(milliseconds / 1000);
}

export function formatRemaining(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  return `${minutes}:${String(clamped % 60).padStart(2, '0')}`;
}
