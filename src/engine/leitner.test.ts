import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  DEFAULT_LEVELS,
  type Card,
  type DeckState,
  answerCard,
  applyAnswer,
  createDeck,
  deckComplete,
  deckProgress,
  goalBucket,
  newCard,
  nextCard,
  shuffle,
  startRefresh,
  withCards,
} from './leitner';

/** Five levels by default, so the tests see the full bucket ladder. */
const LEVELS = 5;

function deck(ids: string[], levels = LEVELS): DeckState {
  return createDeck(ids, new Map(), levels);
}

describe('answerCard', () => {
  it('advances one bucket on a correct answer', () => {
    const card = answerCard(newCard('q1'), true, LEVELS);

    assert.equal(card.bucket, 1);
    assert.equal(card.seen, 1);
    assert.equal(card.correct, 1);
  });

  it('drops to the very bottom on a wrong answer', () => {
    let card = newCard('q1');
    for (let i = 0; i < 3; i += 1) card = answerCard(card, true, LEVELS);
    assert.equal(card.bucket, 3);

    card = answerCard(card, false, LEVELS);

    assert.equal(card.bucket, 0);
    assert.equal(card.seen, 4);
    assert.equal(card.correct, 3);
  });

  it('does not go above the top bucket', () => {
    let card = newCard('q1');
    for (let i = 0; i < 20; i += 1) card = answerCard(card, true, LEVELS);

    assert.equal(card.bucket, LEVELS - 1);
  });

  it('does not mutate the input card', () => {
    const before = newCard('q1');
    answerCard(before, true, LEVELS);

    assert.equal(before.bucket, 0);
    assert.equal(before.seen, 0);
  });
});

/** Deterministic random numbers, so statistical tests are repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Shown {
  id: string;
  /** Answers since this question was last shown in the run, or null the first time. */
  gap: number | null;
  /** Whether it was below the goal bucket when shown. */
  inPlay: boolean;
}

/** Plays `steps` answers through the engine, the way the practice screen does. */
function play(
  start: DeckState,
  answer: (id: string, step: number) => boolean,
  steps: number,
  random: () => number,
  goal?: number,
): { state: DeckState; shown: Shown[] } {
  let state = start;
  const shown: Shown[] = [];
  const last = new Map<string, number>();
  let avoid: string | null = null;
  const top = goal ?? state.levels - 1;
  for (let step = 0; step < steps; step += 1) {
    const card = nextCard(state, { random, avoid, goal });
    if (!card) throw new Error(`null at step ${step}`);
    const prev = last.get(card.questionId);
    shown.push({
      id: card.questionId,
      gap: prev === undefined ? null : step - prev,
      inPlay: card.bucket < top,
    });
    last.set(card.questionId, step);
    state = applyAnswer(state, card.questionId, answer(card.questionId, step), random);
    avoid = card.questionId;
  }
  return { state, shown };
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `q${i + 1}`);
}

function masteredDeck(count: number, levels = 3): DeckState {
  const known = new Map(
    ids(count).map((id) => [id, { questionId: id, bucket: levels - 1, seen: 2, correct: 2 }]),
  );
  return createDeck(ids(count), known, levels);
}

