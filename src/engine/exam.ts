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

/** One subject area a band can draw a slot from. */
export interface ExamSource {
  /** Category slug, resolved to questions outside the engine. */
  category: string;
  /**
   * Probability that a slot of this band goes to this source.
   *
   * Omitted on exactly one source per band — that one takes whatever the shares leave, so a
   * single-source band needs no numbers at all.
   */
  share?: number;
  /** Most slots of one band this source may fill. */
  max?: number;
}

/**
 * One band of the paper: how many questions it holds and which areas they come from.
 *
 * `critical` marks the zero-tolerance group, and it is a property of the **band**, not of the
 * question: an earlier version derived it from the question's lesson, and since 163 of the 200
 * police-exam questions carry the lesson `uobia`, they kept landing in the group where a
 * single mistake fails the paper — while safety questions, 24 of them against everything the
 * lesson `uobia` pulled in, were missing from that group in 79% of papers.
 */
export interface ExamLayer {
  sources: readonly ExamSource[];
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
  layers: [
    /**
     * The zero-tolerance opening of § 19 ust. 6 — "pierwsze cztery pytania dotyczące UoBiA
     * oraz zasad bezpieczeństwa".
     *
     * **A deliberate departure from ust. 1**, which asks for two questions from each of the
     * five areas and thereby fixes this group at 2 + 2. We don't know how a real committee
     * fills it: the regulation implies 2 + 2, while PZSS's own published question list falls
     * into four topical blocks rather than five, and the only eyewitness account of an exam
     * describes "the first four from UoBiA". The two readings are far apart where it costs
     * most — with 2 + 2, half of the group comes from a 24-question pool anyone can learn by
     * heart, so passing it is far likelier here than on a paper drawn the other way.
     *
     * So the group is one band of four with the safety rules weighted rather than counted:
     * 31.6% of papers get none of them, 42.2% one, 26.2% two. That sits between the two
     * readings instead of betting everything on either. The cap of two is not a fudge — no
     * reading of reality produces three, so it removes a state only our own randomness
     * invents.
     *
     * Back to the regulation's letter is two numbers: `share: 0.5` and `max: 2` become a
     * second band of `count: 2`.
     */
    {
      sources: [
        { category: 'zg-uobia' },
        { category: 'zg-bezpieczenstwo', share: 0.25, max: 2 },
      ],
      count: 4,
      critical: true,
    },
    // § 19 ust. 1 for the rest of the paper: two questions from each remaining area.
    { sources: [{ category: 'zg-regulaminy' }], count: 2, critical: false },
    { sources: [{ category: 'zg-budowa' }], count: 2, critical: false },
    { sources: [{ category: 'zg-prawo-karne' }], count: 2, critical: false },
  ],
};

export const WPA_PROFILE: ExamProfile = {
  id: 'wpa',
  title: 'WPA',
  questionCount: 20,
  passThreshold: 18,
  timeLimitSeconds: 30 * 60,
  // The whole paper from the course's copy of the official police question set. One band with
  // one source rather than a special case, so both exams go through the same drawing code.
  layers: [{ sources: [{ category: 'wpa' }], count: 20, critical: false }],
};

/** Questions at the front of the paper that must all be correct. Zero means no such group. */
/**
 * The areas a profile draws from, in paper order: bands as the profile lists them, sources
 * within a band in the order they are drawn.
 *
 * Written out in three places before this — the diagnosis, the pool builder and the summary —
 * and the diagnosis' row order is derived from it, so a fourth copy is a fourth chance for the
 * table to stop matching the paper.
 */
export function profileAreas(profile: ExamProfile): string[] {
  return profile.layers.flatMap((layer) => layer.sources.map((source) => source.category));
}

/** The areas whose questions open the paper, where a single mistake fails it. */
export function criticalAreas(profile: ExamProfile): string[] {
  return profile.layers
    .filter((layer) => layer.critical)
    .flatMap((layer) => layer.sources.map((source) => source.category));
}

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
  return [...latestVerdicts(attempts)]
    .filter(([, wasCorrect]) => !wasCorrect)
    .map(([questionId]) => questionId);
}

/**
 * How each question asked so far currently stands: `true` when its latest answer was right.
 *
 * A question absent from the map has never been asked in this exam, which is a third state and
 * not a false — the question browser shows exactly these three groups.
 *
 * @param attempts answers from past attempts, most recent first
 */
export function latestVerdicts(
  attempts: readonly { questionId: string; wasCorrect: boolean }[][],
): Map<string, boolean> {
  const verdicts = new Map<string, boolean>();

  for (const attempt of attempts) {
    for (const answer of attempt) {
      // The first verdict encountered is the most recent one, since attempts are ordered
      // newest first.
      if (!verdicts.has(answer.questionId)) verdicts.set(answer.questionId, answer.wasCorrect);
    }
  }

  return verdicts;
}

