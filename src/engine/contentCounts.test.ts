import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { lessonCount, questionCount, questionCountGenitive, setCount } from './contentCounts';

describe('content counts', () => {
  it('inflects the number of questions instead of fixing the genitive plural', () => {
    assert.equal(questionCount(1), '1 pytanie');
    assert.equal(questionCount(652), '652 pytania');
    assert.equal(questionCount(656), '656 pytań');
    assert.equal(questionCount(612), '612 pytań');
  });

  it('uses the genitive after a noun', () => {
    assert.equal(questionCountGenitive(1), '1 pytania');
    assert.equal(questionCountGenitive(652), '652 pytań');
    assert.equal(questionCountGenitive(656), '656 pytań');
  });

  it('inflects lessons and sets the same way', () => {
    assert.equal(lessonCount(1), '1 lekcja');
    assert.equal(lessonCount(3), '3 lekcje');
    assert.equal(lessonCount(11), '11 lekcji');
    assert.equal(setCount(1), '1 zestaw');
    assert.equal(setCount(2), '2 zestawy');
    assert.equal(setCount(15), '15 zestawów');
  });
});
