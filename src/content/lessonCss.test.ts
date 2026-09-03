import { describe, expect, it } from 'vitest';
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

/** The declarations of the first rule written for `selector`, as one string. */
function rule(css: string, selector: string): string {
  const match = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(
    css,
  );
  if (!match) throw new Error(`arkusz nie ma reguły dla "${selector}"`);
  return match[2];
}

describe('lessonCss', () => {
  it('breaks a long word anywhere in running text', () => {
    // A course link with no spaces would otherwise push the whole lesson sideways.
    expect(rule(lessonCss(THEME, 16), 'body')).toContain('overflow-wrap: anywhere');
  });

  it('keeps table cells out of that breaking', () => {
    // Inherited into a cell, `anywhere` counts towards its min-content width, so a column
    // can be squeezed to a single character and the table never grows past the screen —
    // which is also why its own `overflow-x: auto` never has anything to scroll.
    expect(rule(lessonCss(THEME, 16), 'td, th')).toContain('overflow-wrap: normal');
  });
});
