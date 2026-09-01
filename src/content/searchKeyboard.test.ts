import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

/**
 * Arriving from a search result must not raise the keyboard.
 *
 * The phrase is typed, so the keyboard is up when the result is tapped — and the screen it
 * opens used to put it straight back: a phrase in `?q=` opens the in-page find bar, and the
 * bar's field took focus unconditionally. The keyboard then covered the lower part of the very
 * passage the reader opened the result to see. Focus now depends on who opened the bar: the
 * magnifier (empty field, nothing to do but type) or a phrase from search (already filled in,
 * hits already highlighted).
 *
 * These tests guard the shape rather than the behaviour: the screens and `FindBar` pull in
 * React Native, whose Flow syntax vitest can't parse, so they read the source as plain text —
 * the same boundary `pressableRoles.test.ts` keeps.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

describe('the in-page find bar', () => {
  const bar = read('src', 'components', 'FindBar.tsx');

  it('does not focus its field unconditionally', () => {
    assert.doesNotMatch(
      bar,
      /^\s*autoFocus\s*$/m,
      'a bare autoFocus raises the keyboard even when the bar was opened by a search hit',
    );
    assert.match(bar, /autoFocus=\{autoFocus\}/);
  });

  it('focuses only when it opens with nothing in the field', () => {
    assert.match(bar, /useState\(initialQuery\.length === 0\)/);
  });

  it('is given the flag by both screens that host it', () => {
    for (const screen of [
      join('app', 'act', '[slug].tsx'),
      join('app', 'learn', '[slug].tsx'),
    ]) {
      assert.match(read(screen), /autoFocus=\{find\.focusOnOpen\}/, `${screen} drops the flag`);
    }
  });
});

describe('the search screen', () => {
  const source = read('app', 'search.tsx');

  // A belt for the results that open no find bar at all — a lesson matched on its title has no
  // hits to step through, so it opens without `?q=` and nothing there would take the keyboard
  // down. Routing every exit through one helper is also what stops a fourth one from arriving
  // without it; there were three call sites to change for this one fix.
  it('dismisses the keyboard in its exit helper', () => {
    const helper = /const open = \(path: Href\) => \{([^}]*)\}/.exec(source);
    assert.ok(helper, 'app/search.tsx has no open() exit helper');
    assert.match(helper[1], /Keyboard\.dismiss\(\)/);
    assert.match(helper[1], /router\.push\(path\)/);
  });

  it('has no way out that bypasses the helper', () => {
    const pushes = source.match(/router\.push\(/g) ?? [];
    assert.equal(pushes.length, 1, 'every navigation away from search goes through open()');
  });
});
