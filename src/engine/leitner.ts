/**
 * The spaced-repetition engine — Leitner buckets.
 *
 * Promotion mirrors `ouicards`, the library the original course is built on: a correct
 * answer moves a question one bucket up, a wrong one sends it back to the bottom. Buckets are
 * persistent (SQLite), not ephemeral like the browser's `localStorage`. Which question comes
 * next is our own: spacing measured in answers within one entry (`nextCard`), not the
 * course's per-bucket intervals, which brought the same question back after two others.
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

export interface Card {
  questionId: string;
  bucket: number;
  seen: number;
  correct: number;
}

/**
 * What the engine remembers about one entry into a set — never saved to the database.
 *
 * Picking the next question by spacing needs to know when each question was last answered.
 * That memory is deliberately short-lived: leaving the set and coming back starts afresh.
 */
export interface SessionMemory {
  /** questionId → value of `counter` at the moment it was answered in this entry. */
  readonly answeredAt: ReadonlyMap<string, number>;
  /** questionId → spacing factor drawn at its last answer, so returns don't fall into a rhythm. */
  readonly spacing: ReadonlyMap<string, number>;
  /** `counter` right after the last answer to a never-seen question; 0 at the start. */
  readonly lastNewAt: number;
  /** Questions answered since the current lap began. */
  readonly lap: ReadonlySet<string>;
}

export interface DeckState {
  cards: Card[];
  /** Answers given in this entry — the clock that spacing is measured in. */
  counter: number;
  /** Number of levels in this deck. The top bucket is `levels - 1`. */
  levels: number;
  session: SessionMemory;
  /**
   * "Ćwicz dalej" on a mastered set: practice goes on without an end screen. Every new deck
   * starts with it off — a reset that left it on would keep the end screen away for good.
   */
  refresh: boolean;
}

/** Range of the spacing factor; see `SessionMemory.spacing`. */
export const SPACING_MIN = 0.8;
export const SPACING_MAX = 1.4;

function emptySession(): SessionMemory {
  return { answeredAt: new Map(), spacing: new Map(), lastNewAt: 0, lap: new Set() };
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
    session: emptySession(),
    refresh: false,
  };
}

/**
 * Spacing parameters, chosen by simulating learners of different strength on sets of 24, 49
 * and 213 questions and by a blind review of the resulting sessions (design of 27 November
 * 2026). The base gap G is the set size over five, between GAP_MIN and GAP_MAX.
 */
export const GAP_MIN = 4;
export const GAP_MAX = 10;
/** A new question comes in at the latest after this many answers while new ones remain. */
export const NEW_EVERY = 5;
/** Every this-many-th answer reviews a rested mastered question. */
export const REVIEW_EVERY = 9;
/** In learning, an in-play question that waited this long goes before a mastered filler. */
export const FILLER_MIN_AGE = 5;
/** At the end of learning the gap shrinks with the questions left, but not below this. */
export const SHRINK_FLOOR = 4;

export function baseGap(size: number): number {
  return Math.max(GAP_MIN, Math.min(GAP_MAX, Math.round(size / 5)));
}

export interface NextCardOptions {
  /** Injected so tests are deterministic. */
  random?: () => number;
  /** The question just answered — never asked twice in a row while there's anything else. */
  avoid?: string | null;
  /**
   * The mistakes set ("Moje błędy"): bucket one counts as done (`goalBucket`), and nothing
   * already fixed is asked just to fill a gap — there, a fixed question answered wrong again
   * falls back among the mistakes, and padding with them doubled the answers needed to clear
   * a small set.
   */
  weak?: boolean;
}

/**
 * The next question.
 *
 * Questions fall into three groups: new (never answered), in play (answered, below the goal
 * bucket) and mastered (at the goal bucket or above). An in-play question comes back only
 * after a gap — G times the square root of its bucket plus one, times its spacing factor —
 * measured in answers given in this entry. While nothing is due, new questions come in, so
 * the batch in play settles at about G questions by itself. Mastered ones come back as an
 * occasional review and, once nothing else is left, as the whole of "Ćwicz dalej", where
 * every question comes up once before anything repeats (the lap).
 */
