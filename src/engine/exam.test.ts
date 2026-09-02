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
  criticalCount,
  drawExam,
  formatRemaining,
  gradeExam,
  solvingTime,
} from './exam';

const QUESTION_COUNT = PATENT_PROFILE.questionCount;
const CRITICAL_COUNT = criticalCount(PATENT_PROFILE);
const PASS_THRESHOLD = PATENT_PROFILE.passThreshold;
const LAYER_COUNT = PATENT_PROFILE.layers.length;

function question(id: string, lesson = 'uobia', correct: Letter = 'A'): Question {
  return {
    id,
    question: `pytanie ${id}`,
    answers: { A: 'a', B: 'b', C: 'c' },
    correct,
    law: 'art. 1',
    lesson,
  };
}

/**
 * One pool per layer, each holding `size` questions whose ids carry the layer number.
 *
 * The id prefix is what lets a test assert "two questions from every area" without the
 * engine having to expose which layer a drawn question came from.
 */
function layers(...sizes: number[]): Question[][] {
  return sizes.map((size, layer) =>
    Array.from({ length: size }, (_, i) => question(`l${layer}q${i}`)),
  );
}

/** Layer pools big enough for any licence paper. */
function full(): Question[][] {
  return layers(...Array.from({ length: LAYER_COUNT }, () => 20));
}

/** Which layer a drawn question came from, read back from its id. */
function layerOf(entry: { question: Question }): number {
  return Number(/^l(\d+)q/.exec(entry.question.id)![1]);
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
    const exam = drawExam(full(), PATENT_PROFILE, seeded(1));

    assert.equal(exam.length, QUESTION_COUNT);
  });

  it('takes exactly the asked-for count from every layer', () => {
    // § 19 ust. 1 — the whole point of the change. A flat draw satisfied the total and left
    // whole areas off the paper.
    const exam = drawExam(full(), PATENT_PROFILE, seeded(7));

    PATENT_PROFILE.layers.forEach((layer, index) => {
      assert.equal(exam.filter((entry) => layerOf(entry) === index).length, layer.count);
    });
  });

  it('opens the paper with the critical layers', () => {
    const exam = drawExam(full(), PATENT_PROFILE, seeded(7));
    const criticalLayers = PATENT_PROFILE.layers
      .map((layer, index) => ({ layer, index }))
      .filter((entry) => entry.layer.critical)
      .map((entry) => entry.index);

    for (let i = 0; i < CRITICAL_COUNT; i += 1) {
      assert.equal(exam[i].critical, true);
      assert.ok(criticalLayers.includes(layerOf(exam[i])));
    }
    for (let i = CRITICAL_COUNT; i < exam.length; i += 1) {
      assert.equal(exam[i].critical, false);
    }
  });

  it('does not repeat a question within one set', () => {
    const exam = drawExam(full(), PATENT_PROFILE, seeded(3));
    const ids = exam.map((entry) => entry.question.id);

    assert.equal(new Set(ids).size, ids.length);
  });

  it('does not repeat a question that belongs to two layers', () => {
    // 43 questions in the bundle are penal provisions of the Act itself, so they sit in both
    // the first area and the fifth. Without dedup the same question could be asked twice.
    const shared = question('shared');
    const pools = full();
    pools[0] = [shared, ...pools[0]];
    pools[4] = [shared, ...pools[4]];

    for (let seed = 1; seed <= 40; seed += 1) {
      const ids = drawExam(pools, PATENT_PROFILE, seeded(seed)).map((e) => e.question.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  });

  it('shuffles answer order', () => {
    const exam = drawExam(full(), PATENT_PROFILE, seeded(5));

    for (const entry of exam) {
      assert.deepEqual([...entry.order].sort(), ['A', 'B', 'C']);
    }
    // With ten questions, the odds that every one comes out in A,B,C order are negligible.
    const untouched = exam.filter((e) => e.order.join('') === 'ABC').length;
    assert.ok(untouched < exam.length);
  });

  it('gives different sets for different random seeds', () => {
    const first = drawExam(full(), PATENT_PROFILE, seeded(1)).map((e) => e.question.id);
    const second = drawExam(full(), PATENT_PROFILE, seeded(999)).map((e) => e.question.id);

    assert.notDeepEqual(first, second);
  });

  it('does not leak the layer structure into the question order', () => {
    // Layer-by-layer order would make question seven always a range-rules one, and positions
    // learnable. Both halves of the paper are shuffled, the critical one included.
    const orders = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      orders.add(
        drawExam(full(), PATENT_PROFILE, seeded(seed))
          .map((entry) => layerOf(entry))
          .join(''),
      );
    }

    assert.ok(orders.size > 1, 'kolejność zagadnień w arkuszu jest stała');
  });

  it('fails loudly when a layer is too thin, naming it', () => {
    const pools = full();
    pools[2] = pools[2].slice(0, 1);

    assert.throws(
      () => drawExam(pools, PATENT_PROFILE, seeded(1)),
      (error: Error) =>
        error instanceof NotEnoughQuestionsError
        && error.message.includes(PATENT_PROFILE.layers[2].category),
    );
  });

  it('does not borrow from another layer to fill a thin one', () => {
    // Borrowing would keep the paper looking complete while quietly breaking "two from each
    // area" — the promise whose breach is invisible.
    const pools = full();
    pools[3] = [];

    assert.throws(() => drawExam(pools, PATENT_PROFILE, seeded(1)), NotEnoughQuestionsError);
  });

  it('draws the police paper as one flat layer', () => {
    const exam = drawExam(layers(60), WPA_PROFILE, seeded(4));

    assert.equal(exam.length, WPA_PROFILE.questionCount);
    assert.ok(exam.every((entry) => entry.critical === false));
  });
});

