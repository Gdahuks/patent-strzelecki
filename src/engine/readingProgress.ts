/**
 * Lesson reading progress — the rules, with no database access.
 *
 * Split out of `db/reading.ts`, because that module reaches into SQLite, which pulls in
 * React Native and breaks vitest. The boundary from CLAUDE.md: this logic has to stay free
 * of React Native imports.
 */

/**
 * At this scroll fraction, a lesson counts as read to the end.
 *
 * One threshold serves two purposes: marking a lesson as read, and deciding whether to
 * resume at the remembered position at all. Above it, resuming would drop the reader right
 * at the very end of the text, where there's nothing left to read.
 */
export const READ_THRESHOLD = 0.95;

/**
 * Prefix for the keys under which legal acts sit in the reading table.
 *
 * Acts share the table with lessons, because the need is the same — get back to where you
 * left off. They don't share the "read" state, though: an act is something you look things
 * up in, not something you "get through".
 *
 * The Polish spelling is not a leftover: it's a value persisted in the database, on every row
 * saved before routes were renamed to English. Changing it would orphan every saved reading
 * position already on a phone.
 */
export const ACT_KEY_PREFIX = 'akt:';

/**
 * Whether a key in the reading table describes a lesson, not a legal act.
 *
 * Without this filter, scrolling an act to the end bumped the count of lessons read:
 * saving position sets the "read" state above the threshold, and the table of contents
 * counted every row in the table. The split lives in the key namespace, so it has to be
 * one shared rule.
 */
export function isLessonKey(key: string): boolean {
  return !key.startsWith(ACT_KEY_PREFIX);
}

export type ReadingState = 'started' | 'read';

/**
 * Two numbers, because there are two questions.
 *
 * `position` is the last place the reader was, and answers "where do I open this lesson".
 * `maxPosition` is the furthest **confirmed** place — see `readingDwell` for what confirms
 * one — and answers "how far through is this lesson". Keeping a single value for both is
 * what made scrolling back up lower the reported progress.
 */
export interface Reading {
  position: number;
  maxPosition: number;
  state: ReadingState;
}

/**
 * Where to open a lesson — the last place, never the peak.
 *
 * A lesson marked as read opens from the start — a re-read starts over, and returning to
 * the last paragraph gains nothing. Checking position alongside state isn't redundant:
 * manually un-marking "read" leaves a high position behind, and in that case we still want
 * to start from the top.
 */
export function resumePosition(reading: Reading | null | undefined): number {
  if (!reading) return 0;
  if (reading.state === 'read') return 0;
  return reading.position >= READ_THRESHOLD ? 0 : reading.position;
}

export function readingLabel(reading: Reading | undefined): string | null {
  if (!reading) return null;
  if (reading.state === 'read') return 'przeczytane';
  const percent = Math.round(reading.maxPosition * 100);
  return percent < 3 ? 'zaczęte' : `w trakcie · ${percent}%`;
}
