import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { BundleQuestion, Letter } from '../content/types';
import { defaultView } from './answerDraw';
import { PATENT_PROFILE, gradeExam } from './exam';
import {
  type LegacyAnswers,
  type StoredAnswer,
  chosenTextOf,
  migrateAnswers,
  notBeforeOf,
  tableFor,
} from './attemptAnswers';

/**
 * The same question across two bundles. The old one stored letters: "B" meant 6500 g. The
 * refreshed one carries ids, and the course has meanwhile reshuffled and fixed a typo.
 */
const LEGACY: LegacyAnswers = {
  versions: { old1: 't', old2: 't' },
  tables: { t: { q1: ['8000 g', '6500 g', '5000 g', 'A'] } },
};

const CURRENT: BundleQuestion = {
  id: 'q1',
  question: 'Masa',
  options: [
    { id: 'q1_1', text: '5000 g' },
    { id: 'q1_2', text: '6500 g' },
    { id: 'q1_3', text: '8000 g' },
  ],
  correctId: 'q1_3',
  law: '',
  lesson: '',
};

const findId = (questionId: string, text: string) =>
  questionId === 'q1' ? CURRENT.options.find((option) => option.text === text)?.id : undefined;
const currentText = (questionId: string, answerId: string) =>
  questionId === 'q1' ? CURRENT.options.find((option) => option.id === answerId)?.text : undefined;

function legacyMiss(chosen: Letter | null): StoredAnswer {
  return { questionId: 'q1', chosen, wasCorrect: false, critical: false };
}

describe('a new attempt stores the answer by id', () => {
  const exam = () => {
    const question = defaultView(CURRENT);
    return [{ question, order: ['A', 'B', 'C'] as Letter[], critical: false }];
  };

  it('keeps showing what was chosen, whatever letter it gets later', () => {
    const [answer] = gradeExam(exam(), new Map([['q1', 'B']]), PATENT_PROFILE).answers;

    assert.equal(answer.chosenId, 'q1_2');
    assert.equal(answer.chosenText, '6500 g');
    assert.equal(chosenTextOf(answer, currentText), '6500 g');
  });

  it('shows the current text when the course fixed a typo under the same id', () => {
    const [answer] = gradeExam(exam(), new Map([['q1', 'B']]), PATENT_PROFILE).answers;
    const fixed = (_q: string, id: string) => (id === 'q1_2' ? '6500 g (poprawione)' : undefined);

    assert.equal(chosenTextOf(answer, fixed), '6500 g (poprawione)');
  });

  it('falls back to the stored text when the course dropped the answer', () => {
    const [answer] = gradeExam(exam(), new Map([['q1', 'B']]), PATENT_PROFILE).answers;

    assert.equal(
      chosenTextOf(answer, () => undefined),
      '6500 g',
    );
  });

  it('an unanswered question stores nothing', () => {
    const [answer] = gradeExam(exam(), new Map(), PATENT_PROFILE).answers;

    assert.equal(answer.chosenId, null);
    assert.equal(answer.chosenText, null);
  });
});

