import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { DEFAULT_LEVELS, LEVEL_CHOICES } from './leitner';
import { contentBaseSize, levelsLabel, parseLevels } from './settingsValues';

/**
 * These rules sit between the database and the rest of the app, and until now there was no
 * way to test them, since they lived next to an `expo-sqlite` import. They guard something
 * whose effect is far removed from where the bug would show up: a value outside the allowed
 * set throws off the progress counters.
 */
describe('parseLevels', () => {
  it('accepts the values offered in settings', () => {
    for (const choice of LEVEL_CHOICES) {
      assert.equal(parseLevels(String(choice)), choice);
    }
  });

  it('a value outside the allowed set falls back to the default', () => {
    // Bucket zero at one level is simultaneously the bottom and the top, so `deckProgress`
    // would produce a negative count of "learning" questions. This filter is the only thing
    // ruling that out — hence the separate test case for 1.
    for (const value of ['1', '0', '4', '99', '-3']) {
      assert.equal(parseLevels(value), DEFAULT_LEVELS);
    }
  });

  it('a missing entry and garbage from the database both give the default', () => {
    for (const value of [undefined, '', 'trzy', 'NaN', '2.5']) {
      assert.equal(parseLevels(value), DEFAULT_LEVELS);
    }
  });
});

describe('levelsLabel', () => {
  it('counts correct answers, not levels', () => {
    // The label "2 levels" hid the fact that it meant a single correct answer.
    assert.match(levelsLabel(2), /^1 poprawna/);
    assert.match(levelsLabel(3), /^2 poprawne/);
    assert.match(levelsLabel(5), /^4 poprawne/);
  });

  it('does not go below one answer', () => {
    assert.match(levelsLabel(1), /^1 poprawna/);
    assert.match(levelsLabel(0), /^1 poprawna/);
  });
});

describe('contentBaseSize', () => {
  it('gives the base size when the system has no enlargement', () => {
    assert.equal(contentBaseSize(1), 17);
  });

  it('follows the system setting', () => {
    // The one and only text-size control in the app. Every other screen scales itself,
    // since React Native's `Text` multiplies its size by this scale on its own — a WebView
    // doesn't, so the stylesheet gets pre-computed pixels from here.
    assert.equal(contentBaseSize(1.3), 22.1);
    assert.equal(contentBaseSize(2), 34);
  });

  it('a broken value from the system means no enlargement', () => {
    for (const scale of [0, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      assert.equal(contentBaseSize(scale), 17);
    }
  });

  it('the result has at most one decimal place', () => {
    // This number feeds into the materialization version marker: a longer tail would break
    // the comparison and rewrite every lesson to disk on every app start.
    const value = contentBaseSize(1.1111111);
    assert.equal(value, Math.round(value * 10) / 10);
  });
});
