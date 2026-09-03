import { useColorScheme } from 'react-native';

export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  good: string;
  bad: string;
  critical: string;
  /**
   * The label on a colour-filled surface: buttons, the selected answer, the exam strip.
   *
   * This isn't simply white. In the dark theme, accents have to be **bright** to read
   * against a dark background — but a white label on a bright fill gives a contrast of
   * 2.3–3.1:1 against the required 4.5:1 (measured with the WCAG formula; checked against
   * reference values). This isn't visible by eye, because these colours are saturated and
   * look "strong" — but saturation isn't luminance: in luminance terms, blue weighs 0.0722
   * and green 0.7152.
   *
   * The fix is a dark label on a bright fill, the same way Material 3 does it. The palette
   * stays untouched, the contrast rises to 6.1–8.1:1, and the light theme keeps its white.
   */
  onFill: string;
  /**
   * The ground behind a search match, set like a highlighter stroke — what marks the phrase
   * in a result card. Bold alone wasn't enough: a question's text is already bold, so a bold
   * match inside it was invisible. The text on it uses `text`, not `muted`: `muted` on
   * this ground would fall under 4.5:1 in the dark theme.
   */
  mark: string;
}

const LIGHT: Theme = {
  dark: false,
  bg: '#f6f7f9',
  surface: '#ffffff',
  border: '#dfe3e8',
  text: '#15181c',
  muted: '#5d6673',
  accent: '#196bea',
  good: '#1a7f45',
  bad: '#c0362c',
  critical: '#a8560b',
  onFill: '#ffffff',
  mark: '#ffe58a',
};

const DARK: Theme = {
  dark: true,
  bg: '#101317',
  surface: '#181c22',
  border: '#2a3039',
  text: '#e8eaed',
  muted: '#98a1af',
  accent: '#5a9cff',
  good: '#4ac07d',
  bad: '#ef6a5e',
  critical: '#e0913f',
  // The app's background colour used as the label on a fill — the same shade the eye
  // already knows from the rest of the screen.
  onFill: '#101317',
  // Dim, not bright: a saturated yellow behind light text reads as a warning here, and the
  // text on it (#e8eaed) still clears 7:1.
  mark: '#4d4310',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}