describe('nextCard', () => {
  it('returns null for an empty deck', () => {
    assert.equal(nextCard(deck([])), null);
  });

  it('returns the only card of a one-card deck, even when it was just asked', () => {
    assert.equal(nextCard(deck(['jedyna']), { avoid: 'jedyna' })?.questionId, 'jedyna');
  });

  it('avoids the question just asked', () => {
    assert.equal(nextCard(deck(['a', 'b']), { random: () => 0, avoid: 'a' })?.questionId, 'b');
  });

  it('never returns null for a non-empty deck', () => {
    const random = seeded(7);
    for (const size of [1, 2, 3, 4, 5, 6]) {
      for (const levels of [2, 3, 4, 5]) {
        assert.doesNotThrow(() => play(deck(ids(size), levels), () => random() < 0.6, 200, random));
      }
    }
  });

  it('does not bring an in-play question back before its gap while another is available', () => {
    const { shown } = play(deck(ids(49), 3), () => false, 30, seeded(1));

    const returns = shown.filter((s) => s.inPlay && s.gap !== null).map((s) => s.gap!);
    assert.ok(returns.length > 0);
    // G = 10 for 49 questions, times the smallest spacing factor.
    assert.ok(Math.min(...returns) >= 8, `returned after ${Math.min(...returns)}`);
  });

  it('introduces a new question with at most 5 other answers in between while new ones remain', () => {
    const known = new Map(
      ids(20).map((id) => [id, { questionId: id, bucket: 0, seen: 1, correct: 0 }]),
    );
    const { shown } = play(createDeck(ids(49), known, 3), () => false, 200, seeded(2));

    const fresh = new Set(ids(49).slice(20));
    const newAt = shown.flatMap((s, i) => (fresh.has(s.id) && s.gap === null ? [i] : []));
    assert.equal(newAt.length, 29);
    for (let i = 1; i < newAt.length; i += 1) assert.ok(newAt[i] - newAt[i - 1] <= 6);
  });

  it('shrinks the gap at the end of learning, but not below 4', () => {
    const known = new Map(
      ids(49).map((id, i) => [
        id,
        i < 2
          ? { questionId: id, bucket: 0, seen: 1, correct: 0 }
          : { questionId: id, bucket: 2, seen: 2, correct: 2 },
      ]),
    );
    const hard = new Set(['q1', 'q2']);
    const { shown } = play(createDeck(ids(49), known, 3), (id) => !hard.has(id), 60, seeded(3));

    const returns = shown.filter((s) => hard.has(s.id) && s.gap !== null).map((s) => s.gap!);
    assert.ok(Math.min(...returns) >= 4);
    // Without shrinking, G = 10 would keep them away for at least 8.
    assert.ok(Math.max(...returns) < 8);
  });

  it('does not shrink the gap in refresh', () => {
    const start = startRefresh(masteredDeck(49));
    let missed: string | null = null;
    const { shown } = play(
      start,
      (id) => {
        if (missed === null) missed = id;
        return id !== missed;
      },
      80,
      seeded(4),
    );

    const returns = shown.filter((s) => s.id === missed && s.gap !== null).map((s) => s.gap!);
    assert.ok(returns.length > 0);
    assert.ok(Math.min(...returns) >= 8, `returned after ${Math.min(...returns)}`);
  });

  it('refresh shows every question once before any repeats, on entry to a mastered set', () => {
    const { shown } = play(startRefresh(masteredDeck(49)), () => true, 49, seeded(5));

    assert.equal(new Set(shown.map((s) => s.id)).size, 49);
  });

  it('refresh shows every question once before any repeats, right after mastering in the same entry', () => {
    const random = seeded(6);
    let state = deck(ids(49), 3);
    let avoid: string | null = null;
    while (!deckComplete(state, false)) {
      const card: Card = nextCard(state, { random, avoid })!;
      state = applyAnswer(state, card.questionId, true, random);
      avoid = card.questionId;
    }

    const { shown } = play(startRefresh(state), () => true, 49, random);

    assert.equal(new Set(shown.map((s) => s.id)).size, 49);
  });

  it('does not repeat a mastered question within 3 at a lap boundary', () => {
    const { shown } = play(startRefresh(masteredDeck(6)), () => true, 300, seeded(8));

    const gaps = shown.filter((s) => s.gap !== null).map((s) => s.gap!);
    assert.ok(Math.min(...gaps) >= 4, `repeated after ${Math.min(...gaps)}`);
  });

  it('a review of mastered material skips a freshly mastered question', () => {
    const known = new Map([['x', { questionId: 'x', bucket: 2, seen: 2, correct: 2 }]]);
    const base = createDeck(['x', ...ids(48)], known, 3);
    const at = (answeredAt: Map<string, number>): DeckState => ({
      ...base,
      counter: 9,
      session: { ...base.session, answeredAt, lastNewAt: 9 },
    });

    // Answered two answers ago: not rested, so the review slot goes to someone else.
    assert.notEqual(nextCard(at(new Map([['x', 7]])), { random: () => 0 })?.questionId, 'x');
    // Not seen in this entry: rested, and the ninth answer is its turn.
    assert.equal(nextCard(at(new Map()), { random: () => 0 })?.questionId, 'x');
  });

  it('treats the goal bucket as mastered in the mistakes set', () => {
    const known = new Map([
      ['a', { questionId: 'a', bucket: 1, seen: 2, correct: 1 }],
      ['b', { questionId: 'b', bucket: 0, seen: 1, correct: 0 }],
      ['c', { questionId: 'c', bucket: 0, seen: 1, correct: 0 }],
    ]);
    const base = createDeck(['a', 'b', 'c'], known, 3);
    const state: DeckState = {
      ...base,
      counter: 20,
      session: { ...base.session, answeredAt: new Map([['b', 10], ['c', 19]]) },
    };

    // Bucket one is the goal: 'a' is done, and the due mistake 'b' comes first.
    assert.equal(nextCard(state, { random: () => 0, goal: 1 })?.questionId, 'b');
    // Without that goal 'a' is still in play and, unseen in this entry, the most overdue.
    assert.equal(nextCard(state, { random: () => 0 })?.questionId, 'a');
  });

  it('statistical: no return within 3 for a simple learner, and mastery in under 400 answers', () => {
    for (const seed of [11, 12, 13]) {
      const random = seeded(seed);
      const knowledge = new Map(ids(49).map((id) => [id, 0.55]));
      let state = deck(ids(49), 3);
      let avoid: string | null = null;
      const last = new Map<string, number>();
      let short = 0;
      let answers = 0;
      while (!deckComplete(state, false) && answers < 3000) {
        const card: Card = nextCard(state, { random, avoid })!;
        const prev = last.get(card.questionId);
        if (card.bucket < 2 && prev !== undefined && answers - prev <= 3) short += 1;
        last.set(card.questionId, answers);
        const p = knowledge.get(card.questionId)!;
        state = applyAnswer(state, card.questionId, random() < p, random);
        knowledge.set(card.questionId, p + 0.25 * (1 - p));
        avoid = card.questionId;
        answers += 1;
      }

      assert.equal(short, 0, `seed ${seed}`);
      assert.ok(answers < 400, `seed ${seed}: ${answers} answers`);
    }
  });
});

