import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { Letter, Question } from '../content/types';
import {
  NotEnoughQuestionsError,
  PATENT_PROFILE,
  WPA_PROFILE,
  buildPool,
  examProfile,
  latestMisses,
  unansweredNumbers,
  drawExam,
  formatRemaining,
  gradeExam,
  isCritical,
} from './exam';

const QUESTION_COUNT = PATENT_PROFILE.questionCount;
const CRITICAL_COUNT = PATENT_PROFILE.criticalCount;
const PASS_THRESHOLD = PATENT_PROFILE.passThreshold;

function question(id: string, lesson: string, correct: Letter = 'A'): Question {
  return {
    id,
    question: `pytanie ${id}`,
    answers: { A: 'a', B: 'b', C: 'c' },
    correct,
    law: 'art. 1',
    lesson,
  };
}

function pool(criticalCount: number, otherCount: number): Question[] {
  return [
    ...Array.from({ length: criticalCount }, (_, i) => question(`k${i}`, 'uobia')),
    ...Array.from({ length: otherCount }, (_, i) => question(`i${i}`, 'przepisy-karne')),
  ];
}

/** Deterministic generator — tests can't depend on Math.random. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('drawExam', () => {
  it('always draws a full set', () => {
    const exam = drawExam(pool(50, 50), PATENT_PROFILE, seeded(1));

    assert.equal(exam.length, QUESTION_COUNT);
  });

  it('puts critical questions in the first four positions', () => {
    const exam = drawExam(pool(50, 50), PATENT_PROFILE, seeded(7));

    for (let i = 0; i < CRITICAL_COUNT; i += 1) {
      assert.equal(exam[i].critical, true);
      assert.equal(isCritical(exam[i].question, PATENT_PROFILE), true);
    }
    for (let i = CRITICAL_COUNT; i < exam.length; i += 1) {
      assert.equal(exam[i].critical, false);
    }
  });

  it('does not repeat a question within one set', () => {
    const exam = drawExam(pool(50, 50), PATENT_PROFILE, seeded(3));
    const ids = exam.map((entry) => entry.question.id);

    assert.equal(new Set(ids).size, ids.length);
  });

  it('shuffles answer order', () => {
    const exam = drawExam(pool(50, 50), PATENT_PROFILE, seeded(5));

    for (const entry of exam) {
      assert.deepEqual([...entry.order].sort(), ['A', 'B', 'C']);
    }
    // With ten questions, the odds that every one comes out in A,B,C order are negligible.
    const untouched = exam.filter((e) => e.order.join('') === 'ABC').length;
    assert.ok(untouched < exam.length);
  });

  it('gives different sets for different random seeds', () => {
    const first = drawExam(pool(50, 50), PATENT_PROFILE, seeded(1)).map((e) => e.question.id);
    const second = drawExam(pool(50, 50), PATENT_PROFILE, seeded(999)).map((e) => e.question.id);

    assert.notDeepEqual(first, second);
  });

  it('tops up the set from the critical pool when regular questions run short', () => {
    const exam = drawExam(pool(30, 2), PATENT_PROFILE, seeded(11));

    assert.equal(exam.length, QUESTION_COUNT);
    assert.equal(new Set(exam.map((e) => e.question.id)).size, QUESTION_COUNT);
  });

  it('fails loudly when the critical pool is too small', () => {
    assert.throws(() => drawExam(pool(2, 50), PATENT_PROFILE, seeded(1)), NotEnoughQuestionsError);
  });

  it('fails loudly when the whole pool is too small', () => {
    assert.throws(() => drawExam(pool(4, 3), PATENT_PROFILE, seeded(1)), NotEnoughQuestionsError);
  });
});

/**
 * The lifecycle of the "exam from mistakes" pool, described through pure functions.
 *
 * This behaviour is easy to break without noticing: the pool is computed when an attempt
 * starts, so a bug here only shows up months later — the app keeps suggesting a question
 * the user has long since mastered, or the opposite, it loses a mistake the user never
 * actually fixed.
 */
describe('unansweredNumbers', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('numbers from one, in paper order', () => {
    const chosen = new Map<string, Letter | null>([
      ['a', 'A'],
      ['c', 'B'],
    ]);

    assert.deepEqual(unansweredNumbers(ids, chosen), [2, 4]);
  });

  it('treats null the same as a missing entry', () => {
    // The screen stores null when an answer gets deselected.
    const chosen = new Map<string, Letter | null>([['b', null]]);

    assert.deepEqual(unansweredNumbers(ids, chosen), [1, 2, 3, 4]);
  });

  it('gives an empty list for a complete paper', () => {
    const chosen = new Map<string, Letter | null>(ids.map((id) => [id, 'A']));

    assert.deepEqual(unansweredNumbers(ids, chosen), []);
  });
});

