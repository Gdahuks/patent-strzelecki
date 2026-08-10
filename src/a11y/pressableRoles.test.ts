import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

/**
 * Every touchable element must declare an `accessibilityRole`.
 *
 * Without a role, the screen reader reads the plain text and doesn't say it's a button — and
 * the gap is invisible to a sighted developer, so it only surfaces in an audit (that's how the
 * one `Pressable` without a role turned up, „Usuń to podejście"). The test reads source files
 * as plain text, without rendering anything: the screens pull in React Native, whose Flow
 * syntax vitest can't parse, and that boundary is meant to stay.
 *
 * What gets checked is the opening tag: from `<Pressable` to the closing `>`, tracked with a
 * bracket counter so a `>` inside an expression (arrow functions, JSX in attribute values)
 * can't end the match early. String literals and comments are skipped in full — a bracket or
 * a `>` inside a label's text must not be able to either cut the tag short or throw the
 * counter off, since a counter thrown off silently disabled checking for the rest of the file.
 * Deliberate simplification: the inside of a template literal (including `${…}`) is skipped
 * all the way to the closing backtick — and there isn't one in these files anyway, see the ban
 * in CLAUDE.md.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCANNED = ['app', 'src'];
const TOUCHABLES = [
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/** Opening tags for the given component, each with the line number of its first character. */
function openingTags(source: string, component: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  const needle = `<${component}`;

  for (let from = 0; ; ) {
    const start = source.indexOf(needle, from);
    if (start === -1) break;
    from = start + needle.length;

    // `<Pressable` must not match `<PressableSomething` — the identifier must end right after
    // the name.
    const boundary = source[start + needle.length];
    if (boundary !== undefined && !/[\s/>]/.test(boundary)) continue;

    let depth = 0;
    for (let at = start; at < source.length; at += 1) {
      const char = source[at];

      // String literal: skip ahead to its closing quote, honoring the escape backslash.
      if (char === "'" || char === '"' || char === '`') {
        for (at += 1; at < source.length && source[at] !== char; at += 1) {
          if (source[at] === '\\') at += 1;
        }
        continue;
      }

      // Line and block comments: skip to the end of the line or to `*/`.
      if (char === '/' && source[at + 1] === '/') {
        at = source.indexOf('\n', at);
        if (at === -1) break;
        continue;
      }
      if (char === '/' && source[at + 1] === '*') {
        const end = source.indexOf('*/', at + 2);
        if (end === -1) break;
        at = end + 1;
        continue;
      }

      if (char === '{' || char === '(') depth += 1;
      else if (char === '}' || char === ')') depth -= 1;
      else if (char === '>' && depth === 0) {
        found.push({
          tag: source.slice(start, at + 1),
          line: source.slice(0, start).split('\n').length,
        });
        break;
      }
    }
  }

  return found;
}

describe('roles of touchable elements', () => {
  const files = SCANNED.flatMap((name) => sourceFiles(join(ROOT, name)));

  it('sees source files (guard against an empty run)', () => {
    assert.ok(files.length >= 10, `found only ${files.length} .tsx files`);
  });

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const tags = TOUCHABLES.flatMap((component) => openingTags(source, component));
    if (tags.length === 0) continue;

    it(relative(ROOT, file), () => {
      for (const { tag, line } of tags) {
        // An element **removed** from the accessibility tree doesn't need a role and can't
        // have one: a sheet's backdrop closes on tap, but a screen reader should start at the
        // title, not at an unnamed full-height button. That action is available in two other
        // ways there anyway — a button and the back gesture.
        //
        // **Both** attributes are required, not either one. `accessibilityElementsHidden`
        // works on iOS, `importantForAccessibility` on Android — either one alone removes the
        // element from the tree on one platform while leaving an unnamed, roleless button on
        // the other. A condition built on OR let exactly this case slip through — and on the
        // phone this app is actually used on, at that.
        const hidden =
          tag.includes('accessibilityElementsHidden') &&
          tag.includes('importantForAccessibility="no"');

        assert.ok(
          tag.includes('accessibilityRole') || hidden,
          `touchable element with no accessibilityRole at line ${line}:\n${tag}`,
        );
      }
    });
  }
});