/** How one subject area stands: distinct questions asked, and how many are currently right. */
export interface AreaTally {
  seen: number;
  correct: number;
  /**
   * The questions behind `seen - correct`, i.e. the ones this area currently catches you on.
   *
   * Returned alongside the counts rather than gathered by a second function, and that is the
   * point: "asked 11, 2 correct, repeat 16" was on screen because the count and the drill came
   * from two different definitions of the area. Both now come from this one pass, so
   * `missed.length === seen - correct` holds by construction.
   */
  missed: string[];
}

/**
 * Per-area standing, read out of past attempts — the answer to "what am I worst at".
 *
 * Counted by **distinct question, latest verdict wins** — the same rule the mistake pool uses
 * (`latestMisses`), and for the same reason: it has to heal when someone improves. Two other
 * readings were rejected. Raw accuracy over every answer never forgets a bad start, so a month
 * of progress stays hidden behind it. And it can be inflated the other way: an area of 24
 * questions can show "23/24" off six questions answered four times each, which reads as
 * mastery of the area and isn't.
 *
 * `seen` is therefore also a coverage figure — "34/41" against an area of 268 questions says
 * plainly that most of it hasn't been asked yet.
 *
 * The area comes from the resolver, never from the attempt: areas are a partition of the
 * content (`content.areaOf`), so **every** attempt can be counted — including papers taken
 * before the app composed them by area. A question in no area at all, which is every question
 * of the police (WPA) list, is counted nowhere; those papers contribute what belongs to an
 * area and nothing else.
 *
 * The resolver is a parameter because this file may not import the content bundle.
 *
 * @param attempts answers from past attempts, most recent first
 * @param areaOf the area a question belongs to, if any
 */