export function nextCard(state: DeckState, options: NextCardOptions = {}): Card | null {
  const random = options.random ?? Math.random;
  const avoid = options.avoid ?? null;
  const weak = options.weak ?? false;
  const goal = goalBucket(state.levels, weak);
  const { session, counter } = state;
  if (state.cards.length === 0) return null;

  const others = state.cards.filter((card) => card.questionId !== avoid);
  const pool = others.length > 0 ? others : state.cards;
  const isMastered = (card: Card) => card.bucket >= goal;
  const fresh = pool.filter((card) => card.seen === 0 && !isMastered(card));
  const inPlay = pool.filter((card) => card.seen > 0 && !isMastered(card));
  const mastered = pool.filter(isMastered);

  const age = (card: Card): number => {
    const at = session.answeredAt.get(card.questionId);
    return at === undefined ? Infinity : counter - at;
  };

  // At the end of learning — nothing new left — the gap shrinks with the questions still in
  // play, or the last few would wait out the full gap behind a wall of reviews. Not in
  // "Ćwicz dalej": there a mistake has to stay away for the full gap.
  const base = baseGap(state.cards.length);
  const anyFresh = state.cards.some((card) => card.seen === 0 && !isMastered(card));
  const inPlayCount = state.cards.filter((card) => card.seen > 0 && !isMastered(card)).length;
  const g = state.refresh || anyFresh
    ? base
    : Math.max(SHRINK_FLOOR, Math.min(base, inPlayCount + 1));
  const gap = (card: Card) =>
    g * Math.sqrt(card.bucket + 1) * (session.spacing.get(card.questionId) ?? 1);

  const due = inPlay.filter((card) => age(card) >= gap(card));
  // Rest is measured against the base gap, never the shrunk one, or a question mastered a
  // moment ago could come back as a review after four answers.
  const rested = mastered.filter((card) => age(card) >= base);

  const any = <T,>(items: T[]): T => items[Math.floor(random() * items.length) % items.length];

  /** The in-play question most past its gap; unseen in this entry counts as most overdue. */
  const mostOverdue = (cards: Card[]): Card => {
    let best: Card[] = [];
    let bestScore = -Infinity;
    for (const card of cards) {
      const score = (age(card) - gap(card)) / gap(card);
      if (score > bestScore) {
        best = [card];
        bestScore = score;
      } else if (score === bestScore) {
        best.push(card);
      }
    }
    return any(best);
  };

  /**
   * A mastered question: from outside the current lap first, preferring `primary` over
   * `secondary`; unseen in this entry first, otherwise weighted by age squared, so the order
   * of one lap doesn't repeat in the next and what came up a moment ago goes last.
   */
  const pickMastered = (primary: Card[], secondary: Card[] = []): Card => {
    const outside = (cards: Card[]) => cards.filter((card) => !session.lap.has(card.questionId));
    const candidates = [outside(primary), outside(secondary), primary, secondary]
      .find((cards) => cards.length > 0)!;
    const unseen = candidates.filter((card) => age(card) === Infinity);
    if (unseen.length > 0) return any(unseen);
    const weights = candidates.map((card) => age(card) ** 2);
    let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let i = 0; i < candidates.length; i += 1) {
      roll -= weights[i];
      if (roll < 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  };

  const stillLearning = inPlay.length + fresh.length > 0;
  if (!weak && counter > 0 && counter % REVIEW_EVERY === 0 && rested.length > 0 && stillLearning) {
    return pickMastered(rested);
  }
  if (fresh.length > 0 && counter - session.lastNewAt >= NEW_EVERY) return any(fresh);
  if (due.length > 0) return mostOverdue(due);
  if (fresh.length > 0) return any(fresh);
  if (inPlay.length > 0) {
    // Nothing due, nothing new: something has to fill the gap. The gap is soft — the engine
    // never stalls — but a question that has waited a while goes first in learning, then a
    // rested review, and only then an early return.
    const ripe = state.refresh ? [] : inPlay.filter((card) => age(card) >= FILLER_MIN_AGE);
    if (ripe.length > 0) return mostOverdue(ripe);
    if (!weak && rested.length > 0) return pickMastered(rested);
    return mostOverdue(inPlay);
  }
  // Only fixed questions left besides the mistake just answered wrong: in the mistakes set ask
  // that mistake again rather than a fixed question, which would only risk a new mistake.
  if (weak) {
    const again = state.cards.find((card) => card.questionId === avoid && !isMastered(card));
    if (again) return again;
  }
  return pickMastered(rested, mastered);
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

export function applyAnswer(
  state: DeckState,
  questionId: string,
  wasCorrect: boolean,
  random: () => number = Math.random,
): DeckState {
  const card = state.cards.find((entry) => entry.questionId === questionId);
  const { session } = state;
  const counter = state.counter + 1;

  let lap = new Set(session.lap).add(questionId);
  // Once every question has been through this lap, the next one starts with this answer.
  if (state.cards.every((entry) => lap.has(entry.questionId))) lap = new Set([questionId]);

  return {
    ...state,
    counter,
    cards: state.cards.map((entry) =>
      entry.questionId === questionId ? answerCard(entry, wasCorrect, state.levels) : entry,
    ),
    session: {
      answeredAt: new Map(session.answeredAt).set(questionId, state.counter),
      spacing: new Map(session.spacing).set(
        questionId,
        SPACING_MIN + random() * (SPACING_MAX - SPACING_MIN),
      ),
      lastNewAt: card && card.seen === 0 ? counter : session.lastNewAt,
      lap,
    },
  };
}

/**
 * Fresh cards from the database, same session.
 *
 * Coming back from the question list or an act reloads the buckets — a question may have been
 * marked by hand there — but the spacing memory and "Ćwicz dalej" must survive the trip, or the
 * end screen would pop up in the middle of refreshing.
 */
export function withCards(state: DeckState, cards: Card[]): DeckState {
  return { ...state, cards };
}

/** "Ćwicz dalej": keep practising a mastered set. A new lap starts; the spacing memory stays. */
export function startRefresh(state: DeckState): DeckState {
  return { ...state, refresh: true, session: { ...state.session, lap: new Set() } };
}

/**
 * The bucket a question has to reach for the set's goal. The mistakes set is about leaving
 * bucket zero — answering every mistake correctly once — not about driving it to the top.
 */
export function goalBucket(levels: number, weak: boolean): number {
  return weak ? 1 : Math.max(1, levels) - 1;
}

/**
 * Whether the set's end screen is due — a single source for the screen and the screen reader.
 * Never while refreshing: practice there goes on until the user leaves.
 */
export function deckComplete(state: DeckState, weak: boolean): boolean {
  if (state.refresh) return false;
  const summary = deckProgress(state);
  const done = weak ? summary.perBucket[0] === 0 : summary.mastered === summary.total;
  return summary.total > 0 && done;
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
