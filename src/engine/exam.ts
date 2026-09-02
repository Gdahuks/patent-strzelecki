/**
 * Mock exams, in two flavours — the app reproduces two real exams rather than offering a
 * configurator like the course website does:
 *
 *   - the PZSS licence exam ("patent"), whose shape comes from § 19 of the PZSS licence
 *     regulation: 10 questions, 20 minutes, a 9/10 pass mark, **two questions from each of
 *     five subject areas** (ust. 1), and the first four — those from the Act and the safety
 *     rules — all of which must be correct, any mistake there failing the exam regardless of
 *     the rest of the score (ust. 6);
 *   - the firearms-licence exam taken before a police committee ("WPA"), whose rules come
 *     straight from § 4 of the exam regulation the app ships offline (Dz.U. 2023 poz. 1475):
 *     20 questions, 30 minutes, a pass mark of 18. It has no critical group — that one is a
 *     PZSS invention, not a statutory rule.
 *
 * Everything that differs between them lives in `ExamProfile`, so the screens carry no
 * arithmetic of their own. The module is pure — no React Native, no database, no content
 * bundle — so it can be tested without the app. That is why a layer names its category by
 * slug: turning slugs into questions is `content/examPool`'s job, and the engine never learns
 * what a course set is.
 */

import type { Letter, Question } from '../content/types';
import { shuffle } from './leitner';

export type ExamProfileId = 'patent' | 'wpa';

/**
 * One band of the paper: how many questions come from which subject area.
 *
 * `critical` marks the zero-tolerance group. Criticality is a property of the **layer**, not
 * of the question: an earlier version derived it from the question's lesson, and since 163 of
 * the 200 police-exam questions carry the lesson `uobia`, they kept landing in the group where
 * a single mistake fails the paper — while safety questions, 24 against a critical pool of
 * 415, were missing from it in 79% of papers.
 */
export interface ExamLayer {
  /** Category slug, resolved to questions outside the engine. */
  category: string;
  count: number;
  critical: boolean;
}

export interface ExamProfile {
  id: ExamProfileId;
  /** Label on the switch, and the name the exam is known by. */
  title: string;
  /**
   * Questions on the paper. Always the sum of the layers' counts — kept explicit because the
   * history and result screens read it as the denominator of every past attempt, so it must
   * not silently change when a layer is edited. A test pins the two together.
   */
  questionCount: number;
  passThreshold: number;
  timeLimitSeconds: number;
  /** Composition of the paper, critical layers first. */
  layers: readonly ExamLayer[];
}

export const PATENT_PROFILE: ExamProfile = {
  id: 'patent',
  title: 'Patent PZSS',
  questionCount: 10,
  passThreshold: 9,
  timeLimitSeconds: 20 * 60,
  // § 19 ust. 1: two questions from each of the five areas. The first two layers are the
  // zero-tolerance group of ust. 6 — "pierwsze cztery pytania dotyczące UoBiA oraz zasad
  // bezpieczeństwa" — so their order here is the order on the paper.
  layers: [
    { category: 'zg-uobia', count: 2, critical: true },
    { category: 'zg-bezpieczenstwo', count: 2, critical: true },
    { category: 'zg-regulaminy', count: 2, critical: false },
    { category: 'zg-budowa', count: 2, critical: false },
    { category: 'zg-prawo-karne', count: 2, critical: false },
  ],
};

export const WPA_PROFILE: ExamProfile = {
  id: 'wpa',
  title: 'WPA',
  questionCount: 20,
  passThreshold: 18,
  timeLimitSeconds: 30 * 60,
  // The whole paper from the course's copy of the official police question set. One layer
  // rather than a special case, so both exams go through the same drawing code.
  layers: [{ category: 'wpa', count: 20, critical: false }],
};

/** Questions at the front of the paper that must all be correct. Zero means no such group. */
export function criticalCount(profile: ExamProfile): number {
  return profile.layers
    .filter((layer) => layer.critical)
    .reduce((sum, layer) => sum + layer.count, 0);
}

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

/**
 * A layer cannot fill its slots on the paper.
 *
 * Carries the layer's category slug so the screen can name the area in Polish instead of
 * parsing it back out of the message.
 */
