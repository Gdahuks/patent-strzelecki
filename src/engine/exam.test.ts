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
  areaProgress,
  drawExam,
  formatRemaining,
  gradeExam,
  solvingTime,
} from './exam';

const QUESTION_COUNT = PATENT_PROFILE.questionCount;
const CRITICAL_COUNT = criticalCount(PATENT_PROFILE);
const PASS_THRESHOLD = PATENT_PROFILE.passThreshold;

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
 * Pools for the licence profile: one array per band, one pool per source inside it.
 *
 * Ids carry a letter per source, which is how a test can assert "four from the Act and the
 * safety rules, two from each of the rest" without the engine having to report where a drawn
 * question came from.
 */
function pool(letter: string, size: number): Question[] {
  return Array.from({ length: size }, (_, i) => question(`${letter}${i}`));
}

interface Sizes {
  uobia?: number;
  bezpieczenstwo?: number;
  regulaminy?: number;
  budowa?: number;
  karne?: number;
}

function full(sizes: Sizes = {}): Question[][][] {
  return [
    [pool('u', sizes.uobia ?? 20), pool('b', sizes.bezpieczenstwo ?? 20)],
    [pool('r', sizes.regulaminy ?? 20)],
    [pool('d', sizes.budowa ?? 20)],
    [pool('k', sizes.karne ?? 20)],
  ];
}

/** One band with one pool — the police profile's shape. */
function single(size: number): Question[][][] {
  return [[pool('w', size)]];
}

/** Deterministic generator — tests can't depend on Math.random. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Which source a drawn question came from, read back off its id. */
function sourceOf(entry: { question: Question }): string {
  return entry.question.id[0];
}

/** How many of the paper's first four came from the safety rules. */
function safetyInCritical(exam: { question: Question }[]): number {
  return exam.slice(0, CRITICAL_COUNT).filter((entry) => sourceOf(entry) === 'b').length;
}

