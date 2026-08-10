import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  ACT_KEY_PREFIX,
  READ_THRESHOLD,
  type Reading,
  isLessonKey,
  readingLabel,
  resumePosition,
} from './readingProgress';

function reading(position: number, state: Reading['state'] = 'started'): Reading {
  return { position, state };
}

describe('resumePosition', () => {
  it('an untouched lesson starts from the beginning', () => {
    assert.equal(resumePosition(null), 0);
    assert.equal(resumePosition(undefined), 0);
  });

  it('returns to where it left off', () => {
    assert.equal(resumePosition(reading(0.42)), 0.42);
  });

  it('a lesson marked read opens from the beginning', () => {
    // A re-read starts over; returning to the last paragraph gains nothing.
    assert.equal(resumePosition(reading(1, 'read')), 0);
    assert.equal(resumePosition(reading(0.98, 'read')), 0);
  });

  it('manually unmarking read does not return to the end', () => {
    // Un-marking leaves a high position behind, but since the user is saying they haven't
    // read it, we open from the top.
    assert.equal(resumePosition(reading(0.99)), 0);
    assert.equal(resumePosition(reading(READ_THRESHOLD)), 0);
  });

  it('just below the threshold still returns to the reading position', () => {
    const almost = READ_THRESHOLD - 0.01;

    assert.equal(resumePosition(reading(almost)), almost);
  });
});

describe('isLessonKey', () => {
  it('a lesson slug is a lesson key', () => {
    assert.equal(isLessonKey('bezpieczenstwo'), true);
    assert.equal(isLessonKey('uobia'), true);
  });

  it('a legal act key is not a lesson key', () => {
    // This is the crux of it: without this, a scrolled-through act counted as a read lesson.
    assert.equal(isLessonKey(`${ACT_KEY_PREFIX}uobia`), false);
    assert.equal(isLessonKey(`${ACT_KEY_PREFIX}rozporzadzenie-noszenie`), false);
  });

  it('does not confuse a lesson slug that starts similarly', () => {
    // Splits on the prefix with its colon, not on the bare word „akt" at the start of a name.
    assert.equal(isLessonKey('aktualizacje'), true);
    assert.equal(isLessonKey('akt'), true);
  });
});

describe('readingLabel', () => {
  it('stays silent for an untouched lesson', () => {
    assert.equal(readingLabel(undefined), null);
  });

  it('names the read state', () => {
    assert.equal(readingLabel(reading(1, 'read')), 'przeczytane');
  });

  it('shows progress as a percentage', () => {
    assert.equal(readingLabel(reading(0.45)), 'w trakcie · 45%');
  });

  it('names a barely-started lesson as started, without showing zero percent', () => {
    assert.equal(readingLabel(reading(0.01)), 'zaczęte');
  });
});
