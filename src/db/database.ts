/**
 * Learning progress — persisted in SQLite.
 *
 * The original course keeps progress in `localStorage`, so it disappears when browser
 * data is cleared and doesn't carry over between devices. Here it's a separate database,
 * deliberately independent of the content bundle: updating the questions must not wipe
 * out progress.
 */

import * as SQLite from 'expo-sqlite';

import { type ExamProfileId, latestMisses } from '../engine/exam';
import type { Card } from '../engine/leitner';

const DATABASE = 'patent.db';

/**
 * Practice mode. Progress is counted separately, because these are two different skills:
 * a flashcard checks whether you remember the content of the correct answer, while a quiz
 * checks whether you recognise it among distractors. Recognition is easier, so a shared
 * counter would inflate flashcard progress. The original course keeps them separate too.
 */
export type PracticeMode = 'flashcards' | 'test';

/**
 * Opening the database is memoized **as a promise**, not as a ready handle.
 *
 * A version with `let handle` and `if (handle) return handle` had a race: there's an
 * `await` between the check and the assignment, so two concurrent calls both saw `null`
 * and both opened the database and both kicked off the migration. The exam screen does
 * exactly that — `recentAttempts()` and `weakQuestionIds()` start side by side, with no
 * `await` between them. On the first run after a schema update, both migrations ran into
 * `ALTER TABLE progress RENAME TO progress_bez_trybu`, and the second one crashed on a
 * table that already existed — i.e. learning progress was lost behind a rejected promise.
 *
 * Memoizing the promise itself makes concurrent callers wait for the same open.
 */
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Splits progress into modes.
 *
 * Existing rows go into **both** modes. Duplicating instead of picking one mode is
 * deliberate here: nobody loses progress, and the only side effect is a one-time
 * over-crediting of questions that had previously only been touched in one mode. Losing
 * progress would be a worse mistake than inflating it.
 */
async function migrateProgressToModes(database: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM pragma_table_info('progress')",
  );
  if (columns.length === 0 || columns.some((column) => column.name === 'mode')) return;

  await database.execAsync(`
    BEGIN;
    ALTER TABLE progress RENAME TO progress_bez_trybu;
    CREATE TABLE progress (
      question_id TEXT NOT NULL,
      mode        TEXT NOT NULL,
      bucket      INTEGER NOT NULL DEFAULT 0,
      seen        INTEGER NOT NULL DEFAULT 0,
      correct     INTEGER NOT NULL DEFAULT 0,
      last_seen   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (question_id, mode)
    );
    INSERT INTO progress (question_id, mode, bucket, seen, correct, last_seen)
      SELECT question_id, 'flashcards', bucket, seen, correct, last_seen FROM progress_bez_trybu
      UNION ALL
      SELECT question_id, 'test', bucket, seen, correct, last_seen FROM progress_bez_trybu;
    DROP TABLE progress_bez_trybu;
    COMMIT;
  `);
}

/**
 * Splits attempts into exam profiles.
 *
 * Every attempt taken before the WPA profile existed was a licence exam, so `'patent'` is
 * a fact about those rows, not a guess. It has to be written down, though: without it the
 * history can't tell „9/10" from „18/20", and the result screen wouldn't know how many
 * questions the score is out of.
 *
 * The table is rebuilt rather than extended with `ALTER TABLE ADD COLUMN … DEFAULT`. A
 * default on the column is a standing rule, and this is a one-time statement about old
 * rows: with the default in place, a future insert that forgets the profile would be
 * silently recorded as a licence exam instead of failing. Here the value appears in the
 * `INSERT ... SELECT`, where it can only ever touch the rows being migrated, and the
 * resulting schema is identical to the one a fresh install gets.
 */
async function migrateAttemptsToProfiles(database: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM pragma_table_info('exam_attempts')",
  );
  if (columns.length === 0 || columns.some((column) => column.name === 'profile')) return;

  // Ids are carried over explicitly: the result screen is reached by id, so history links
  // saved anywhere else would break if the rebuild renumbered the attempts.
  await database.execAsync(`
    BEGIN;
    ALTER TABLE exam_attempts RENAME TO exam_attempts_bez_profilu;
    CREATE TABLE exam_attempts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at  INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      score       INTEGER NOT NULL,
      passed      INTEGER NOT NULL,
      critical_failed INTEGER NOT NULL,
      answers     TEXT NOT NULL,
      profile     TEXT NOT NULL
    );
    INSERT INTO exam_attempts
        (id, started_at, finished_at, score, passed, critical_failed, answers, profile)
      SELECT id, started_at, finished_at, score, passed, critical_failed, answers, 'patent'
      FROM exam_attempts_bez_profilu;
    DROP TABLE exam_attempts_bez_profilu;
    COMMIT;
  `);
}

