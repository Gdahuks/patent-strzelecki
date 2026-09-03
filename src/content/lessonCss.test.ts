import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { lessonCss } from './lessonCss';
import type { Theme } from '../theme';

const THEME = {
  dark: false,
  bg: '#f6f7f9',
  surface: '#ffffff',
  border: '#dfe3e8',
  text: '#15181c',
  muted: '#5d6673',
  accent: '#196bea',
  good: '#1f8b4c',
  bad: '#c8372b',
  critical: '#b06400',
  onFill: '#ffffff',
  mark: '#fff2a8',
} satisfies Theme;

const CSS = lessonCss(THEME, 16);
/** The stylesheet without its comments — they talk about the rules and would be counted. */
const DECLARATIONS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule written for `selector`, as one string. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`the stylesheet has no rule for "${selector}"`);
  return match[2];
}

describe('lessonCss', () => {
  it('breaks a long word anywhere in running text', () => {
    // A course link with no spaces would otherwise push the whole lesson sideways.
    assert.match(rule(CSS, 'body'), /overflow-wrap: anywhere/);
  });

  it('keeps table cells out of that breaking', () => {
    // Inherited into a cell, `anywhere` counts towards its min-content width, so a column
    // can be squeezed to a single character and the table never grows past the screen —
    // which is also why its own `overflow-x: auto` never has anything to scroll.
    assert.match(rule(CSS, 'td, th'), /overflow-wrap: normal/);
  });

  it('breaks anywhere in one place only, and never by character count', () => {
    // Both halves of the guard: a second `anywhere` rule would reach the cells again
    // through the cascade, and `word-break: break-all` collapses min-content the same way
    // `anywhere` does — either would bring the one-letter columns back.
    assert.equal(DECLARATIONS.match(/overflow-wrap: anywhere/g)?.length, 1);
    assert.doesNotMatch(DECLARATIONS, /word-break/);
  });
});
