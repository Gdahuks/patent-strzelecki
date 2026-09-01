import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

/**
 * Who opened the find bar decides whether its field takes focus.
 *
 * The magnifier does: the field is empty and there is nothing to do with it but type. A phrase
 * arriving from a search hit does not: it is already in the field, the hits are already
 * highlighted, and the reader came to read and step through them. The bar used to focus
 * unconditionally, so opening a search result raised the keyboard over the lower part of the
 * very passage the result pointed at.
 *
 * Nothing else on that path needs to take the keyboard down — the native stack dismisses it on
 * push by itself, measured on the emulator through a result whose target has no find bar at
 * all: the keyboard goes even though no code asks it to.
 *
 * These tests guard the shape rather than the behaviour: `FindBar` and the screens pull in
 * React Native, whose Flow syntax vitest can't parse, so they read the source as plain text —
 * the same boundary `src/a11y/pressableRoles.test.ts` keeps.
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

  it('opens without focus when it opens with a phrase already in it', () => {
    assert.match(bar, /useState\(initialQuery\.length === 0\)/);
  });

  // The one line that carries the whole reset. Without it the flag keeps the value it was
  // given on mount, and the sequence "arrive from a search hit → Zamknij → magnifier" opens an
  // empty bar with no keyboard and no other way to type into it. Everything else in this file
  // still passes when it is deleted, which is why it is asserted on its own.
  it('restores focus for a bar opened by hand', () => {
    const toggle = /const toggle = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[/.exec(bar);
    assert.ok(toggle, 'FindBar.tsx has no toggle callback');
    assert.match(toggle[0], /setFocusOnOpen\(true\)/);
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