describe('applyAnswer', () => {
  it('touches only the named card', () => {
    const state = applyAnswer(deck(['a', 'b']), 'a', true);

    assert.equal(state.cards.find((c) => c.questionId === 'a')?.bucket, 1);
    assert.equal(state.cards.find((c) => c.questionId === 'b')?.bucket, 0);
  });

  it('increments the answer counter', () => {
    const state = applyAnswer(applyAnswer(deck(['a']), 'a', true), 'a', false);

    assert.equal(state.counter, 2);
  });

  it('ignores an unknown question instead of crashing', () => {
    const state = applyAnswer(deck(['a']), 'nieznane', true);

    assert.equal(state.cards.length, 1);
    assert.equal(state.cards[0].bucket, 0);
  });
});

describe('createDeck', () => {
  it('restores saved progress', () => {
    const known = new Map([['a', { questionId: 'a', bucket: 3, seen: 7, correct: 5 }]]);

    const state = createDeck(['a', 'b'], known, LEVELS);

    assert.equal(state.cards[0].bucket, 3);
    assert.equal(state.cards[1].bucket, 0);
  });

  it('skips saved progress for questions outside the deck', () => {
    const known = new Map([['usuniete', { questionId: 'usuniete', bucket: 4, seen: 9, correct: 9 }]]);

    const state = createDeck(['a'], known, LEVELS);

    assert.equal(state.cards.length, 1);
    assert.equal(state.cards[0].questionId, 'a');
  });
});