describe('lifecycle of the exam-from-mistakes pool', () => {
  const miss = (id: string) => ({ questionId: id, wasCorrect: false });
  const hit = (id: string) => ({ questionId: id, wasCorrect: true });
  /** Attempts always come newest first — that's how the database returns them. */
  const history = (...attempts: { questionId: string; wasCorrect: boolean }[][]) => attempts;

  it('after the first attempt, the pool is exactly its mistakes', () => {
    const missed = latestMisses(history([miss('k0'), hit('i0'), miss('i1')]));

    assert.deepEqual(missed, ['k0', 'i1']);
  });

  it('after correctly repeating every mistake, the pool is empty', () => {
    // This is exactly the "I passed the mistakes exam, so there's nothing left to build
    // another one from" scenario: the newer attempt gets both questions right that had
    // failed before.
    const missed = latestMisses(
      history([hit('k0'), hit('i1')], [miss('k0'), hit('i0'), miss('i1')]),
    );

    assert.deepEqual(missed, []);
  });

  it('an empty pool gives a regular exam from the whole database, not an error', () => {
    // Without this, the screen would have to check itself whether there's anything to
    // draw from.
    const base = pool(CRITICAL_COUNT, QUESTION_COUNT);
    const drawn = buildPool([], base, PATENT_PROFILE);

    assert.equal(drawn.length, QUESTION_COUNT);
    assert.ok(drawn.every((question) => base.some((entry) => entry.id === question.id)));
  });

  it('a partial fix leaves only the uncorrected ones in the pool', () => {
    const missed = latestMisses(history([hit('k0')], [miss('k0'), miss('i1')]));

    assert.deepEqual(missed, ['i1']);
  });

  it('a question missed again returns to the pool', () => {
    const missed = latestMisses(history([miss('i1')], [hit('i1')], [miss('i1')]));

    assert.deepEqual(missed, ['i1']);
  });

  it('the pool rests solely on exam mistakes, the database fills in the rest', () => {
    // The exam is a separate progress track: practice progress doesn't contribute a
    // single question here.
    const base = pool(CRITICAL_COUNT, QUESTION_COUNT);
    const missed = latestMisses(history([miss('k0'), miss('i2'), miss('i3')]));

    assert.deepEqual(missed, ['k0', 'i2', 'i3']);

    const drawn = buildPool(
      missed.map((id) => base.find((question) => question.id === id)!),
      base,
      PATENT_PROFILE,
    );

    // The three mistakes stay intact in full, the fallback fills in the rest — including
    // the missing critical ones.
    assert.equal(drawn.length, QUESTION_COUNT);
    assert.deepEqual(drawn.slice(0, 3).map((question) => question.id), ['k0', 'i2', 'i3']);
    assert.ok(drawn.filter((q) => isCritical(q, PATENT_PROFILE)).length >= CRITICAL_COUNT);
  });
});

describe('latestMisses', () => {
  const miss = (id: string) => ({ questionId: id, wasCorrect: false });
  const hit = (id: string) => ({ questionId: id, wasCorrect: true });

  it('takes questions whose latest answer was wrong', () => {
    assert.deepEqual(latestMisses([[miss('a'), hit('b')]]), ['a']);
  });

  it('a correct answer in a newer attempt removes the question from the pool', () => {
    // Attempts go newest first: a hit in the newer one, a miss in the older one.
    assert.deepEqual(latestMisses([[hit('a')], [miss('a')]]), []);
  });

  it('a mistake in a newer attempt returns to the pool, even if it was right before', () => {
    assert.deepEqual(latestMisses([[miss('a')], [hit('a')]]), ['a']);
  });

  it('does not duplicate a question repeated across many attempts', () => {
    assert.deepEqual(latestMisses([[miss('a')], [miss('a')], [miss('a')]]), ['a']);
  });

  it('handles an empty history', () => {
    assert.deepEqual(latestMisses([]), []);
    assert.deepEqual(latestMisses([[]]), []);
  });
});

