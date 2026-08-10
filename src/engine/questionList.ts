/**
 * Reviewing a set's questions, broken down by state.
 *
 * The classification **must** produce the same numbers as `deckProgress`, because both
 * land on the practice screen: the progress bar shows the breakdown, and the list shows
 * the same questions by name. A mismatch between them would look like a counting bug, so
 * the rules live here once and are tested alongside `deckProgress`.
 *
 * The module is pure — no React Native, no database.
 */

import type { Card } from './leitner';
import { plural } from './plural';

export type CardState = 'needsWork' | 'learning' | 'untouched' | 'mastered';

/**
 * Section order on the list: from what needs attention to what's done.
 *
 * Untouched questions come before mastered ones on purpose — they still need attention
 * too, and mastered is the only group with nothing left to do.
 */
export const STATE_ORDER: CardState[] = ['needsWork', 'learning', 'untouched', 'mastered'];

const LABELS: Record<CardState, string> = {
  needsWork: 'Do poprawy',
  learning: 'W trakcie',
  untouched: 'Nietknięte',
  mastered: 'Opanowane',
};

export function stateLabel(state: CardState): string {
  return LABELS[state];
}

/**
 * A single question's state.
 *
 * The order of checks mirrors `deckProgress`: untouched is recognised by a zero `seen`
 * count, not by the bucket, because a question with a manually set bucket and a zero
 * counter would otherwise count in two groups at once.
 */
export function cardState(card: Card | undefined, levels: number): CardState {
  if (!card || card.seen === 0) return 'untouched';
  if (card.bucket >= levels - 1) return 'mastered';
  if (card.bucket === 0) return 'needsWork';
  return 'learning';
}

export interface StateGroup {
  state: CardState;
  questionIds: string[];
}

/** Questions grouped in a fixed order; empty groups are dropped. */
export function groupByState(
  questionIds: string[],
  cards: Map<string, Card>,
  levels: number,
): StateGroup[] {
  const groups = new Map<CardState, string[]>(STATE_ORDER.map((state) => [state, []]));

  for (const id of questionIds) {
    groups.get(cardState(cards.get(id), levels))?.push(id);
  }

  return STATE_ORDER.map((state) => ({ state, questionIds: groups.get(state) ?? [] })).filter(
    (group) => group.questionIds.length > 0,
  );
}

/**
 * A single question's progress caption.
 *
 * The first version said „poziom 2 z 3" (level 2 of 3), which means nothing to the reader:
 * the bucket number is a detail of the spaced-repetition mechanics, not an answer to "how
 * much do I have left". So instead we count the missing correct answers and spell them out.
 */
export function cardLabel(card: Card | undefined, levels: number): string {
  if (!card || card.seen === 0) return 'Jeszcze niepytane';

  const good = plural(card.correct, 'dobra', 'dobre', 'dobrych');
  const history = `${card.correct} ${good} z ${card.seen} odpowiedzi`;
  const missing = levels - 1 - card.bucket;

  if (missing <= 0) return history;

  // „Pod rząd" ("in a row"), because a mistake drops the card back to bucket zero — with
  // only one answer missing, that addition adds nothing and just reads oddly.
  const streak = missing === 1 ? '' : ' pod rząd';
  const form = plural(missing, 'poprawna', 'poprawne', 'poprawnych');
  return `Jeszcze ${missing} ${form}${streak} · ${history}`;
}

/**
 * Manually marking a question as mastered.
 *
 * `seen` must move off zero, or the question would count as mastered and untouched at the
 * same time. The hit counters aren't inflated beyond that necessary minimum — they're meant
 * to tell the truth about what was actually answered.
 */
export function markMastered(questionId: string, card: Card | undefined, levels: number): Card {
  const base = card ?? { questionId, bucket: 0, seen: 0, correct: 0 };
  return {
    ...base,
    bucket: levels - 1,
    seen: Math.max(base.seen, 1),
    correct: Math.max(base.correct, 1),
  };
}

/** Manually dropping a question to "needs work" — bucket zero, hit counter unchanged. */
export function markNeedsWork(questionId: string, card: Card | undefined): Card {
  const base = card ?? { questionId, bucket: 0, seen: 0, correct: 0 };
  return { ...base, bucket: 0, seen: Math.max(base.seen, 1) };
}