export function areaProgress(
  attempts: readonly (readonly { questionId: string; wasCorrect: boolean }[])[],
  areaOf: (questionId: string) => string | undefined,
): Map<string, AreaTally> {
  const tally = new Map<string, AreaTally>();
  const settled = new Set<string>();

  for (const attempt of attempts) {
    for (const answer of attempt) {
      if (settled.has(answer.questionId)) continue;
      const area = areaOf(answer.questionId);
      if (!area) continue;
      settled.add(answer.questionId);

      const entry = tally.get(area) ?? { seen: 0, correct: 0, missed: [] };
      entry.seen += 1;
      if (answer.wasCorrect) entry.correct += 1;
      else entry.missed.push(answer.questionId);
      tally.set(area, entry);
    }
  }

  return tally;
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
 * Top-ups also ignore questions already pooled for an earlier layer, and that is deliberate
 * even though the app's own areas are a **partition** — with one area per question, this
 * subtracts nothing today (`categories.package.test` is what holds that). It stays because
 * nothing in this function's signature says the pools are disjoint, the test that holds the
 * partition **skips itself when the content bundle is absent**, and the failure it prevents is
 * the nastiest kind: the draw succeeding or refusing depending on the seed.
 *
 * @param fallbackLayers each layer's full pool, in profile order
 */
export function buildPool(
  preferred: Question[],
  fallbackBands: Question[][][],
  profile: ExamProfile,
  random: () => number = Math.random,
): Question[][][] {
  const pooledEarlier = new Set<string>();

  return profile.layers.map((layer, bandIndex) => {
    // Every source keeps enough of its own questions to fill the band on its own. Topping the
    // band up as a whole would let the mistakes decide the composition: six mistakes from the
    // Act would leave the weighted safety source empty, and the paper would quietly stop
    // asking about safety in the one group where a mistake fails it.
    const pools = layer.sources.map((source, sourceIndex) => {
      const full = fallbackBands[bandIndex]?.[sourceIndex] ?? [];
      const inSource = new Set(full.map((question) => question.id));
      const pool: Question[] = [];
      const taken = new Set<string>();
      for (const question of preferred) {
        if (!inSource.has(question.id) || taken.has(question.id)) continue;
        pool.push(question);
        taken.add(question.id);
      }
      const secured = () => pool.filter((question) => !pooledEarlier.has(question.id)).length;
      // A source may have to cover the whole band, so it needs `count` of its own — unless it
      // is capped lower, in which case its cap is all it will ever be asked for.
      const target = Math.min(layer.count, layer.sources[sourceIndex].max ?? layer.count);

      // The top-up is drawn, not taken off the front. Walking the pool in bundle order made an
      // exam from a single mistake the *same nine questions* every time — only their order
      // changed — and the screen promises questions "dobierane z całej puli tego zagadnienia".
      for (const question of shuffle(full, random)) {
        if (secured() >= target) break;
        if (taken.has(question.id) || pooledEarlier.has(question.id)) continue;
        pool.push(question);
        taken.add(question.id);
      }
      // A capped source cannot contribute more than its cap, however much it holds. Summing
      // the raw counts let a band pass this check and fail in `drawExam` instead — one
      // question in the uncapped source plus three in a source capped at two reads as four.
      return { pool, secured: Math.min(secured(), target) };
    });

    // Refuse here rather than hand back a band that cannot fill its slots: otherwise the
    // draw's success depends on the seed, so the same mistakes would compose a paper on one
    // tap and refuse on the next. The message names the area, which is what the screen shows.
    const available = pools.reduce((sum, entry) => sum + entry.secured, 0);
    if (available < layer.count) {
      const missing = layer.sources[0].category;
      throw new NotEnoughQuestionsError(
        `pasmo ${missing} ma ${available} pytań, potrzeba ${layer.count}`,
        missing,
      );
    }

    for (const entry of pools) {
      for (const question of entry.pool) pooledEarlier.add(question.id);
    }
    return pools.map((entry) => entry.pool);
  });
}

/**
 * Which source of a band fills the next slot, or `null` when the band has run dry.
 *
 * Sources that hit their `max`, or have nothing unused left, drop out — so the roll always
 * lands on a source that can actually deliver, and a band whose weighted source is exhausted
 * quietly finishes from the other one instead of failing on some seeds and not others. That
 * determinism matters more than the exact weights: a paper that composes only sometimes is
 * the worst kind of bug to chase.
 *
 * @param roll one value in [0, 1) — passed in so the caller owns the randomness
 */
function pickSource(
  layer: ExamLayer,
  pools: Question[][],
  filled: number[],
  roll: number,
): number | null {
  const eligible = layer.sources
    .map((source, index) => index)
    .filter((index) => {
      const { max } = layer.sources[index];
      return pools[index].length > 0 && (max === undefined || filled[index] < max);
    });
  if (eligible.length === 0) return null;

  const weighted = eligible.filter((index) => layer.sources[index].share !== undefined);
  const remainder = eligible.filter((index) => layer.sources[index].share === undefined);

  let left = roll;
  for (const index of weighted) {
    const share = layer.sources[index].share ?? 0;
    if (left < share) return index;
    left -= share;
  }
  // The roll fell past every share: it belongs to the source without one. When that source is
  // the exhausted one, the band finishes from the weighted sources instead.
  return remainder[0] ?? weighted[weighted.length - 1] ?? null;
}

/**
 * Draws the paper: `count` questions from each band, critical bands first.
 *
 * A profile with no critical layer, like the police exam, comes out as one flat draw — no
 * special case needed, the critical group is simply empty.
 *
 * @param layers each layer's pool, in the same order as `profile.layers`
 */
export function drawExam(
  bands: Question[][][],
  profile: ExamProfile,
  random: () => number = Math.random,
): ExamQuestion[] {
  const critical: { question: Question }[] = [];
  const rest: { question: Question }[] = [];
  const taken = new Set<string>();

  profile.layers.forEach((layer, bandIndex) => {
    // What's already on the paper is off the table. The areas are a partition, so no band can
    // offer a question another band already took, and across bands this removes nothing today;
    // it stays because the pools are an argument and nothing here says they are disjoint. What
    // it does earn its keep on is repeats **inside** a pool: two copies of one question would
    // otherwise both survive into the paper, and grading reads answers by question id, so a
    // single answer would count twice — decisive when it lands in the critical four.
    const pools = layer.sources.map((source, sourceIndex) => {
      const unique = new Map<string, Question>();
      for (const question of bands[bandIndex]?.[sourceIndex] ?? []) {
        if (!taken.has(question.id)) unique.set(question.id, question);
      }
      return shuffle([...unique.values()], random);
    });
    const filled = layer.sources.map(() => 0);
    const drawn: { question: Question }[] = [];

    for (let slot = 0; slot < layer.count; slot += 1) {
      const source = pickSource(layer, pools, filled, random());
      // A band does not borrow from the others. Borrowing would turn "two questions from each
      // area" into a promise whose breaking is invisible — the paper would look complete.
      if (source === null) {
        const missing = layer.sources[0].category;
        throw new NotEnoughQuestionsError(
          `pasmo ${missing} ma ${drawn.length} pytań, potrzeba ${layer.count}`,
          missing,
        );
      }

      const question = pools[source].pop();
      if (!question) throw new Error('pickSource wskazał puste źródło');
      filled[source] += 1;
      taken.add(question.id);
      drawn.push({ question });
    }

    (layer.critical ? critical : rest).push(...drawn);
  });

  // Both halves are shuffled after the draw, because layer-by-layer order would leak the
  // structure — question seven would always be about range rules, and positions would become
  // learnable. That applies to the critical group too: § 19 ust. 6 fixes *which* questions
  // open the paper ("pierwsze cztery pytania dotyczące UoBiA oraz zasad bezpieczeństwa") but
  // says nothing about their order inside the four, and leaving them layer-ordered would
  // teach that positions three and four are always the safety ones. The `critical` flag is
  // positional over the whole group, so shuffling within it costs nothing.
  return [...shuffle(critical, random), ...shuffle(rest, random)].map((entry, index) => ({
    question: entry.question,
    order: shuffle(Object.keys(entry.question.answers) as Letter[], random),
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