describe('drawExam', () => {
  it('always draws a full set', () => {
    const exam = drawExam(full(), PATENT_PROFILE, seeded(1));

    assert.equal(exam.length, QUESTION_COUNT);
  });

  it('takes exactly the asked-for count from every band', () => {
    // § 19 ust. 1 for the paper's tail. A flat draw satisfied the total and left whole areas
    // off the sheet.
    const exam = drawExam(full(), PATENT_PROFILE, seeded(7));
    const from = (letter: string) => exam.filter((entry) => sourceOf(entry) === letter).length;

    assert.equal(from('u') + from('b'), 4);
    assert.equal(from('r'), 2);
    assert.equal(from('d'), 2);
    assert.equal(from('k'), 2);
  });

  it('opens the paper with the critical band', () => {
    const exam = drawExam(full(), PATENT_PROFILE, seeded(7));

    for (let i = 0; i < CRITICAL_COUNT; i += 1) {
      assert.equal(exam[i].critical, true);
      assert.ok(['u', 'b'].includes(sourceOf(exam[i])), sourceOf(exam[i]));
    }
    for (let i = CRITICAL_COUNT; i < exam.length; i += 1) {
      assert.equal(exam[i].critical, false);
    }
  });

  it('weights the safety rules into the critical band without ever exceeding two', () => {
    // The whole point of the band: neither absent (as a flat draw made them) nor fixed at two
    // (as the regulation's letter would). Three or four is a state no reading of a real paper
    // produces, so the cap removes it.
    const seen = new Map<number, number>();
    for (let seed = 1; seed <= 400; seed += 1) {
      const count = safetyInCritical(drawExam(full(), PATENT_PROFILE, seeded(seed)));
      seen.set(count, (seen.get(count) ?? 0) + 1);
    }

    assert.deepEqual([...seen.keys()].sort((a, b) => a - b), [0, 1, 2]);
    for (const count of [0, 1, 2]) {
      assert.ok((seen.get(count) ?? 0) > 0, `nigdy nie wypadło ${count}`);
    }
  });

  it('fills the critical band from the Act alone once the safety rules run out', () => {
    // Deterministically: a band whose weighted source is exhausted must finish from the other
    // one, not fail on some seeds and not others.
    const pools = full({ bezpieczenstwo: 0 });

    for (let seed = 1; seed <= 40; seed += 1) {
      const exam = drawExam(pools, PATENT_PROFILE, seeded(seed));
      assert.equal(exam.length, QUESTION_COUNT);
      assert.equal(safetyInCritical(exam), 0);
    }
  });

  it('does not repeat a question within one set', () => {
    const exam = drawExam(full(), PATENT_PROFILE, seeded(3));
    const ids = exam.map((entry) => entry.question.id);

    assert.equal(new Set(ids).size, ids.length);
  });

  it('does not repeat a question that belongs to two areas', () => {
    // 43 questions in the bundle are penal provisions of the Act itself, so they sit in both
    // the first area and the fifth. Without dedup the same question could be asked twice.
    const shared = question('shared');
    const pools = full();
    pools[0][0] = [shared, ...pools[0][0]];
    pools[3][0] = [shared, ...pools[3][0]];

    for (let seed = 1; seed <= 40; seed += 1) {
      const ids = drawExam(pools, PATENT_PROFILE, seeded(seed)).map((e) => e.question.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  });

  it('ignores a question repeated inside one pool', () => {
    // A duplicate would otherwise reach the paper twice, and grading reads answers by
    // question id — so one answer would count for both, decisively so in the critical band.
    const twice = question('u0');
    const pools = full();
    pools[0][0] = [twice, twice, question('u1'), question('u2'), question('u3'), question('u4')];

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

  it('draws the same paper twice from the same seed', () => {
    const first = drawExam(full(), PATENT_PROFILE, seeded(77)).map((e) => e.question.id);
    const second = drawExam(full(), PATENT_PROFILE, seeded(77)).map((e) => e.question.id);

    assert.deepEqual(first, second);
  });

  it('does not leak the band structure into the question order', () => {
    // Band-by-band order would make question seven always a range-rules one, and positions
    // learnable. Both halves of the paper are shuffled, the critical one included — and the
    // critical half needs its own assertion, because the tail alone produces enough variety
    // to keep a whole-paper check green while the safety questions always sit last in it.
    const papers = new Set<string>();
    const heads = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const pattern = drawExam(full(), PATENT_PROFILE, seeded(seed)).map(sourceOf);
      papers.add(pattern.join(''));
      heads.add(pattern.slice(0, CRITICAL_COUNT).join(''));
    }

    assert.ok(papers.size > 1, 'kolejność zagadnień w arkuszu jest stała');
    assert.ok(heads.size > 1, 'kolejność w czwórce krytycznej jest stała');
  });

  it('fails loudly when a band is too thin, naming its area', () => {
    const pools = full({ regulaminy: 1 });

    assert.throws(
      () => drawExam(pools, PATENT_PROFILE, seeded(1)),
      (error: Error) =>
        error instanceof NotEnoughQuestionsError
        && error.category === PATENT_PROFILE.layers[1].sources[0].category,
    );
  });

  it('does not borrow from another band to fill a thin one', () => {
    // Borrowing would keep the paper looking complete while quietly breaking "two from each
    // area" — the promise whose breach is invisible.
    const pools = full({ budowa: 0 });

    assert.throws(() => drawExam(pools, PATENT_PROFILE, seeded(1)), NotEnoughQuestionsError);
  });

  it('draws the police paper as one flat band', () => {
    const exam = drawExam(single(60), WPA_PROFILE, seeded(4));

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
    const missed = latestMisses(history([miss('u1'), miss('d2'), miss('k0')]));

    assert.deepEqual(missed, ['u1', 'd2', 'k0']);

    const bands = buildPool(
      missed.map((id) => question(id)),
      full(),
      PATENT_PROFILE,
    );

    // Every mistake stays in its own area, and the rest of each band is topped up so the
    // paper can still be drawn.
    assert.ok(bands[0][0].some((entry) => entry.id === 'u1'));
    assert.ok(bands[2][0].some((entry) => entry.id === 'd2'));
    assert.ok(bands[3][0].some((entry) => entry.id === 'k0'));
    assert.doesNotThrow(() => drawExam(bands, PATENT_PROFILE, seeded(9)));
  });
});

describe('areaProgress', () => {
  const answer = (questionId: string, wasCorrect: boolean) => ({
    questionId,
    chosen: 'A' as Letter,
    wasCorrect,
    critical: false,
  });

  /** Areas are a partition of the content: one area per question, or none at all. */
  const areas: Record<string, string> = {
    a: 'zg-bezpieczenstwo',
    b: 'zg-bezpieczenstwo',
    c: 'zg-budowa',
    d: 'zg-regulaminy',
    wpa: '',
  };
  const areaOf = (questionId: string) => areas[questionId] || undefined;

  it('counts a question once, however many times it was asked', () => {
    // The area of safety rules holds 24 questions; six of them answered four times each must
    // not read as twenty-four answered once.
    const tally = areaProgress(
      [[answer('a', true)], [answer('a', true)], [answer('a', true)]],
      areaOf,
    );

    assert.deepEqual(tally.get('zg-bezpieczenstwo'), { seen: 1, correct: 1, missed: [] });
  });

  it('takes the latest verdict, so it heals when someone improves', () => {
    // Attempts come newest first. Raw accuracy would keep the old mistake in the average
    // forever; here the newer answer replaces it.
    const tally = areaProgress([[answer('d', true)], [answer('d', false)]], areaOf);

    assert.deepEqual(tally.get('zg-regulaminy'), { seen: 1, correct: 1, missed: [] });
  });

  it('and drops back when the latest answer is wrong again', () => {
    const tally = areaProgress([[answer('d', false)], [answer('d', true)]], areaOf);

    assert.deepEqual(tally.get('zg-regulaminy'), { seen: 1, correct: 0, missed: ['d'] });
  });

  it('keeps the areas apart', () => {
    const tally = areaProgress(
      [[answer('a', true), answer('b', false), answer('c', true)]],
      areaOf,
    );

    assert.deepEqual(tally.get('zg-bezpieczenstwo'), { seen: 2, correct: 1, missed: ['b'] });
    assert.deepEqual(tally.get('zg-budowa'), { seen: 1, correct: 1, missed: [] });
  });

  it('lists exactly the questions behind "seen minus correct"', () => {
    // The invariant the screen rests on: the drill offered next to a row is that row's own
    // mistakes, no more and no fewer. Two counts from two definitions is what put "asked
    // about 11, 2 correct" next to "repeat 16".
    const tally = areaProgress(
      [
        [answer('a', false), answer('b', false)],
        [answer('c', false), answer('d', true)],
      ],
      areaOf,
    );

    for (const [, entry] of tally) {
      assert.equal(entry.missed.length, entry.seen - entry.correct);
    }
    assert.deepEqual(tally.get('zg-bezpieczenstwo')?.missed, ['a', 'b']);
    assert.deepEqual(tally.get('zg-budowa')?.missed, ['c']);
  });

  it('counts every attempt, including papers drawn before the areas existed', () => {
    // Those attempts recorded no area, and none is needed: the area comes from the question.
    // The police list's questions belong to no area, so they are counted nowhere — which is
    // what keeps an old flat-drawn paper from inventing an area for them.
    const tally = areaProgress([[answer('wpa', false), answer('c', false)]], areaOf);

    assert.equal(tally.size, 1);
    assert.deepEqual(tally.get('zg-budowa'), { seen: 1, correct: 0, missed: ['c'] });
  });

  it('gives an empty tally for an empty history', () => {
    assert.equal(areaProgress([], areaOf).size, 0);
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
  const flat = (bands: Question[][][]) => bands.flat(2).map((entry) => entry.id);

  it('keeps every preferred question in its own area', () => {
    const bands = buildPool(preferred('u3', 'k2'), full(), PATENT_PROFILE);

    assert.ok(bands[0][0].some((entry) => entry.id === 'u3'));
    assert.ok(bands[3][0].some((entry) => entry.id === 'k2'));
  });

  it('tops every band up on its own when the mistakes are lopsided', () => {
    // Six mistakes, all from the Act. Topping up globally looked like a full pool and the
    // draw then failed on the band that had nothing — the screen hung on its spinner.
    const lopsided = preferred('u0', 'u1', 'u2', 'u3', 'u4', 'u5');

    const bands = buildPool(lopsided, full(), PATENT_PROFILE);

    assert.doesNotThrow(() => drawExam(bands, PATENT_PROFILE, seeded(13)));
  });

  it('keeps the safety rules drawable even when every mistake is from the Act', () => {
    // Per-band top-up is not enough here: the Act alone could fill all four slots, and the
    // paper would quietly stop asking about safety in the group where a mistake fails it.
    const bands = buildPool(preferred('u0', 'u1', 'u2', 'u3'), full(), PATENT_PROFILE);

    assert.ok(bands[0][1].length >= 2, 'źródło bezpieczeństwa zostało puste');
  });

  it('a single mistake still yields a drawable paper', () => {
    const bands = buildPool(preferred('r7'), full(), PATENT_PROFILE);

    assert.doesNotThrow(() => drawExam(bands, PATENT_PROFILE, seeded(5)));
  });

  it('no mistakes at all yields a drawable paper', () => {
    const bands = buildPool([], full(), PATENT_PROFILE);

    assert.doesNotThrow(() => drawExam(bands, PATENT_PROFILE, seeded(2)));
  });

  it('does not repeat a question inside a pool', () => {
    const bands = buildPool(preferred('r0', 'r0'), full(), PATENT_PROFILE);
    const ids = flat(bands);

    assert.equal(new Set(ids).size, ids.length);
  });

  it('refuses a band it cannot fill, instead of handing back a short pool', () => {
    // Handing back a pool of one for a band that needs two made the *draw* fail — and only
    // for some seeds, so the same mistakes composed a paper on one tap and refused on the
    // next. The refusal belongs here, where the shortage is known, and names the area.
    assert.throws(
      () => buildPool(preferred('u0'), [[[], []], [[]], [[]], [[]]], PATENT_PROFILE),
      (error: Error) =>
        error instanceof NotEnoughQuestionsError
        && error.category === PATENT_PROFILE.layers[0].sources[0].category,
    );
  });

  it('refuses deterministically when a shared question leaves a later band short', () => {
    // Two areas holding the same two questions: every count checks out, and the paper still
    // cannot be composed. Whether it fails must not depend on the seed.
    const shared = [question('s0'), question('s1')];
    const bands = full();
    bands[0][0] = [...shared];
    bands[3][0] = [...shared];

    assert.throws(() => buildPool([], bands, PATENT_PROFILE), NotEnoughQuestionsError);
  });

  it('ignores a mistake that belongs to no area', () => {
    const bands = buildPool(preferred('spoza-warstw'), full(), PATENT_PROFILE);

    assert.ok(!flat(bands).includes('spoza-warstw'));
  });

  it('does not always top up with the same questions', () => {
    // One mistake used to give the same nine companions on every attempt, because the top-up
    // walked the pool in bundle order. The screen promises questions drawn from the area.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const bands = buildPool(preferred('u0'), full(), PATENT_PROFILE, seeded(seed));
      seen.add(bands[1][0].map((entry) => entry.id).join(','));
    }

    assert.ok(seen.size > 1, 'dopełnianie zawsze bierze te same pytania');
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
    const exam = drawExam(single(40), WPA_PROFILE, seeded(2));

    assert.equal(exam.length, 20);
    assert.ok(exam.every((entry) => !entry.critical));
  });

  it('draws from a pool with no critical questions at all', () => {
    // The licence exam would throw here, and that's the trap: a profile without a critical
    // group must not inherit its requirement.
    assert.doesNotThrow(() => drawExam(single(25), WPA_PROFILE, seeded(4)));
  });

  it('still refuses a pool too small for the paper', () => {
    assert.throws(() => drawExam(single(19), WPA_PROFILE, seeded(1)), NotEnoughQuestionsError);
  });

  it('does not repeat a question within one paper', () => {
    const ids = drawExam(single(40), WPA_PROFILE, seeded(8)).map((e) => e.question.id);

    assert.equal(new Set(ids).size, 20);
  });

  it('passes at the threshold and fails one below it', () => {
    const exam = drawExam(single(40), WPA_PROFILE, seeded(6));
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
    const exam = drawExam(single(40), WPA_PROFILE, seeded(9));
    const chosen = new Map<string, Letter | null>(
      exam.map((entry, index) => [entry.question.id, index === 0 ? 'B' : entry.question.correct]),
    );

    const result = gradeExam(exam, chosen, WPA_PROFILE);

    assert.equal(result.score, 19);
    assert.equal(result.passed, true);
    assert.equal(result.failedOnCritical, false);
  });

  it('tops a mistakes pool up to a full paper without demanding critical questions', () => {
    const base = single(40);
    const result = buildPool([base[0][0][0], base[0][0][1]], base, WPA_PROFILE);

    assert.equal(result.length, 1);
    assert.ok(result[0][0].length >= WPA_PROFILE.questionCount);
    assert.deepEqual(
      result[0][0].slice(0, 2).map((q) => q.id),
      [base[0][0][0].id, base[0][0][1].id],
    );
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