describe('migrating answers stored as letters only', () => {
  it('reads the letter in the bundle the device came from and finds its id now', () => {
    const { answers, changed } = migrateAnswers(
      [legacyMiss('B')],
      tableFor('old1', LEGACY),
      findId,
    );

    assert.equal(changed, true);
    assert.equal(answers[0].chosenText, '6500 g');
    assert.equal(answers[0].chosenId, 'q1_2');
    // Read by letter in the current view, "B" would now be 6500 g only by accident — the
    // point is that the id, not the letter, carries it from here on.
    assert.equal(chosenTextOf(answers[0], currentText), '6500 g');
  });

  it('every shipped version of the same scrape points at the same table', () => {
    const lookup = tableFor('old2', LEGACY);

    assert.equal(migrateAnswers([legacyMiss('B')], lookup, findId).answers[0].chosenText, '6500 g');
  });

  it('an answer the course has since dropped keeps its text without an id', () => {
    const { answers } = migrateAnswers(
      [legacyMiss('C')],
      tableFor('old1', LEGACY),
      () => undefined,
    );

    assert.equal(answers[0].chosenId, null);
    assert.equal(chosenTextOf(answers[0], currentText), '5000 g');
  });

  it('a version nobody kept the answers of leaves the answer unknown, not guessed', () => {
    const lookup = tableFor('older', LEGACY);
    assert.equal(lookup, null);

    const { answers, changed } = migrateAnswers([legacyMiss('B')], lookup, findId);
    // Nothing written: a later build with the table can still migrate it.
    assert.equal(changed, false);
    assert.equal(answers[0].chosenText, undefined);
    assert.equal(chosenTextOf(answers[0], currentText), null);
  });

  it('an attempt finished before the bundle was scraped was not taken on it', () => {
    const dated: LegacyAnswers = { ...LEGACY, scrapedAt: { old1: '2026-08-13T12:44:04+00:00' } };

    assert.equal(notBeforeOf('old1', dated), Date.parse('2026-08-13T12:44:04+00:00'));
    assert.equal(notBeforeOf('old2', dated), null);
    assert.equal(notBeforeOf(null, dated), null);
  });

  it('no stamp on disk means nothing to read the letters against', () => {
    assert.equal(tableFor(null, LEGACY), null);
  });

  it('a miss whose letter is the correct one in the table came from another bundle', () => {
    // An attempt older than the bundle the device came from: the table answers for the wrong
    // bundle, and the contradiction is the only trace of it. Showing "your answer" equal to
    // "correct" is exactly the bug this module exists for.
    const { answers } = migrateAnswers([legacyMiss('A')], tableFor('old1', LEGACY), findId);

    assert.equal(answers[0].chosenText, null);
  });

  it('a hit whose letter is not the correct one in the table is unknown too', () => {
    const hit: StoredAnswer = { questionId: 'q1', chosen: 'B', wasCorrect: true, critical: false };

    assert.equal(
      migrateAnswers([hit], tableFor('old1', LEGACY), findId).answers[0].chosenText,
      null,
    );
  });

  it('a question missing from the table is unknown', () => {
    const stray: StoredAnswer = { ...legacyMiss('B'), questionId: 'gone' };

    assert.equal(
      migrateAnswers([stray], tableFor('old1', LEGACY), findId).answers[0].chosenText,
      null,
    );
  });

  it('an unanswered question becomes an explicit null', () => {
    const { answers } = migrateAnswers([legacyMiss(null)], tableFor('old1', LEGACY), findId);

    assert.equal(answers[0].chosenText, null);
  });

  it('answers that already carry their text are left alone, so it can run on every start', () => {
    const done: StoredAnswer = { ...legacyMiss('B'), chosenId: 'q1_2', chosenText: '6500 g' };
    const unknown: StoredAnswer = { ...legacyMiss('B'), chosenId: null, chosenText: null };

    const { answers, changed } = migrateAnswers([done, unknown], tableFor('old1', LEGACY), findId);

    assert.equal(changed, false);
    assert.deepEqual(answers, [done, unknown]);
  });
});

describe('what the attempt card shows as „Twoja odpowiedź"', () => {
  it('never the correct answer on a miss, whichever way the text got there', () => {
    const answer: StoredAnswer = { ...legacyMiss('B'), chosenId: 'q1_2', chosenText: '6500 g' };

    assert.equal(chosenTextOf(answer, currentText, '6500 g'), null);
    assert.equal(chosenTextOf(answer, currentText, '8000 g'), '6500 g');
  });

  it('a hit keeps its text even though it equals the correct one', () => {
    const hit: StoredAnswer = { ...legacyMiss('A'), wasCorrect: true, chosenText: '8000 g' };

    assert.equal(chosenTextOf(hit, currentText, '8000 g'), '8000 g');
  });

  it('nothing for an answer that was never migrated — a letter alone proves nothing', () => {
    assert.equal(chosenTextOf(legacyMiss('B'), currentText), null);
  });
});
