import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { BundleQuestion } from '../content/types';
import { defaultView } from './answerDraw';
import { questionSheet } from './questionSheet';

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
  law: '',
  lesson: '',
};

function texts(options: readonly { text: string }[]): string[] {
  return options.map((option) => option.text);
}

describe('the question sheet', () => {
  it('puts the correct answer first and every wrong one of the pool below it', () => {
    const sheet = questionSheet(defaultView(POOLED));

    assert.equal(sheet.correct.text, 'dobra');
    assert.deepEqual(texts(sheet.wrong), ['zła jeden', 'zła trzy', 'zła cztery']);
    assert.deepEqual(sheet.referred, []);
  });

  /** A pooled question whose correct answer is `key`, with four statements beside it. */
  function about(key: string): BundleQuestion {
    return {
      ...POOLED,
      options: [
        { id: 'q_0', text: key },
        { id: 'q_1', text: 'stwierdzenie jeden' },
        { id: 'q_2', text: 'stwierdzenie dwa' },
        { id: 'q_3', text: 'stwierdzenie trzy' },
        { id: 'q_4', text: 'stwierdzenie cztery' },
      ],
      correctId: 'q_0',
    };
  }

  it('shows the answers "obie odpowiedzi…" speaks about, unmarked, and nothing else', () => {
    // Under a correct "both answers are correct", the two statements it refers to are true —
    // listing them as wrong answers would contradict the key. The rest of the pool is left
    // out: "both" means the two the question is asked with.
    const sheet = questionSheet(defaultView(about('obie odpowiedzi są poprawne')));

    assert.equal(sheet.correct.text, 'obie odpowiedzi są poprawne');
    assert.deepEqual(texts(sheet.referred), ['stwierdzenie jeden', 'stwierdzenie dwa']);
    assert.deepEqual(sheet.wrong, []);
  });

  it('lays out "obie odpowiedzi są błędne" the same way', () => {
    // Here both statements are false, but the key already says so; the layout doesn't depend
    // on which way the key goes.
    const sheet = questionSheet(defaultView(about('obie odpowiedzi są błędne')));

    assert.equal(sheet.correct.text, 'obie odpowiedzi są błędne');
    assert.deepEqual(texts(sheet.referred), ['stwierdzenie jeden', 'stwierdzenie dwa']);
    assert.deepEqual(sheet.wrong, []);
  });

  it('works on a question without a pool', () => {
    const fixed: BundleQuestion = { ...POOLED, options: POOLED.options.slice(0, 3) };
    const sheet = questionSheet(defaultView(fixed));

    assert.equal(sheet.correct.text, 'dobra');
    assert.deepEqual(texts(sheet.wrong), ['zła jeden', 'zła trzy']);
  });
});
