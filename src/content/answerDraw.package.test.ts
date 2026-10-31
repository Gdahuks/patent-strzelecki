import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it } from 'vitest';

import { defaultView, drawAnswers, refersToOtherAnswers } from '../engine/answerDraw';
import type { BundleQuestion, ContentBundle } from './types';

/**
 * The draw against the real bundle: no question whose correct answer speaks about the other
 * answers ("obie odpowiedzi są poprawne") is ever asked with a pair other than its stable one.
 * In October 2026 one such question had a pool in which 4 of 10 pairs made that answer false.
 */
const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '../../assets/content/content.json');
const PRESENT = existsSync(BUNDLE);

function correctText(question: BundleQuestion): string {
  return question.options.find((option) => option.id === question.correctId)?.text ?? '';
}

describe.skipIf(!PRESENT)('drawing answers in the bundle', () => {
  let questions: BundleQuestion[];

  beforeAll(() => {
    questions = (JSON.parse(readFileSync(BUNDLE, 'utf8')) as ContentBundle).questions;
  });

  it('keeps the stable pair wherever the correct answer refers to the others', () => {
    for (const question of questions.filter((q) => refersToOtherAnswers(correctText(q)))) {
      const view = defaultView(question);
      for (const roll of [0, 0.15, 0.35, 0.55, 0.75, 0.95]) {
        assert.deepEqual(drawAnswers(view, () => roll).answerIds, view.answerIds, question.id);
      }
    }
  });

  it('recognises every pooled correct answer that mentions the other answers', () => {
    // The rule above picks its questions with the same pattern it tests, so a wording the
    // pattern misses would pass silently. This looks wider: a pooled question whose correct
    // answer so much as mentions "odpowiedzi" or "powyższe" has to be one the rule knows.
    const missed = questions
      .filter((q) => q.options.length > 3 && /odpowiedz|powyższ/i.test(correctText(q)))
      .filter((q) => !refersToOtherAnswers(correctText(q)))
      .map((q) => `${q.id}: ${correctText(q)}`);

    assert.deepEqual(missed, []);
  });
});