describe('a wrong answer goes back for rework', () => {
  it('drops the question to the bottom and puts it ahead of mastered material', () => {
    let state = deck(['a', 'b']);
    // 'a' climbs to the top, 'b' ends up answered wrong.
    for (let i = 0; i < LEVELS - 1; i += 1) state = applyAnswer(state, 'a', true);
    state = applyAnswer(state, 'b', true);
    state = applyAnswer(state, 'b', false);

    assert.equal(state.cards.find((c) => c.questionId === 'b')?.bucket, 0);
    // Next time the set is opened, the mistake comes back before mastered material.
    const reopened = createDeck(['a', 'b'], new Map(state.cards.map((c) => [c.questionId, c])), LEVELS);
    assert.equal(nextCard(reopened, { random: () => 0 })?.questionId, 'b');
  });

  it("doesn't let a deck count as mastered with a mistake in the middle", () => {
    let state = deck(['a', 'b']);
    for (let i = 0; i < LEVELS - 1; i += 1) state = applyAnswer(state, 'a', true);
    for (let i = 0; i < LEVELS - 1; i += 1) state = applyAnswer(state, 'b', true);
    assert.equal(deckProgress(state).mastered, 2);

    state = applyAnswer(state, 'b', false);

    // The "zestaw opanowany" screen relies on this condition, so a mistake has to reverse it.
    assert.notEqual(deckProgress(state).mastered, deckProgress(state).total);
  });

  it('returns to the top only after a full run of correct answers', () => {
    let state = deck(['a']);
    state = applyAnswer(state, 'a', false);

    for (let i = 0; i < LEVELS - 1; i += 1) {
      assert.notEqual(deckProgress(state).mastered, 1);
      state = applyAnswer(state, 'a', true);
    }

    assert.equal(deckProgress(state).mastered, 1);
  });
});

describe('deckProgress', () => {
  it('counts an empty deck without dividing by zero', () => {
    const progress = deckProgress(deck([]));

    assert.equal(progress.total, 0);
    assert.equal(progress.ratio, 0);
    assert.equal(progress.clearedRatio, 0);
  });

  it('the four groups sum to the whole deck', () => {
    // Without this, the counter at the bottom of the screen couldn't add up: buckets one
    // through three had nowhere to appear.
    let state = deck(['a', 'b', 'c', 'd', 'e']);
    state = applyAnswer(state, 'a', false);
    state = applyAnswer(state, 'b', true);
    state = applyAnswer(state, 'c', true);
    state = applyAnswer(state, 'c', true);
    for (let i = 0; i < LEVELS - 1; i += 1) state = applyAnswer(state, 'd', true);

    const p = deckProgress(state);

    assert.equal(p.untouched + p.needsWork + p.learning + p.mastered, p.total);
    assert.equal(p.needsWork, 1); // 'a'
    assert.equal(p.learning, 2); // 'b', 'c'
    assert.equal(p.mastered, 1); // 'd'
    assert.equal(p.untouched, 1); // 'e'
  });

  it('the share cleared from bucket zero measures the mistakes-set goal', () => {
    // The mistakes-set screen closes once bucket zero empties out. The counter used to
    // show 25% at that point, because it measured progress toward full mastery.
    let state = deck(['a', 'b']);
    state = applyAnswer(state, 'a', true);
    state = applyAnswer(state, 'b', true);

    const p = deckProgress(state);

    assert.equal(p.clearedRatio, 1);
    assert.equal(p.ratio, 0.25);
  });

  it('measures the path to mastery by bucket weight, not the plain share mastered', () => {
    // A question with one good answer counts as 1, a mastered one as LEVELS - 1:
    // (1 + 4) / (4 * 4) with five levels in this file. The weighting is intentional — the
    // counter is meant to move after every good answer, not only once a question is
    // mastered.
    let state = deck(['a', 'b', 'c', 'd']);
    state = applyAnswer(state, 'a', true);
    for (let i = 0; i < LEVELS - 1; i += 1) state = applyAnswer(state, 'b', true);

    const progress = deckProgress(state);

    assert.equal(progress.learning, 1);
    assert.equal(progress.mastered, 1);
    assert.equal(progress.ratio, 0.3125);
    assert.notEqual(progress.ratio, progress.mastered / progress.total);
  });

  it('gives zero for an untouched deck', () => {
    const progress = deckProgress(deck(['a', 'b', 'c']));

    assert.equal(progress.ratio, 0);
    assert.equal(progress.untouched, 3);
    assert.equal(progress.mastered, 0);
  });

  it('gives one for a fully mastered deck', () => {
    let state = deck(['a']);
    for (let i = 0; i < LEVELS - 1; i += 1) state = applyAnswer(state, 'a', true);

    const progress = deckProgress(state);

    assert.equal(progress.ratio, 1);
    assert.equal(progress.mastered, 1);
    assert.equal(progress.untouched, 0);
  });
});

