import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { formatDay } from './dates';

describe('formatDay', () => {
  it('does not roll the date back a day west of Greenwich', () => {
    // `new Date('2026-03-30')` is midnight UTC, i.e. the evening of 29 March in America.
    // The test compares the day, not the whole string, since the separator depends on
    // the environment's ICU.
    const dzien = new Date(2026, 2, 30).toLocaleDateString('pl-PL');
    assert.equal(formatDay('2026-03-30'), dzien);
    assert.ok(dzien.includes('30'));
  });

  it("returns input it doesn't understand", () => {
    assert.equal(formatDay('bez daty'), 'bez daty');
    assert.equal(formatDay(''), '');
  });
});