describe('buildPool', () => {
  const base = pool(50, 50);

  it('keeps every preferred question intact', () => {
    const weak = [question('w0', 'uobia'), question('w1', 'przepisy-karne')];

    const result = buildPool(weak, base, PATENT_PROFILE);

    for (const q of weak) {
      assert.ok(result.some((entry) => entry.id === q.id));
    }
  });

  it('tops up to a full set when there are too few mistakes', () => {
    const result = buildPool([question('w0', 'przepisy-karne')], base, PATENT_PROFILE);

    assert.ok(result.length >= QUESTION_COUNT);
  });

  it('tops up the critical pool when none of the mistakes was critical', () => {
    const weak = Array.from({ length: 12 }, (_, i) => question(`w${i}`, 'przepisy-karne'));

    const result = buildPool(weak, base, PATENT_PROFILE);

    assert.ok(result.filter((q) => isCritical(q, PATENT_PROFILE)).length >= CRITICAL_COUNT);
  });

  it('does not repeat questions', () => {
    const weak = [base[0], base[1], question('w0', 'uobia')];

    const result = buildPool(weak, base, PATENT_PROFILE);

    assert.equal(new Set(result.map((q) => q.id)).size, result.length);
  });

  it('does not top up when the preferred ones are already enough', () => {
    const weak = pool(6, 8);

    const result = buildPool(weak, base, PATENT_PROFILE);

    assert.equal(result.length, weak.length);
  });

  it('any composed pool can always be drawn from', () => {
    for (const weak of [[], [question('w0', 'przepisy-karne')], pool(1, 3), pool(0, 9)]) {
      const result = buildPool(weak, base, PATENT_PROFILE);

      assert.doesNotThrow(() => drawExam(result, PATENT_PROFILE, seeded(13)));
    }
  });

  it("an empty fallback database can't rescue a too-small pool — the exception still fires", () => {
    const result = buildPool([question('w0', 'uobia')], [], PATENT_PROFILE);

    assert.throws(() => drawExam(result, PATENT_PROFILE, seeded(1)), NotEnoughQuestionsError);
  });
});

describe('gradeExam', () => {
  const exam = drawExam(pool(50, 50), PATENT_PROFILE, seeded(42));

  function answerAll(
    correctCount: number,
    wrongIndexes: number[] = [],
  ): Map<string, Letter | null> {
    const chosen = new Map<string, Letter | null>();
    let given = 0;
    exam.forEach((entry, index) => {
      const shouldBeWrong = wrongIndexes.includes(index) || given >= correctCount;
      chosen.set(entry.question.id, shouldBeWrong ? 'B' : entry.question.correct);
      if (!shouldBeWrong) given += 1;
    });
    return chosen;
  }

  it('passes a full set of correct answers', () => {
    const result = gradeExam(exam, answerAll(10), PATENT_PROFILE);

    assert.equal(result.score, 10);
    assert.equal(result.passed, true);
    assert.equal(result.failedOnCritical, false);
  });

  it('passes a single mistake outside the critical pool', () => {
    const result = gradeExam(exam, answerAll(10, [9]), PATENT_PROFILE);

    assert.equal(result.score, PASS_THRESHOLD);
    assert.equal(result.passed, true);
  });

  it('fails on two mistakes', () => {
    const result = gradeExam(exam, answerAll(10, [8, 9]), PATENT_PROFILE);

    assert.equal(result.score, 8);
    assert.equal(result.passed, false);
  });

  it('fails on a critical mistake despite a score above the threshold', () => {
    const result = gradeExam(exam, answerAll(10, [0]), PATENT_PROFILE);

    assert.equal(result.score, PASS_THRESHOLD);
    assert.equal(result.passed, false);
    assert.equal(result.failedOnCritical, true);
  });

  it('treats a missing answer as a mistake', () => {
    const chosen = new Map<string, Letter | null>();
    exam.forEach((entry, index) => {
      chosen.set(entry.question.id, index === 5 ? null : entry.question.correct);
    });

    const result = gradeExam(exam, chosen, PATENT_PROFILE);

    assert.equal(result.score, 9);
    assert.equal(result.answers[5].wasCorrect, false);
  });

  it('fails an empty paper', () => {
    const result = gradeExam(exam, new Map(), PATENT_PROFILE);

    assert.equal(result.score, 0);
    assert.equal(result.passed, false);
    assert.equal(result.failedOnCritical, false);
  });
});