describe('profile shape', () => {
  it('every profile asks for as many questions as its layers add up to', () => {
    // The screens read `questionCount` as the denominator of every past attempt, so a layer
    // edited without it would silently rescale the whole history.
    for (const profile of [PATENT_PROFILE, WPA_PROFILE]) {
      const fromLayers = profile.layers.reduce((sum, layer) => sum + layer.count, 0);
      assert.equal(profile.questionCount, fromLayers, profile.id);
    }
  });

  it('the licence paper opens with four questions that must be correct', () => {
    assert.equal(criticalCount(PATENT_PROFILE), 4);
    assert.equal(criticalCount(WPA_PROFILE), 0);
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
    const drawn = buildPool([], full(), PATENT_PROFILE);

    assert.doesNotThrow(() => drawExam(drawn, PATENT_PROFILE, seeded(21)));
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
    const missed = latestMisses(history([miss('l0q1'), miss('l3q2'), miss('l4q0')]));

    assert.deepEqual(missed, ['l0q1', 'l3q2', 'l4q0']);

    const pools = buildPool(
      missed.map((id) => question(id)),
      full(),
      PATENT_PROFILE,
    );

    // Every mistake stays in its own area, and the rest of each layer is topped up so the
    // paper can still be drawn.
    assert.ok(pools[0].some((entry) => entry.id === 'l0q1'));
    assert.ok(pools[3].some((entry) => entry.id === 'l3q2'));
    assert.ok(pools[4].some((entry) => entry.id === 'l4q0'));
    assert.doesNotThrow(() => drawExam(pools, PATENT_PROFILE, seeded(9)));
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
  const preferred = (...ids: string[]) => ids.map((id) => question(id));

  it('keeps every preferred question in its own layer', () => {
    const pools = buildPool(preferred('l0q3', 'l4q2'), full(), PATENT_PROFILE);

    assert.ok(pools[0].some((entry) => entry.id === 'l0q3'));
    assert.ok(pools[4].some((entry) => entry.id === 'l4q2'));
  });

  it('tops every layer up on its own when the mistakes are lopsided', () => {
    // Six mistakes, all from one area. Topping up globally looked like a full pool and the
    // draw then failed on the layer that had nothing — the screen hung on its spinner.
    const lopsided = preferred('l0q0', 'l0q1', 'l0q2', 'l0q3', 'l0q4', 'l0q5');

    const pools = buildPool(lopsided, full(), PATENT_PROFILE);

    PATENT_PROFILE.layers.forEach((layer, index) => {
      assert.ok(pools[index].length >= layer.count, `warstwa ${index}`);
    });
    assert.doesNotThrow(() => drawExam(pools, PATENT_PROFILE, seeded(13)));
  });

  it('a single mistake still yields a drawable paper', () => {
    const pools = buildPool(preferred('l2q7'), full(), PATENT_PROFILE);

    assert.doesNotThrow(() => drawExam(pools, PATENT_PROFILE, seeded(5)));
  });

  it('no mistakes at all yields a drawable paper', () => {
    const pools = buildPool([], full(), PATENT_PROFILE);

    assert.doesNotThrow(() => drawExam(pools, PATENT_PROFILE, seeded(2)));
  });

  it('does not repeat a question inside a layer', () => {
    const pools = buildPool(preferred('l1q0', 'l1q0'), full(), PATENT_PROFILE);

    for (const layerPool of pools) {
      const ids = layerPool.map((entry) => entry.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  });

  it('a shared question in an early layer does not starve a later one', () => {
    // The draw dedupes across the paper, so a top-up counting questions an earlier layer
    // already holds would leave the later layer one short at draw time.
    const shared = question('shared');
    const pools = full();
    pools[0] = [shared, ...pools[0]];
    pools[4] = [shared, question('l4q0'), question('l4q1')];

    const built = buildPool([shared], pools, PATENT_PROFILE);

    assert.doesNotThrow(() => drawExam(built, PATENT_PROFILE, seeded(8)));
  });

  it('an empty database cannot rescue a layer with nothing in it', () => {
    const pools = buildPool(preferred('l0q0'), [[], [], [], [], []], PATENT_PROFILE);

    assert.throws(() => drawExam(pools, PATENT_PROFILE, seeded(1)), NotEnoughQuestionsError);
  });
});

describe('gradeExam', () => {
  const exam = drawExam(full(), PATENT_PROFILE, seeded(42));

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
    assert.equal(criticalCount(WPA_PROFILE), 0);
  });

  it('draws a full paper with nothing marked critical', () => {
    // The pool is full of questions the licence exam would treat as critical — under this
    // profile that classification simply doesn't exist.
    const exam = drawExam(layers(40), WPA_PROFILE, seeded(2));

    assert.equal(exam.length, 20);
    assert.ok(exam.every((entry) => !entry.critical));
  });

  it('draws from a pool with no critical questions at all', () => {
    // The licence exam would throw here, and that's the trap: a profile without a critical
    // group must not inherit its requirement.
    assert.doesNotThrow(() => drawExam(layers(25), WPA_PROFILE, seeded(4)));
  });

  it('still refuses a pool too small for the paper', () => {
    assert.throws(() => drawExam(layers(19), WPA_PROFILE, seeded(1)), NotEnoughQuestionsError);
  });

  it('does not repeat a question within one paper', () => {
    const ids = drawExam(layers(40), WPA_PROFILE, seeded(8)).map((e) => e.question.id);

    assert.equal(new Set(ids).size, 20);
  });

  it('passes at the threshold and fails one below it', () => {
    const exam = drawExam(layers(40), WPA_PROFILE, seeded(6));
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
    const exam = drawExam(layers(40), WPA_PROFILE, seeded(9));
    const chosen = new Map<string, Letter | null>(
      exam.map((entry, index) => [entry.question.id, index === 0 ? 'B' : entry.question.correct]),
    );

    const result = gradeExam(exam, chosen, WPA_PROFILE);

    assert.equal(result.score, 19);
    assert.equal(result.passed, true);
    assert.equal(result.failedOnCritical, false);
  });

  it('tops a mistakes pool up to a full paper without demanding critical questions', () => {
    const base = layers(40);
    const result = buildPool([base[0][0], base[0][1]], base, WPA_PROFILE);

    assert.equal(result.length, 1);
    assert.ok(result[0].length >= WPA_PROFILE.questionCount);
    assert.deepEqual(result[0].slice(0, 2).map((q) => q.id), [base[0][0].id, base[0][1].id]);
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

describe('solvingTime', () => {
  it('reports minutes and seconds exactly', () => {
    assert.equal(solvingTime(9 * 60_000), '9:00');
    assert.equal(solvingTime(9 * 60_000 + 20_000), '9:20');
    assert.equal(solvingTime(3 * 60_000 + 5_000), '3:05');
  });

  it('keeps a fast attempt honest instead of rounding it up to a minute', () => {
    // The rounded version had a floor of one minute, so forty seconds became „około 1 min".
    assert.equal(solvingTime(40_000), '0:40');
    assert.equal(solvingTime(0), '0:00');
  });

  it('does not cap at the exam limit', () => {
    // Wall-clock time, and the countdown stops in the background, so an attempt can span
    // more than the limit allows.
    assert.equal(solvingTime(75 * 60_000 + 3_000), '75:03');
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