describe('shuffle', () => {
  it('keeps every element', () => {
    const result = shuffle(['A', 'B', 'C'], () => 0.5);

    assert.deepEqual([...result].sort(), ['A', 'B', 'C']);
  });

  it('does not touch the input', () => {
    const input = ['A', 'B', 'C'];
    shuffle(input, () => 0.1);

    assert.deepEqual(input, ['A', 'B', 'C']);
  });
});

describe('number of levels', () => {
  it('defaults to three levels, i.e. two correct answers to master', () => {
    let state = deck(['a'], DEFAULT_LEVELS);
    state = applyAnswer(state, 'a', true);

    assert.equal(deckProgress(state).mastered, 0);

    state = applyAnswer(state, 'a', true);

    assert.equal(deckProgress(state).mastered, 1);
  });

  it('two levels master after one correct answer', () => {
    const state = applyAnswer(deck(['a'], 2), 'a', true);

    assert.equal(deckProgress(state).mastered, 1);
  });

  it('does not advance past the top of the chosen level count', () => {
    let state = deck(['a'], 2);
    for (let i = 0; i < 8; i += 1) state = applyAnswer(state, 'a', true);

    assert.equal(state.cards[0].bucket, 1);
  });

  it('clamps saved progress after the level count is lowered', () => {
    // A bucket of 4 saved under five levels can't survive when the top is now 2.
    const known = new Map([['a', { questionId: 'a', bucket: 4, seen: 9, correct: 9 }]]);

    const state = createDeck(['a'], known, DEFAULT_LEVELS);

    assert.equal(state.cards[0].bucket, DEFAULT_LEVELS - 1);
    assert.equal(deckProgress(state).mastered, 1);
  });

  it('a mistake still drops to the very bottom, regardless of the level count', () => {
    for (const levels of [2, 3, 5]) {
      let state = deck(['a'], levels);
      for (let i = 0; i < levels; i += 1) state = applyAnswer(state, 'a', true);
      state = applyAnswer(state, 'a', false);

      assert.equal(state.cards[0].bucket, 0);
    }
  });

  it('the answer counter survives a change to the deck state', () => {
    // applyAnswer has to preserve levels — otherwise the next call would compute the top
    // from the default value.
    const state = applyAnswer(deck(['a'], 5), 'a', true);

    assert.equal(state.levels, 5);
  });
});

