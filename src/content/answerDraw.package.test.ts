import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { defaultView, drawAnswers, refersToOtherAnswers } from '../engine/answerDraw';
import type { ContentBundle } from './types';

/**
 * The draw against the real bundle: no question whose correct answer speaks about the other
 * answers ("obie odpowiedzi są poprawne") is ever asked with a pair other than its stable one.
 * In October 2026 one such question had a pool in which 4 of 10 pairs made that answer false.
 */
const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '../../assets/content/content.json');

describe.skipIf(!existsSync(BUNDLE))('drawing answers in the bundle', () => {
  const bundle = JSON.parse(readFileSync(BUNDLE, 'utf8')) as ContentBundle;

  it('keeps the stable pair wherever the correct answer refers to the others', () => {
    const affected = bundle.questions.filter((question) =>
      question.options.some(
        (option) => option.id === question.correctId && refersToOtherAnswers(option.text),
      ),
    );

    for (const question of affected) {
      const view = defaultView(question);
      for (const roll of [0, 0.15, 0.35, 0.55, 0.75, 0.95]) {
        assert.deepEqual(drawAnswers(view, () => roll).answerIds, view.answerIds, question.id);
      }
    }
  });
});