export class NotEnoughQuestionsError extends Error {
  constructor(
    message: string,
    readonly category?: string,
  ) {
    super(message);
  }
}

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
 * Builds the per-layer drawing pools from the preferred questions, topping each up from the
 * layer's full pool.
 *
 * An exam built from your own mistakes can't blow up just because they all sit in one subject
 * area — `drawExam` needs its `count` from **every** layer, so each is topped up on its own.
 * Topping up globally, as an earlier version did, made the paper undrawable exactly when the
 * mistakes were lopsided: six mistakes all from the Act looked like a full pool, and the draw
 * then failed on the layer that had nothing.
 *
 * The preferred questions stay in their layer in full, so the exam still focuses on what you
 * don't know.
 *
 * Top-ups deliberately ignore questions already pooled for an earlier layer. Layers are not
 * disjoint — 43 questions are penal provisions of the Act itself, so they belong to both the
 * first area and the fifth — and the draw dedupes across the whole paper. Counting only
 * questions no earlier layer can take away is what guarantees every layer still has enough
 * once the shared ones are gone.
 *
 * @param fallbackLayers each layer's full pool, in profile order
 */
export function buildPool(
  preferred: Question[],
  fallbackLayers: Question[][],
  profile: ExamProfile,
  random: () => number = Math.random,
): Question[][] {
  const pooledEarlier = new Set<string>();

  return profile.layers.map((layer, index) => {
    const full = fallbackLayers[index] ?? [];
    const inLayer = new Set(full.map((question) => question.id));
    const pool: Question[] = [];
    const taken = new Set<string>();
    for (const question of preferred) {
      if (!inLayer.has(question.id) || taken.has(question.id)) continue;
      pool.push(question);
      taken.add(question.id);
    }
    const secured = () => pool.filter((question) => !pooledEarlier.has(question.id)).length;

    // The top-up is drawn, not taken off the front of the layer. Walking `full` in bundle
    // order made an exam from a single mistake the *same nine questions* every time — only
    // their order changed — and the screen promises questions "dobierane z całej puli tego
    // zagadnienia".
    for (const question of shuffle(full, random)) {
      if (secured() >= layer.count) break;
      if (taken.has(question.id) || pooledEarlier.has(question.id)) continue;
      pool.push(question);
      taken.add(question.id);
    }

    // Refuse here rather than hand back a layer that cannot fill its slots: otherwise the
    // draw's success depends on the seed, so the same mistakes would compose a paper on one
    // tap and refuse on the next. The message names the layer, which is what the screen shows.
    if (secured() < layer.count) {
      throw new NotEnoughQuestionsError(
        `warstwa ${layer.category} ma ${secured()} pytań, potrzeba ${layer.count}`,
        layer.category,
      );
    }

    for (const question of pool) pooledEarlier.add(question.id);
    return pool;
  });
}

/**
 * Draws the paper: `count` questions from each layer, critical layers first.
 *
 * A profile with no critical layer, like the police exam, comes out as one flat draw — no
 * special case needed, the critical group is simply empty.
 *
 * @param layers each layer's pool, in the same order as `profile.layers`
 */
export function drawExam(
  layers: Question[][],
  profile: ExamProfile,
  random: () => number = Math.random,
): ExamQuestion[] {
  const critical: Question[] = [];
  const rest: Question[] = [];
  const taken = new Set<string>();

  profile.layers.forEach((layer, index) => {
    // Layers overlap, so what's already on the paper is off the table — otherwise a question
    // that is both a provision of the Act and a penal one could be asked twice. The same pass
    // drops repeats **inside** one layer's pool: two copies of one question would otherwise
    // both survive into the paper, and grading reads answers by question id, so a single
    // answer would count twice — decisive when it lands in the critical four.
    const unique = new Map<string, Question>();
    for (const question of layers[index] ?? []) {
      if (!taken.has(question.id)) unique.set(question.id, question);
    }
    const available = [...unique.values()];

    // A thin layer does not borrow from the others. Borrowing would turn "two questions from
    // each area" into a promise whose breaking is invisible — the paper would look complete.
    if (available.length < layer.count) {
      throw new NotEnoughQuestionsError(
        `warstwa ${layer.category} ma ${available.length} pytań, potrzeba ${layer.count}`,
        layer.category,
      );
    }

    const drawn = shuffle(available, random).slice(0, layer.count);
    for (const question of drawn) taken.add(question.id);
    (layer.critical ? critical : rest).push(...drawn);
  });

  // Both halves are shuffled after the draw, because layer-by-layer order would leak the
  // structure — question seven would always be about range rules, and positions would become
  // learnable. That applies to the critical group too: § 19 ust. 6 fixes *which* questions
  // open the paper ("pierwsze cztery pytania dotyczące UoBiA oraz zasad bezpieczeństwa") but
  // says nothing about their order inside the four, and leaving them layer-ordered would
  // teach that positions three and four are always the safety ones. The `critical` flag is
  // positional over the whole group, so shuffling within it costs nothing.
  return [...shuffle(critical, random), ...shuffle(rest, random)].map((question, index) => ({
    question,
    order: shuffle(Object.keys(question.answers) as Letter[], random),
    critical: index < critical.length,
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