describe('session memory', () => {
  it('createDeck starts with empty memory and refresh off', () => {
    const state = deck(['a', 'b']);

    assert.equal(state.session.answeredAt.size, 0);
    assert.equal(state.session.spacing.size, 0);
    assert.equal(state.session.lap.size, 0);
    assert.equal(state.session.lastNewAt, 0);
    assert.equal(state.refresh, false);
  });

  it('applyAnswer records when the question was answered', () => {
    let state = deck(['q1', 'q2']);
    state = applyAnswer(state, 'q1', true);
    state = applyAnswer(state, 'q2', false);
    state = applyAnswer(state, 'q1', true);

    assert.equal(state.session.answeredAt.get('q1'), 2);
    assert.equal(state.session.answeredAt.get('q2'), 1);
    assert.equal(state.counter, 3);
  });

  it('applyAnswer draws the spacing factor from the injected random', () => {
    const low = applyAnswer(deck(['a']), 'a', true, () => 0);
    const high = applyAnswer(deck(['a']), 'a', true, () => 0.9999);

    assert.equal(low.session.spacing.get('a'), 0.8);
    assert.ok(high.session.spacing.get('a')! > 1.39);
    assert.ok(high.session.spacing.get('a')! < 1.4);
  });

  it('applyAnswer moves lastNewAt only for a never-seen question', () => {
    let state = applyAnswer(deck(['a', 'b']), 'a', true);
    assert.equal(state.session.lastNewAt, 1);

    state = applyAnswer(state, 'a', true);
    assert.equal(state.session.lastNewAt, 1);

    state = applyAnswer(state, 'b', false);
    assert.equal(state.session.lastNewAt, 3);
  });

  it('applyAnswer adds to the lap and does not mutate the input state', () => {
    const before = deck(['a', 'b']);
    const after = applyAnswer(before, 'a', true);

    assert.ok(after.session.lap.has('a'));
    assert.equal(before.session.lap.size, 0);
    assert.equal(before.session.answeredAt.size, 0);
    assert.equal(before.counter, 0);
  });

  it('applyAnswer starts a new lap once every question is in it', () => {
    let state = deck(['q1', 'q2', 'q3']);
    state = applyAnswer(state, 'q1', true);
    state = applyAnswer(state, 'q2', true);
    state = applyAnswer(state, 'q3', true);

    assert.deepEqual([...state.session.lap], ['q3']);
  });

  it('withCards keeps session, counter and refresh', () => {
    let state = applyAnswer(deck(['a', 'b'], 3), 'a', true);
    state = startRefresh(state);
    const known = new Map([['b', { questionId: 'b', bucket: 2, seen: 2, correct: 2 }]]);

    const reloaded = withCards(state, createDeck(['a', 'b'], known, 3).cards);

    assert.equal(reloaded.session, state.session);
    assert.equal(reloaded.counter, state.counter);
    assert.equal(reloaded.refresh, true);
    assert.equal(reloaded.cards.find((c) => c.questionId === 'b')?.bucket, 2);
  });

  it('startRefresh turns refresh on and clears the lap, keeping answeredAt and counter', () => {
    const answered = applyAnswer(deck(['a', 'b']), 'a', true);

    const state = startRefresh(answered);

    assert.equal(state.refresh, true);
    assert.equal(state.session.lap.size, 0);
    assert.equal(state.session.answeredAt.get('a'), 0);
    assert.equal(state.counter, 1);
  });

  it('goalBucket is the top bucket, or bucket one for the mistakes set', () => {
    assert.equal(goalBucket(3, false), 2);
    assert.equal(goalBucket(5, false), 4);
    assert.equal(goalBucket(3, true), 1);
  });

  it('deckComplete follows the set goal and stays false while refreshing', () => {
    let mastered = deck(['a', 'b'], 3);
    for (const id of ['a', 'a', 'b', 'b']) mastered = applyAnswer(mastered, id, true);

    assert.equal(deckComplete(mastered, false), true);
    assert.equal(deckComplete(startRefresh(mastered), false), false);
    assert.equal(deckComplete(deck([], 3), false), false);

    const known = new Map([
      ['a', { questionId: 'a', bucket: 1, seen: 2, correct: 1 }],
      ['b', { questionId: 'b', bucket: 0, seen: 1, correct: 0 }],
    ]);
    const weak = createDeck(['a', 'b'], known, 3);
    assert.equal(deckComplete(weak, true), false);
    assert.equal(deckComplete(applyAnswer(weak, 'b', true), true), true);
  });
});
