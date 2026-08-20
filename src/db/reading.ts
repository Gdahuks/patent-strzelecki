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

function fraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function rowToReading(row: { position: number; max_position: number; state: string }): Reading {
  return {
    position: fraction(row.position),
    // The stored peak, and nothing else. Raising it to the last position here — which an
    // earlier version did, to cover rows written before the peak existed — hands the fling
    // its progress straight back: the last position follows every fling, so a lesson flung
    // to the end reported 100%. Rows from before the split get their peak seeded by
    // `migrateReadingToConfirmedPeak`, which is where that one-off belongs.
    maxPosition: fraction(row.max_position),
    state: row.state === 'read' ? 'read' : 'started',
  };
}

export async function loadReading(slug: string): Promise<Reading | null> {
  const database = await db();
  const row = await database.getFirstAsync<{
    position: number;
    max_position: number;
    state: string;
  }>('SELECT position, max_position, state FROM reading WHERE lesson_slug = ?', [slug]);
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
    max_position: number;
    state: string;
  }>('SELECT lesson_slug, position, max_position, state FROM reading');

  return new Map(
    rows
      .filter((row) => isLessonKey(row.lesson_slug))
      .map((row) => [row.lesson_slug, rowToReading(row)]),
  );
}

/**
 * Saves the last place the reader was — the answer to "where do I open this lesson".
 *
 * Deliberately says nothing about progress: having been somewhere is not having read it.
 * That is what `saveConfirmedProgress` is for, and keeping the two apart is what stopped
 * scrolling back up from lowering the reported progress.
 */
export async function saveReadingPosition(slug: string, position: number): Promise<void> {
  const clamped = Math.min(1, Math.max(0, position));

  const database = await db();
  await database.runAsync(
    `INSERT INTO reading (lesson_slug, position, max_position, state, updated_at)
     VALUES (?, ?, 0, 'started', ?)
     ON CONFLICT(lesson_slug) DO UPDATE SET
       position = excluded.position,
       updated_at = excluded.updated_at`,
    [slug, clamped, Date.now()],
  );
}

/**
 * Raises the confirmed peak, and with it the read state.
 *
 * Both only ever move upwards: the peak through `MAX`, the state because a lesson already
 * read stays read — read lessons get revisited during revision.
 */
export async function saveConfirmedProgress(slug: string, maxPosition: number): Promise<void> {
  const clamped = Math.min(1, Math.max(0, maxPosition));
  const reachedEnd = clamped >= READ_THRESHOLD;

  const database = await db();
  await database.runAsync(
    `INSERT INTO reading (lesson_slug, position, max_position, state, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lesson_slug) DO UPDATE SET
       max_position = MAX(reading.max_position, excluded.max_position),
       state = CASE WHEN reading.state = 'read' OR excluded.state = 'read'
                    THEN 'read' ELSE 'started' END,
       updated_at = excluded.updated_at`,
    [slug, clamped, clamped, reachedEnd ? 'read' : 'started', Date.now()],
  );
}

/**
 * Manually sets the state.
 *
 * Marking a lesson as read also moves the position and the peak to the end — otherwise the
 * state would say "read" while opening the lesson would jump back to the middle.
 *
 * Unmarking **clears the peak** and leaves the position alone: you get back to wherever you
 * left off, but the lesson counts as unread, which is what the tap said. Keeping the peak
 * there instead had two consequences, and the second one is the reason for this: a lesson
 * just declared unread reported "w trakcie · 100%", and — worse — the tracker could never
 * mark it read again. It only ever writes a peak that beats the stored one, so a peak left at
 * the end silences it for good, and re-reading the lesson to the end changed nothing.
 */
export async function setReadingState(slug: string, state: ReadingState): Promise<void> {
  const database = await db();

  if (state === 'read') {
    await database.runAsync(
      `INSERT INTO reading (lesson_slug, position, max_position, state, updated_at)
       VALUES (?, 1, 1, 'read', ?)
       ON CONFLICT(lesson_slug) DO UPDATE SET
         position = 1, max_position = 1, state = 'read', updated_at = excluded.updated_at`,
      [slug, Date.now()],
    );
    return;
  }

  await database.runAsync(
    `INSERT INTO reading (lesson_slug, position, max_position, state, updated_at)
     VALUES (?, 0, 0, 'started', ?)
     ON CONFLICT(lesson_slug) DO UPDATE SET
       max_position = 0, state = 'started', updated_at = excluded.updated_at`,
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
 * look things up in an act, you don't "get through" it. An act's row only ever gets a
 * position — `saveConfirmedProgress` is never called for it — and it drops out of the lesson
 * count via the prefix, which is why the same constant governs both writing and filtering
 * (`isLessonKey`).
 */
export async function loadActPosition(slug: string): Promise<number> {
  const reading = await loadReading(`${ACT_KEY_PREFIX}${slug}`);
  return reading?.position ?? 0;
}

export async function saveActPosition(slug: string, position: number): Promise<void> {
  await saveReadingPosition(`${ACT_KEY_PREFIX}${slug}`, position);
}
