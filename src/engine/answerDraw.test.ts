import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { BundleQuestion, Letter } from '../content/types';
import { defaultView, drawAnswers, refersToOtherAnswers } from './answerDraw';

const POOLED: BundleQuestion = {
  id: 'q',
  question: 'Pytanie z pulą',
  options: [
    { id: 'q_1', text: 'zła jeden' },
    { id: 'q_2', text: 'dobra' },
    { id: 'q_3', text: 'zła trzy' },
    { id: 'q_4', text: 'zła cztery' },
  ],
  correctId: 'q_2',
  law: 'UoBiA art. 1',
  lesson: 'uobia',
};

const FIXED: BundleQuestion = { ...POOLED, options: POOLED.options.slice(0, 3) };

/** A deterministic source of "random" numbers, cycling through the given values. */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

function wrong(view: ReturnType<typeof defaultView>): string[] {
  return (Object.keys(view.answers) as Letter[])
    .filter((letter) => letter !== view.correct)
    .map((letter) => view.answers[letter] as string);
}

describe('the default view', () => {
  it('shows the correct answer and the first two wrong ones, by id', () => {
    const view = defaultView(POOLED);

    assert.deepEqual(view.answers, { A: 'zła jeden', B: 'dobra', C: 'zła trzy' });
    assert.equal(view.correct, 'B');
    assert.deepEqual(view.answerIds, { A: 'q_1', B: 'q_2', C: 'q_3' });
  });

  it('keeps the whole pool for later draws', () => {
    assert.equal(defaultView(POOLED).options?.length, 4);
    assert.equal(defaultView(POOLED).correctId, 'q_2');
  });
});

describe('drawing the shown answers', () => {
  it('always has three answers, one of them correct', () => {
    for (const roll of [0, 0.3, 0.6, 0.99]) {
      const view = drawAnswers(defaultView(POOLED), sequence(roll, 1 - roll));

      assert.equal(Object.keys(view.answers).length, 3);
      assert.equal(view.answers[view.correct], 'dobra');
      assert.equal(view.answerIds?.[view.correct], 'q_2');
    }
  });

  it('reaches every wrong answer of the pool', () => {
    const seen = new Set<string>();
    for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      for (const text of wrong(drawAnswers(defaultView(POOLED), sequence(roll)))) seen.add(text);
    }

    assert.deepEqual([...seen].sort(), ['zła cztery', 'zła jeden', 'zła trzy']);
  });

  it('letters and ids describe the same answers', () => {
    const view = drawAnswers(defaultView(POOLED), sequence(0.7, 0.1));
    const byId = new Map(POOLED.options.map((option) => [option.id, option.text]));

    for (const letter of Object.keys(view.answers) as Letter[]) {
      assert.equal(view.answers[letter], byId.get(view.answerIds?.[letter] ?? ''));
    }
  });

  it('a question without a pool is shown as it is', () => {
    const view = defaultView(FIXED);

    assert.equal(drawAnswers(view, sequence(0.5)), view);
  });

  it('a correct answer about the other answers keeps the stable pair', () => {
    // "Both answers are correct" is true or false depending on which two it sits next to,
    // so drawing a different pair can turn the key into a lie.
    const both: BundleQuestion = {
      ...POOLED,
      options: [{ id: 'q_0', text: 'obie odpowiedzi są poprawne' }, ...POOLED.options],
      correctId: 'q_0',
    };
    const view = defaultView(both);

    for (const roll of [0, 0.3, 0.6, 0.99]) {
      assert.equal(drawAnswers(view, sequence(roll, 1 - roll)), view);
    }
  });

  it('tells such an answer by what it says, not by its first word', () => {
    for (const text of [
      'Obie odpowiedzi są prawidłowe',
      'obydwie odpowiedzi są prawidłowe',
      'obie odpowiedzi są błędne',
      'żadna z odpowiedzi nie jest poprawna',
      'wszystkie odpowiedzi są poprawne',
      'obie powyższe odpowiedzi są poprawne',
      'żadna z powyższych',
      'wszystkie powyższe',
      'odpowiedzi A i B są poprawne',
    ]) {
      assert.equal(refersToOtherAnswers(text), true, text);
    }
    for (const text of ['wszystkie naboje, bez względu na ich przeznaczenie', 'dobra']) {
      assert.equal(refersToOtherAnswers(text), false, text);
    }
  });

  it('such an answer among the wrong ones does not stop the draw', () => {
    const withMeta: BundleQuestion = {
      ...POOLED,
      options: [...POOLED.options, { id: 'q_5', text: 'obie odpowiedzi są błędne' }],
    };
    const seen = new Set<string>();
    for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      for (const text of wrong(drawAnswers(defaultView(withMeta), sequence(roll)))) seen.add(text);
    }

    assert.equal(seen.size, 4);
  });

  it('a hand-written question without pool fields is left alone', () => {
    const literal = { ...defaultView(FIXED), options: undefined, answerIds: undefined };

    assert.equal(drawAnswers(literal, sequence(0.5)), literal);
  });
});
