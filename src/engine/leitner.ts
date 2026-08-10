/**
 * The spaced-repetition engine — Leitner buckets.
 *
 * Mirrors the behaviour of `ouicards`, the library the original course is built on: a
 * correct answer promotes a question one bucket up, a wrong one sends it back to the
 * bottom. The difference here is that state is persistent (SQLite), not ephemeral like
 * the browser's `localStorage`.
 *
 * The module is deliberately pure — no React Native imports, no database access — so it
 * can be tested without running the app.
 */

/**
 * How many levels a deck has. The number of correct answers needed to master a card is
 * `levels - 1`.
 *
 * The default three levels, i.e. two correct answers, are close to what the course itself
 * recommends („dopóki nie odpowiesz poprawnie trzy razy z rzędu"). Five levels required
 * four repetitions per question, which is more than 656 questions call for.
 */
export const DEFAULT_LEVELS = 3;
export const LEVEL_CHOICES = [2, 3, 5] as const;

/**
 * How many answers apart we check on a higher bucket. Bucket zero is always served.
 * Squaring the level number gives growing intervals regardless of the level count.
 */
function reviewInterval(bucket: number): number {
  return (bucket + 1) ** 2;
}

export interface Card {
  questionId: string;
  bucket: number;
  seen: number;
  correct: number;
}

export interface DeckState {
  cards: Card[];
  /** Answer counter — controls when we check the higher buckets. */
  counter: number;
  /** Number of levels in this deck. The top bucket is `levels - 1`. */
  levels: number;
}

export function newCard(questionId: string): Card {
  return { questionId, bucket: 0, seen: 0, correct: 0 };
}

export function createDeck(
  questionIds: string[],
  known: Map<string, Card> = new Map(),
  levels: number = DEFAULT_LEVELS,
): DeckState {
  const top = Math.max(1, levels) - 1;
  return {
    // A saved bucket can be higher than the current top when the level count has been
    // lowered in settings — in that case we clamp it down to the top.
    cards: questionIds.map((id) => {
      const card = known.get(id);
      return card ? { ...card, bucket: Math.min(card.bucket, top) } : newCard(id);
    }),
    counter: 0,
    levels: Math.max(1, levels),
  };
}

/** The bucket to draw the next question from, or null when the deck is empty. */
export function pickBucket(state: DeckState): number | null {
  const occupied = new Set(state.cards.map((card) => card.bucket));
  if (occupied.size === 0) return null;

  // From the top down: if its interval has come up and it has anything in it, it's its turn.
  for (let bucket = state.levels - 1; bucket > 0; bucket -= 1) {
    if (!occupied.has(bucket)) continue;
    if (state.counter > 0 && state.counter % reviewInterval(bucket) === 0) {
      return bucket;
    }
  }

  // Default to the lowest non-empty one — that's where the not-yet-mastered material sits.
  for (let bucket = 0; bucket < state.levels; bucket += 1) {
    if (occupied.has(bucket)) return bucket;
  }
  return null;
}

/**
 * The next question. `random` is injected so the test can be deterministic.
 *
 * `avoid` is the question asked last. We avoid it whenever there's something else to
 * choose from — otherwise, in a small deck the same question fires several times in a
 * row, which with two advances needed to master a card looks like the app has frozen.
 */
export function nextCard(
  state: DeckState,
  random: () => number = Math.random,
  avoid: string | null = null,
): Card | null {
  const bucket = pickBucket(state);
  if (bucket === null) return null;

  const candidates = state.cards.filter((card) => card.bucket === bucket);
  if (candidates.length === 0) return null;

  const fresh = candidates.filter((card) => card.questionId !== avoid);
  // When the chosen bucket has nothing but the last question, we look in the rest.
  const pool = fresh.length > 0
    ? fresh
    : state.cards.filter((card) => card.questionId !== avoid);

  // A deck with a single card has nothing to interleave with — in that case, so be it,
  // the same one comes back.
  if (pool.length === 0) return candidates[0];

  return pool[Math.floor(random() * pool.length) % pool.length];
}

/**
 * A card's new state after an answer. One bucket up, or all the way back to the bottom —
 * a mistake on material considered mastered revokes that status.
 */
export function answerCard(
  card: Card,
  wasCorrect: boolean,
  levels: number = DEFAULT_LEVELS,
): Card {
  return {
    questionId: card.questionId,
    bucket: wasCorrect ? Math.min(card.bucket + 1, Math.max(1, levels) - 1) : 0,
    seen: card.seen + 1,
    correct: card.correct + (wasCorrect ? 1 : 0),
  };
}

export function applyAnswer(state: DeckState, questionId: string, wasCorrect: boolean): DeckState {
  return {
    ...state,
    counter: state.counter + 1,
    cards: state.cards.map((card) =>
      card.questionId === questionId ? answerCard(card, wasCorrect, state.levels) : card,
    ),
  };
}

/**
 * Splitting the deck into four disjoint groups that add up to the whole.
 *
 * The counter used to show only "mastered" and "untouched", so the numbers never wanted
 * to add up — buckets one through three had nowhere to appear.
 */
export interface DeckProgress {
  total: number;
  /** Untouched: never once answered. */
  untouched: number;
  /** Needs work: seen, but knocked back to the bottom after a mistake. */
  needsWork: number;
  /** Learning: between the bottom and the top. */
  learning: number;
  /** Mastered: in the top bucket. */
  mastered: number;
  perBucket: number[];
  /**
   * 0..1 — the deck's progress toward full mastery.
   *
   * The sum of buckets over the maximum, so each question counts proportionally to how
   * many correct answers in a row it has already collected. That's what makes the counter
   * move after every good answer, instead of only once a question is mastered.
   *
   * The price of that dynamic: the number can't be reconstructed from the labels under
   * the bar — 16 questions in progress and 8 mastered out of 49 come out to 33%, with no
   * way to see why. That's why the UI **must** label it („drogi do opanowania") rather
   * than show it as a bare percentage. If that label ever disappears, the counter will
   * look plucked out of thin air again.
   */
  ratio: number;
  /**
   * 0..1 — the share of questions that have left bucket zero.
   *
   * For the mistakes set, this is the right measure: its goal is answering every mistake
   * correctly, not driving everything to the top. Without it, the counter showed 25% at
   * the very moment the screen announced that all mistakes had been cleared.
   */
  clearedRatio: number;
}

export function deckProgress(state: DeckState): DeckProgress {
  const perBucket = Array<number>(state.levels).fill(0);
  for (const card of state.cards) perBucket[Math.min(card.bucket, state.levels - 1)] += 1;

  const total = state.cards.length;
  const advancement = state.cards.reduce((sum, card) => sum + card.bucket, 0);
  const untouched = state.cards.filter((card) => card.seen === 0).length;
  const mastered = perBucket[state.levels - 1];
  const needsWork = perBucket[0] - untouched;

  return {
    total,
    untouched,
    needsWork,
    learning: total - untouched - needsWork - mastered,
    mastered,
    perBucket,
    ratio:
      total === 0 || state.levels <= 1 ? 0 : advancement / (total * (state.levels - 1)),
    clearedRatio: total === 0 ? 0 : (total - perBucket[0]) / total,
  };
}

/** Answer order shuffled on every display — same as the original. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