export function db(): Promise<SQLite.SQLiteDatabase> {
  // A failed open must not be memoized forever — otherwise one startup error would
  // cripple the app until the next restart. On rejection we clear the memoized promise,
  // so the next call tries again from scratch.
  opening ??= openDatabase().catch((cause: unknown) => {
    opening = null;
    throw cause;
  });
  return opening;
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const handle = await SQLite.openDatabaseAsync(DATABASE);
  await handle.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS progress (
      question_id TEXT NOT NULL,
      mode        TEXT NOT NULL DEFAULT 'flashcards',
      bucket      INTEGER NOT NULL DEFAULT 0,
      seen        INTEGER NOT NULL DEFAULT 0,
      correct     INTEGER NOT NULL DEFAULT 0,
      last_seen   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (question_id, mode)
    );
    CREATE TABLE IF NOT EXISTS reading (
      lesson_slug TEXT PRIMARY KEY NOT NULL,
      position    REAL NOT NULL DEFAULT 0,
      state       TEXT NOT NULL DEFAULT 'started',
      updated_at  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exam_attempts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at  INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      score       INTEGER NOT NULL,
      passed      INTEGER NOT NULL,
      critical_failed INTEGER NOT NULL,
      answers     TEXT NOT NULL,
      profile     TEXT NOT NULL
    );
  `);

  await migrateProgressToModes(handle);
  await migrateAttemptsToProfiles(handle);
  return handle;
}

export async function loadCards(
  questionIds: string[],
  mode: PracticeMode,
): Promise<Map<string, Card>> {
  if (questionIds.length === 0) return new Map();

  const database = await db();
  const placeholders = questionIds.map(() => '?').join(',');
  const rows = await database.getAllAsync<{
    question_id: string;
    bucket: number;
    seen: number;
    correct: number;
  }>(
    `SELECT question_id, bucket, seen, correct FROM progress
     WHERE mode = ? AND question_id IN (${placeholders})`,
    [mode, ...questionIds],
  );

  return new Map(
    rows.map((row) => [
      row.question_id,
      { questionId: row.question_id, bucket: row.bucket, seen: row.seen, correct: row.correct },
    ]),
  );
}

export async function saveCard(card: Card, mode: PracticeMode): Promise<void> {
  const database = await db();
  await database.runAsync(
    `INSERT INTO progress (question_id, mode, bucket, seen, correct, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(question_id, mode) DO UPDATE SET
       bucket = excluded.bucket,
       seen = excluded.seen,
       correct = excluded.correct,
       last_seen = excluded.last_seen`,
    [card.questionId, mode, card.bucket, card.seen, card.correct, Date.now()],
  );
}

export async function resetProgress(
  questionIds: string[],
  mode: PracticeMode,
): Promise<void> {
  if (questionIds.length === 0) return;

  const database = await db();
  const placeholders = questionIds.map(() => '?').join(',');
  await database.runAsync(
    `DELETE FROM progress WHERE mode = ? AND question_id IN (${placeholders})`,
    [mode, ...questionIds],
  );
}

export interface StoredAttempt {
  id: number;
  finishedAt: number;
  score: number;
  passed: boolean;
  criticalFailed: boolean;
  profile: ExamProfileId;
}

export async function saveAttempt(attempt: {
  startedAt: number;
  finishedAt: number;
  score: number;
  passed: boolean;
  criticalFailed: boolean;
  answers: unknown;
  profile: ExamProfileId;
}): Promise<void> {
  const database = await db();
  await database.runAsync(
    `INSERT INTO exam_attempts
       (started_at, finished_at, score, passed, critical_failed, answers, profile)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      attempt.startedAt,
      attempt.finishedAt,
      attempt.score,
      attempt.passed ? 1 : 0,
      attempt.criticalFailed ? 1 : 0,
      JSON.stringify(attempt.answers),
      attempt.profile,
    ],
  );
}