/**
 * The WPA paper, whose rules come from § 4 of the exam regulation (Dz.U. 2023 poz. 1475):
 * twenty questions, thirty minutes, a pass mark of eighteen and no critical group.
 *
 * The critical group is the part that can break quietly. Everything about the draw used to
 * assume there is one, and asking for zero of them is a different thing from having none:
 * the first would still fail the "is the critical pool big enough" check.
 */
describe('the WPA profile', () => {
  it('carries the numbers from the regulation', () => {
    assert.equal(WPA_PROFILE.questionCount, 20);
    assert.equal(WPA_PROFILE.timeLimitSeconds, 30 * 60);
    assert.equal(WPA_PROFILE.passThreshold, 18);
    assert.equal(WPA_PROFILE.criticalCount, 0);
  });

  it('draws a full paper with nothing marked critical', () => {
    // The pool is full of questions the licence exam would treat as critical — under this
    // profile that classification simply doesn't exist.
    const exam = drawExam(pool(50, 50), WPA_PROFILE, seeded(2));

    assert.equal(exam.length, 20);
    assert.ok(exam.every((entry) => !entry.critical));
  });

  it('draws from a pool with no critical questions at all', () => {
    // The licence exam would throw here, and that's the trap: a profile without a critical
    // group must not inherit its requirement.
    assert.doesNotThrow(() => drawExam(pool(0, 25), WPA_PROFILE, seeded(4)));
  });

  it('still refuses a pool too small for the paper', () => {
    assert.throws(() => drawExam(pool(0, 19), WPA_PROFILE, seeded(1)), NotEnoughQuestionsError);
  });

  it('does not repeat a question within one paper', () => {
    const ids = drawExam(pool(50, 50), WPA_PROFILE, seeded(8)).map((e) => e.question.id);

    assert.equal(new Set(ids).size, 20);
  });

  it('passes at the threshold and fails one below it', () => {
    const exam = drawExam(pool(0, 40), WPA_PROFILE, seeded(6));
    const answers = (correct: number) =>
      new Map<string, Letter | null>(
        exam.map((entry, index) => [
          entry.question.id,
          index < correct ? entry.question.correct : 'B',
        ]),
      );

    const atThreshold = gradeExam(exam, answers(18), WPA_PROFILE);
    assert.equal(atThreshold.score, 18);
    assert.equal(atThreshold.passed, true);

    const below = gradeExam(exam, answers(17), WPA_PROFILE);
    assert.equal(below.score, 17);
    assert.equal(below.passed, false);
    // There is no critical group, so a failure can never be blamed on one.
    assert.equal(below.failedOnCritical, false);
  });

  it('a mistake on the first question is an ordinary mistake', () => {
    const exam = drawExam(pool(50, 50), WPA_PROFILE, seeded(9));
    const chosen = new Map<string, Letter | null>(
      exam.map((entry, index) => [entry.question.id, index === 0 ? 'B' : entry.question.correct]),
    );

    const result = gradeExam(exam, chosen, WPA_PROFILE);

    assert.equal(result.score, 19);
    assert.equal(result.passed, true);
    assert.equal(result.failedOnCritical, false);
  });

  it('tops a mistakes pool up to a full paper without demanding critical questions', () => {
    const base = pool(0, 40);
    const result = buildPool([base[0], base[1]], base, WPA_PROFILE);

    assert.equal(result.length, 20);
    assert.deepEqual(result.slice(0, 2).map((q) => q.id), [base[0].id, base[1].id]);
    assert.doesNotThrow(() => drawExam(result, WPA_PROFILE, seeded(12)));
  });
});

describe('examProfile', () => {
  it('finds a profile by id', () => {
    assert.equal(examProfile('wpa'), WPA_PROFILE);
    assert.equal(examProfile('patent'), PATENT_PROFILE);
  });

  it('falls back to the licence exam for anything unknown', () => {
    // Both callers hand over something they don't control — a route parameter and a column
    // read out of the database — and an attempt saved by a newer version has to stay
    // readable rather than crash the screen that opens it.
    assert.equal(examProfile(undefined), PATENT_PROFILE);
    assert.equal(examProfile(null), PATENT_PROFILE);
    assert.equal(examProfile('cokolwiek'), PATENT_PROFILE);
  });
});

describe('formatRemaining', () => {
  it('formats minutes and seconds', () => {
    assert.equal(formatRemaining(20 * 60), '20:00');
    assert.equal(formatRemaining(65), '1:05');
    assert.equal(formatRemaining(9), '0:09');
  });

  it('does not go below zero', () => {
    assert.equal(formatRemaining(-30), '0:00');
  });
});
