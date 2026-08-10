import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { type Card, createDeck, deckProgress } from './leitner';
import {
  cardLabel,
  cardState,
  groupByState,
  markMastered,
  markNeedsWork,
} from './questionList';

function card(questionId: string, bucket: number, seen: number, correct = seen): Card {
  return { questionId, bucket, seen, correct };
}

describe('cardState', () => {
  it('no row in the database means untouched', () => {
    assert.equal(cardState(undefined, 3), 'untouched');
  });

  it('a zero seen count means untouched, even with a high bucket', () => {
    assert.equal(cardState(card('q', 2, 0, 0), 3), 'untouched');
  });

  it('the top bucket means mastered', () => {
    assert.equal(cardState(card('q', 2, 2), 3), 'mastered');
  });

  it('bucket zero after being shown means needs work', () => {
    assert.equal(cardState(card('q', 0, 3, 1), 3), 'needsWork');
  });

  it('middle buckets mean learning', () => {
    assert.equal(cardState(card('q', 1, 1), 3), 'learning');
  });

  it('with one level, the first hit masters it right away', () => {
    // levels = 1 means "one correct answer masters it", so bucket 0 is already the top one.
    assert.equal(cardState(card('q', 0, 1), 1), 'mastered');
  });
});

describe('groupByState', () => {
  const cards = new Map<string, Card>([
    ['a', card('a', 0, 2, 0)],
    ['b', card('b', 1, 1)],
    ['c', card('c', 2, 2)],
  ]);

  it('keeps a fixed order and skips empty groups', () => {
    const groups = groupByState(['a', 'b', 'c', 'd'], cards, 3);
    assert.deepEqual(
      groups.map((group) => [group.state, group.questionIds]),
      [
        ['needsWork', ['a']],
        ['learning', ['b']],
        ['untouched', ['d']],
        ['mastered', ['c']],
      ],
    );
  });

  it('loses no questions and duplicates none', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const flat = groupByState(ids, cards, 3).flatMap((group) => group.questionIds);
    assert.deepEqual([...flat].sort(), ids);
  });

  it('gives the same numbers as the progress bar', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const progress = deckProgress(createDeck(ids, cards, 3));
    const sizes = new Map(
      groupByState(ids, cards, 3).map((group) => [group.state, group.questionIds.length]),
    );

    assert.equal(sizes.get('needsWork') ?? 0, progress.needsWork);
    assert.equal(sizes.get('learning') ?? 0, progress.learning);
    assert.equal(sizes.get('untouched') ?? 0, progress.untouched);
    assert.equal(sizes.get('mastered') ?? 0, progress.mastered);
  });
});

describe('cardLabel', () => {
  it("says outright that the question hasn't come up yet", () => {
    assert.equal(cardLabel(undefined, 3), 'Jeszcze niepytane');
  });

  it('counts remaining answers, not the bucket number', () => {
    assert.equal(cardLabel(card('q', 0, 2, 1), 3), 'Jeszcze 2 poprawne pod rząd · 1 dobra z 2 odpowiedzi');
    assert.equal(cardLabel(card('q', 1, 6, 4), 3), 'Jeszcze 1 poprawna · 4 dobre z 6 odpowiedzi');
  });

  it('does not append „pod rząd" when only one answer is missing', () => {
    assert.doesNotMatch(cardLabel(card('q', 1, 1), 3), /pod rząd/);
  });

  it('mastered shows just the history, without remaining answers', () => {
    assert.equal(cardLabel(card('q', 2, 4, 3), 3), '3 dobre z 4 odpowiedzi');
  });

  it("a bucket left over from a higher level count doesn't give negative remainders", () => {
    assert.equal(cardLabel(card('q', 4, 5), 3), '5 dobrych z 5 odpowiedzi');
  });

  it('declines the numerals', () => {
    assert.match(cardLabel(card('q', 0, 1, 0), 6), /Jeszcze 5 poprawnych pod rząd/);
    assert.match(cardLabel(card('q', 0, 1, 0), 3), /0 dobrych z 1 odpowiedzi/);
    assert.match(cardLabel(card('q', 2, 3, 2), 3), /2 dobre z 3 odpowiedzi/);
  });
});

describe('manual state change', () => {
  it("mastering pushes the counter off zero, so it doesn't land in two groups", () => {
    const marked = markMastered('q', undefined, 3);
    assert.equal(cardState(marked, 3), 'mastered');
    assert.equal(marked.seen, 1);
    assert.equal(marked.correct, 1);
  });

  it('mastering does not inflate counters that are already higher', () => {
    const marked = markMastered('q', card('q', 0, 9, 5), 3);
    assert.deepEqual(marked, { questionId: 'q', bucket: 2, seen: 9, correct: 5 });
  });

  it('dropping to needs-work zeroes the bucket and leaves the counters', () => {
    const marked = markNeedsWork('q', card('q', 2, 4, 3));
    assert.deepEqual(marked, { questionId: 'q', bucket: 0, seen: 4, correct: 3 });
    assert.equal(cardState(marked, 3), 'needsWork');
  });

  it('dropping an untouched question also shows it as needs work', () => {
    assert.equal(cardState(markNeedsWork('q', undefined), 3), 'needsWork');
  });
});