/** History of one exam profile — the two are never mixed, their scales differ. */
export async function recentAttempts(
  profile: ExamProfileId,
  limit = 20,
): Promise<StoredAttempt[]> {
  const database = await db();
  const rows = await database.getAllAsync<{
    id: number;
    finished_at: number;
    score: number;
    passed: number;
    critical_failed: number;
    profile: string;
  }>(
    `SELECT id, finished_at, score, passed, critical_failed, profile
     FROM exam_attempts WHERE profile = ? ORDER BY finished_at DESC LIMIT ?`,
    [profile, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    finishedAt: row.finished_at,
    score: row.score,
    passed: row.passed === 1,
    criticalFailed: row.critical_failed === 1,
    profile: row.profile as ExamProfileId,
  }));
}

/**
 * Questions you've gotten wrong: seen, yet still in the lowest bucket.
 *
 * The `seen > 0` condition matters here — without it, the entire untouched database
 * would end up here too, since a new question also starts out in bucket zero.
 */
export async function weakQuestionIds(mode: PracticeMode, maxBucket = 0): Promise<string[]> {
  const database = await db();
  const rows = await database.getAllAsync<{ question_id: string }>(
    `SELECT question_id FROM progress
     WHERE mode = ? AND seen > 0 AND bucket <= ?
     ORDER BY correct - seen ASC, last_seen ASC`,
    [mode, maxBucket],
  );
  return rows.map((row) => row.question_id);
}

/**
 * Applies an answer's result onto a question's existing progress.
 *
 * The exam used to build a card from scratch and save it through `saveCard`, which, via
 * `ON CONFLICT ... DO UPDATE`, **overwrote** all prior progress: a question mastered
 * through practice dropped back to the first bucket after the exam, and its counters
 * reset to zero. Here the card is loaded first, so advancement is counted from wherever
 * it already stood.
 */
/** Clears the spaced-repetition buckets for all questions. Doesn't touch reading or exams. */
/**
 * Questions whose latest exam answer was wrong.
 *
 * The exam doesn't touch practice progress, so its mistakes never land in the buckets —
 * and it would be a shame to lose them when drawing an "exam from the weak-question pool".
 * We read them from attempt history instead; the rule "the latest verdict counts" lives in
 * `latestMisses`, so it can be tested without a database. No window on the number of
 * attempts: the table is small, and a correct answer removes the question from the pool
 * either way.
 */
export async function missedQuestionIds(): Promise<string[]> {
  const database = await db();
  const rows = await database.getAllAsync<{ answers: string }>(
    'SELECT answers FROM exam_attempts ORDER BY finished_at DESC',
  );

  const attempts: AttemptAnswer[][] = [];
  for (const row of rows) {
    try {
      attempts.push(JSON.parse(row.answers) as AttemptAnswer[]);
    } catch {
      // A corrupted entry is skipped — the rest of the history is still useful.
    }
  }
  return latestMisses(attempts);
}

export async function resetAllProgress(): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM progress');
}

export async function deleteAttempt(id: number): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM exam_attempts WHERE id = ?', [id]);
}

/**
 * Clears the history of one profile.
 *
 * Deliberately not the whole table: the exam screen shows one profile at a time, and a
 * button that also wiped attempts the screen isn't showing would destroy them unseen.
 */
export async function clearAttempts(profile: ExamProfileId): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM exam_attempts WHERE profile = ?', [profile]);
}

/** Every profile at once — for the wipes in Settings, which promise exactly that. */
export async function clearAllAttempts(): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM exam_attempts');
}

export interface AttemptAnswer {
  questionId: string;
  chosen: 'A' | 'B' | 'C' | null;
  wasCorrect: boolean;
  critical: boolean;
}

export interface AttemptDetail extends StoredAttempt {
  startedAt: number;
  answers: AttemptAnswer[];
}

export async function attemptDetail(id: number): Promise<AttemptDetail | null> {
  const database = await db();
  const row = await database.getFirstAsync<{
    id: number;
    started_at: number;
    finished_at: number;
    score: number;
    passed: number;
    critical_failed: number;
    answers: string;
    profile: string;
  }>('SELECT * FROM exam_attempts WHERE id = ?', [id]);

  if (!row) return null;

  let answers: AttemptAnswer[] = [];
  try {
    const parsed: unknown = JSON.parse(row.answers);
    if (Array.isArray(parsed)) answers = parsed as AttemptAnswer[];
  } catch {
    // A corrupted record must not crash the screen — we'll show just the numeric summary.
  }

  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    score: row.score,
    passed: row.passed === 1,
    criticalFailed: row.critical_failed === 1,
    profile: row.profile as ExamProfileId,
    answers,
  };
}

