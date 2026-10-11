/**
 * What the user answered in an exam attempt — by the answer's id, not by its letter.
 *
 * Attempts used to store only the chosen letter, and the result screen looked it up in the
 * bundle the app carries **now**. A letter means something only within one bundle: the course
 * reshuffles the answers on every page load, so every content refresh moved the letters
 * (between 13 August and 9 October 2026 the correct answer's letter changed in 444 of 656
 * questions). After such an update an old attempt showed someone else's answer as „Twoja
 * odpowiedź" — often the correct one, printed in red right above the same text in green.
 *
 * Every attempt now stores the chosen answer's id and its text (`gradeExam`). The card shows
 * the answer's current text by id — so a typo the course fixes is fixed in the history too —
 * and falls back to the stored text when the course has dropped the answer.
 *
 * Attempts stored before that are migrated once, on the first start after the update and
 * before the content on disk is rewritten, because the stamp left there is the only record of
 * which bundle the device came from. The letters are read against that bundle's answers,
 * carried in the release as a table (`assets/content/legacy-answers.json`, built from the
 * bundles shipped so far), and the text found there is matched to an id in the current bundle.
 * Where that can't be done honestly the text stays `null` and the card shows no „Twoja
 * odpowiedź" line: a missing line is better than a wrong one.
 *
 * Pure: no disk, no database — `content/attemptMigration.ts` does the reading and writing.
 */

import type { Letter, Question } from '../content/types';

/** One answer of a stored attempt, as kept in the `answers` JSON of `exam_attempts`. */
export interface StoredAnswer {
  questionId: string;
  chosen: Letter | null;
  wasCorrect: boolean;
  critical: boolean;
  /** The chosen answer's id; `null` when unanswered or not recoverable. */
  chosenId?: string | null;
  /**
   * The chosen answer's text at the time of the exam. `undefined` — stored before the text
   * was kept, not migrated yet; `null` — unanswered, or not recoverable.
   */
  chosenText?: string | null;
}

/** Answers of a shipped bundle: question id → texts of A, B, C, then the correct letter. */
export type LegacyRow = [string, string, string, Letter];

/**
 * The table shipped with the release. Bundles from one scrape share their answers, so the
 * texts are kept once per distinct table and versions point at it.
 */
export interface LegacyAnswers {
  versions: Record<string, string>;
  tables: Record<string, Record<string, LegacyRow>>;
  /** When each version's content was scraped — an attempt finished earlier was not taken on it. */
  scrapedAt?: Record<string, string>;
}

type Entry = Pick<Question, 'answers' | 'correct'>;
export type Lookup = (questionId: string) => Entry | undefined;
/** The id of the answer with this exact text in the current bundle. */
export type FindId = (questionId: string, text: string) => string | undefined;
/** The current text of an answer by id. */
export type CurrentText = (questionId: string, answerId: string) => string | undefined;

/**
 * Where to read the letters of a device that was on bundle `version`.
 *
 * `null` when nothing honest can be said: no stamp on disk, or a bundle nobody kept the
 * answers of (released before the table existed in the releases directory).
 */
export function tableFor(version: string | null, legacy: LegacyAnswers): Lookup | null {
  if (version === null) return null;

  const key = legacy.versions[version];
  const table = key === undefined ? undefined : legacy.tables[key];
  if (!table) return null;

  return (id) => {
    const row = table[id];
    if (!row) return undefined;
    const [a, b, c, correct] = row;
    return { answers: { A: a, B: b, C: c }, correct };
  };
}

/**
 * The moment before which an attempt cannot have been taken on bundle `version`: its content
 * did not exist yet. The verdict check in `textFor` only catches attempts whose verdict the
 * table contradicts; one from an older bundle with a matching verdict would otherwise get
 * another wrong answer's text, about two times in three.
 */
export function notBeforeOf(version: string | null, legacy: LegacyAnswers): number | null {
  const stamp = version === null ? undefined : legacy.scrapedAt?.[version];
  const time = stamp === undefined ? NaN : Date.parse(stamp);
  return Number.isNaN(time) ? null : time;
}

function textFor(answer: StoredAnswer, lookup: Lookup | null): string | null {
  if (!answer.chosen || !lookup) return null;

  const entry = lookup(answer.questionId);
  const text = entry?.answers[answer.chosen];
  if (!entry || !text) return null;

  // The verdict was stored at the time of the exam. A table that disagrees with it is the
  // table of a different bundle — the attempt predates the bundle the device came from.
  if ((answer.chosen === entry.correct) !== answer.wasCorrect) return null;

  return text;
}

/**
 * Gives every letter-only answer its text and id. Answers already carrying a text (or an
 * explicit `null`) are left alone, so running this on every start changes nothing.
 *
 * Without a table nothing is written at all: the card hides an answer it can't read either
 * way, so there is nothing to gain from recording that it couldn't be read.
 */
export function migrateAnswers(
  answers: readonly StoredAnswer[],
  lookup: Lookup | null,
  findId: FindId,
): { answers: StoredAnswer[]; changed: boolean } {
  if (lookup === null) return { answers: [...answers], changed: false };
  let changed = false;
  const migrated = answers.map((answer) => {
    if (answer.chosenText !== undefined) return answer;
    changed = true;
    const text = textFor(answer, lookup);
    return {
      ...answer,
      chosenText: text,
      chosenId: text === null ? null : (findId(answer.questionId, text) ?? null),
    };
  });
  return { answers: migrated, changed };
}

/**
 * The „Twoja odpowiedź" text — `null` when there is none to show.
 *
 * `correctText` is the last guard: a miss can never show the correct answer as the user's own,
 * whatever path got it there — a course that has since made that answer the correct one, or a
 * migration matching an old text to today's correct answer. That sight is the bug this module
 * exists for, so it is ruled out here rather than trusted not to happen.
 */
export function chosenTextOf(
  answer: StoredAnswer,
  currentText: CurrentText,
  correctText?: string,
): string | null {
  let text = answer.chosenText ?? null;
  if (answer.chosenId) {
    const current = currentText(answer.questionId, answer.chosenId);
    if (current !== undefined) text = current;
  }
  if (!answer.wasCorrect && text !== null && text === correctText) return null;
  return text;
}
