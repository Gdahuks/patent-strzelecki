import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  DEFAULT_LEVELS,
  type DeckState,
  answerCard,
  applyAnswer,
  createDeck,
  deckProgress,
  newCard,
  nextCard,
  pickBucket,
  shuffle,
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

describe('pickBucket', () => {
  it('returns null for an empty deck', () => {
    assert.equal(pickBucket(deck([])), null);
  });

  it('starts from the lowest bucket', () => {
    assert.equal(pickBucket(deck(['a', 'b'])), 0);
  });

  it('skips empty buckets', () => {
    let state = deck(['a']);
    state = applyAnswer(state, 'a', true);
    state = { ...state, counter: 0 };

    assert.equal(pickBucket(state), 1);
  });

  it('checks a higher bucket once its interval is up', () => {
    let state = deck(['a', 'b']);
    state = applyAnswer(state, 'a', true);
    state = applyAnswer(state, 'a', true);

    // 'a' is in bucket 2, 'b' is still in bucket zero; bucket 2's interval is every 9 answers.
    assert.equal(pickBucket({ ...state, counter: 9 }), 2);
    assert.equal(pickBucket({ ...state, counter: 10 }), 0);
  });
});

describe('nextCard', () => {
  it('returns null for an empty deck', () => {
    assert.equal(nextCard(deck([])), null);
  });

  it('picks a card from the chosen bucket', () => {
    let state = deck(['a', 'b', 'c']);
    state = applyAnswer(state, 'a', true);

    const card = nextCard({ ...state, counter: 0 }, () => 0);

    assert.ok(card);
    assert.equal(card.bucket, 0);
    assert.notEqual(card.questionId, 'a');
  });

  it('sticks with the only remaining card', () => {
    const card = nextCard(deck(['jedyna']), () => 0.99);

    assert.equal(card?.questionId, 'jedyna');
  });

  it('avoids the question just asked', () => {
    // In a small deck, the same question used to fire several times in a row, which with
    // four advances needed to master a card looked like the app had frozen.
    const state = deck(['a', 'b']);

    for (const r of [0, 0.4, 0.9]) {
      assert.equal(nextCard(state, () => r, 'a')?.questionId, 'b');
      assert.equal(nextCard(state, () => r, 'b')?.questionId, 'a');
    }
  });

  it('reaches into another bucket when the chosen one only has the last one left', () => {
    let state = deck(['a', 'b']);
    state = applyAnswer(state, 'b', true); // 'b' moves up, 'a' stays in bucket zero

    assert.equal(nextCard({ ...state, counter: 0 }, () => 0, 'a')?.questionId, 'b');
  });

  it('returns the same card when the deck has only one', () => {
    // Nothing to interleave with — better to repeat than to show nothing.
    assert.equal(nextCard(deck(['jedyna']), () => 0, 'jedyna')?.questionId, 'jedyna');
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
    // 'a' climbs high, 'b' ends up answered wrong.
    for (let i = 0; i < 3; i += 1) state = applyAnswer(state, 'a', true);
    state = applyAnswer(state, 'b', true);
    state = applyAnswer(state, 'b', false);

    assert.equal(state.cards.find((c) => c.questionId === 'b')?.bucket, 0);
    assert.equal(nextCard({ ...state, counter: 0 }, () => 0)?.questionId, 'b');
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
