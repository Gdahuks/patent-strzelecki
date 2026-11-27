/**
 * A practice session that outlives the practice screen — in process memory, never on disk.
 *
 * Leaving a set (the header arrow sits right next to "‹ Poprzednie", so it happens by accident)
 * used to throw the whole session away: a different question on return, an empty history and
 * the legal-basis link of the last question gone. The owner asked for the session to survive
 * leaving the screen "w ramach otwarcia" and not beyond — so this is a plain module-level map:
 * it dies with the process, and nothing here touches the database.
 *
 * Pure on purpose (no React, no database), so the restore rules are tested with vitest.
 * `src/db/database.ts` calls `clearSessions` whenever progress is reset — allowed in that
 * direction, since `src/db` may import from `src/engine`.
 */

import type { Letter, Question } from '../content/types';
import type { DeckState } from './leitner';

/** Everything the practice screen needs to come back exactly as it was left. */
export interface PracticeSnapshot {
  deck: DeckState;
  currentId: string | null;
  orders: ReadonlyMap<string, Letter[]>;
  picks: ReadonlyMap<string, Letter>;
  /** The answers each question was drawn with in this session (pooled wrong answers). */
  views: ReadonlyMap<string, Question>;
  history: readonly string[];
  picked: Letter | null;
  revealed: boolean;
}

/**
 * One entry per set and mode. The number of keys is bounded by the interface — sets, areas and
 * the links from lessons, times two modes — and a snapshot is a few kilobytes, so nothing is
 * ever evicted.
 */
const sessions = new Map<string, PracticeSnapshot>();

export function sessionKey(mode: string, sets: string): string {
  return `${mode}|${sets}`;
}

export function saveSession(key: string, snapshot: PracticeSnapshot): void {
  sessions.set(key, snapshot);
}

/** Every session at once: called whenever progress is reset anywhere in the app. */
export function clearSessions(): void {
  sessions.clear();
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((id) => set.has(id));
}

/**
 * The saved session, or null when the screen should start afresh.
 *
 * A snapshot is only valid for the level count it was made with (changing it in settings
 * restarts a session anyway) and for the same questions. For an ordinary set those are the
 * set's questions. The mistakes set is read from the database as the questions still in bucket
 * zero, so every mistake fixed in this session leaves it — what has to match there is the
 * snapshot's own mistakes. A mismatch means mistakes came or went outside this screen, and an
 * empty list should show "Nie masz jeszcze błędów", not an old session.
 */
export function restoreSession(
  key: string,
  current: { levels: number; weak: boolean; poolIds: readonly string[] },
): PracticeSnapshot | null {
  const snapshot = sessions.get(key);
  if (!snapshot || snapshot.deck.levels !== current.levels) return null;

  const cards = snapshot.deck.cards;
  if (!current.weak) {
    return sameSet(cards.map((card) => card.questionId), current.poolIds) ? snapshot : null;
  }

  if (current.poolIds.length === 0) return null;
  const mistakes = cards
    .filter((card) => card.seen > 0 && card.bucket === 0)
    .map((card) => card.questionId);
  return sameSet(mistakes, current.poolIds) ? snapshot : null;
}
