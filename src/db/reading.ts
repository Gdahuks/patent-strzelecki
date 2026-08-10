/**
 * Lesson reading progress — the database layer.
 *
 * The rules (the "read" threshold, the resume position, the state label) live in
 * `engine/readingProgress.ts`, so they can be tested without React Native.
 *
 * The position is stored as a scroll fraction (0..1), not a pixel count: content height
 * changes with font scale and screen width, so a pixel offset would point at a completely
 * different place after a settings change.
 */

import {
  ACT_KEY_PREFIX,
  READ_THRESHOLD,
  type Reading,
  type ReadingState,
  isLessonKey,
  readingLabel,
  resumePosition,
} from '../engine/readingProgress';
import { db } from './database';

export { READ_THRESHOLD, readingLabel, resumePosition };
export type { Reading, ReadingState };

function rowToReading(row: { position: number; state: string }): Reading {
  return {
    position: Number.isFinite(row.position) ? Math.min(1, Math.max(0, row.position)) : 0,
    state: row.state === 'read' ? 'read' : 'started',
  };
}

export async function loadReading(slug: string): Promise<Reading | null> {
  const database = await db();
  const row = await database.getFirstAsync<{ position: number; state: string }>(
    'SELECT position, state FROM reading WHERE lesson_slug = ?',
    [slug],
  );
  return row ? rowToReading(row) : null;
}

/**
 * Reading state for **lessons**. Acts are excluded, since they share this table under
 * their own keys, and the table of contents counts read lessons from this map — a
 * scrolled-through act used to show up in it as a lesson nobody had actually opened.
 */
export async function loadAllReading(): Promise<Map<string, Reading>> {
  const database = await db();
  const rows = await database.getAllAsync<{
    lesson_slug: string;
    position: number;
    state: string;
  }>('SELECT lesson_slug, position, state FROM reading');

  return new Map(
    rows
      .filter((row) => isLessonKey(row.lesson_slug))
      .map((row) => [row.lesson_slug, rowToReading(row)]),
  );
}

/**
 * Saves the reading position. Once a lesson is marked as read, it stays read — scrolling
 * back up on its own must not revert the state, since read lessons get revisited during
 * revision.
 */
export async function saveReadingPosition(slug: string, position: number): Promise<void> {
  const clamped = Math.min(1, Math.max(0, position));
  const reachedEnd = clamped >= READ_THRESHOLD;

  const database = await db();
  await database.runAsync(
    `INSERT INTO reading (lesson_slug, position, state, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(lesson_slug) DO UPDATE SET
       position = excluded.position,
       state = CASE WHEN reading.state = 'read' OR excluded.state = 'read'
                    THEN 'read' ELSE 'started' END,
       updated_at = excluded.updated_at`,
    [slug, clamped, reachedEnd ? 'read' : 'started', Date.now()],
  );
}

/**
 * Manually sets the state.
 *
 * Marking a lesson as read also moves the position to the end — otherwise the state
 * would say "read" while opening the lesson would jump back to the middle. Unmarking it
 * leaves the position alone, so you can get back to wherever you left off.
 */
export async function setReadingState(slug: string, state: ReadingState): Promise<void> {
  const database = await db();

  if (state === 'read') {
    await database.runAsync(
      `INSERT INTO reading (lesson_slug, position, state, updated_at)
       VALUES (?, 1, 'read', ?)
       ON CONFLICT(lesson_slug) DO UPDATE SET
         position = 1, state = 'read', updated_at = excluded.updated_at`,
      [slug, Date.now()],
    );
    return;
  }

  await database.runAsync(
    `INSERT INTO reading (lesson_slug, position, state, updated_at)
     VALUES (?, 0, 'started', ?)
     ON CONFLICT(lesson_slug) DO UPDATE SET
       state = 'started', updated_at = excluded.updated_at`,
    [slug, Date.now()],
  );
}

export async function clearReading(slug: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM reading WHERE lesson_slug = ?', [slug]);
}

/** Clears reading progress for all lessons. */
/**
 * Clears reading progress for **lessons**. Bookmarks in acts are left alone.
 *
 * This used to be a bare `DELETE FROM reading`, i.e. it also wiped positions inside legal
 * acts — even though the button is labelled "Lesson reading progress", and "Everything at
 * once" also only promises lessons. A bookmark in an act isn't really progress anyway:
 * it's just where you stopped reading the act, and there's nothing to "start over" from.
 */
export async function resetAllReading(): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM reading WHERE lesson_slug NOT LIKE ?', [
    `${ACT_KEY_PREFIX}%`,
  ]);
}

/**
 * Reading position for a legal act.
 *
 * Kept in the same table, under a prefixed key, because it's the same need: getting back
 * to wherever you left off. Acts deliberately have no "read" state or percentage — you
 * look things up in an act, you don't "get through" it. The act's row still gets a state
 * from `saveReadingPosition`; it only drops out of the lesson count via the prefix, which
 * is why the same constant governs both writing and filtering (`isLessonKey`).
 */
export async function loadActPosition(slug: string): Promise<number> {
  const reading = await loadReading(`${ACT_KEY_PREFIX}${slug}`);
  return reading?.position ?? 0;
}

export async function saveActPosition(slug: string, position: number): Promise<void> {
  await saveReadingPosition(`${ACT_KEY_PREFIX}${slug}`, position);
}
