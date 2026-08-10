/**
 * Allowed settings values and their captions — with no database access.
 *
 * Split out of `db/settings.ts` for the same reason as `readingProgress.ts`: that module
 * reaches into `expo-sqlite`, which pulls in React Native's Flow syntax, and vitest can't
 * parse that. The rules were pure, but there was no way to run them in a test — and they're
 * exactly the rules that decide what happens to a corrupted or stale row in the database.
 *
 * The boundary from CLAUDE.md: `src/db/` may import from `src/engine/`, never the other way
 * around.
 */

import { DEFAULT_LEVELS, LEVEL_CHOICES } from './leitner';

/** Lesson paragraph size at the system setting's default, untouched value. */
const BASE_CONTENT_SIZE = 17;

export interface Settings {
  /** Number of spaced-repetition levels: `levels - 1` correct answers to mastery. */
  levels: number;
}

/**
 * The level count from the database, clamped to the values offered in Settings.
 *
 * A value outside the allowed set falls back to the default rather than being trusted as
 * is. That's not excess caution: at one level, `deckProgress` produces a negative count of
 * "learning" questions, because bucket zero is then simultaneously the bottom and the top.
 * As long as this filter stands, that state is unreachable.
 */
export function parseLevels(value: string | undefined): number {
  const parsed = Number(value);
  return (LEVEL_CHOICES as readonly number[]).includes(parsed) ? parsed : DEFAULT_LEVELS;
}

/**
 * The system's scale factor, brought down to a value that's safe to compute with.
 *
 * `fontScale` comes from the system, so there's no earlier point to validate it — and a 0,
 * NaN or infinity in the font-size multiplier produces invisible text or a thrown exception.
 */
function normalizeSystemScale(systemScale: number): number {
  return Number.isFinite(systemScale) && systemScale > 0 ? systemScale : 1;
}

/**
 * Paragraph size for content rendered inside a WebView — the one place where we have to
 * compute the scale-up ourselves.
 *
 * The rest of the app stands on React Native's `Text`, which multiplies its size by the
 * system setting on its own. A WebView doesn't do that (and on Android it does it its own
 * way, see `content/webviewProps.ts`), so the stylesheet gets pre-computed pixels from here
 * instead. The effect: one source of truth — the system's "Text Size" — and everything
 * grows together.
 *
 * A separate in-app setting for this existed once and was removed. It was built back when
 * the WebView **didn't** follow the system setting; once it did, it became a second control
 * over the same thing, covering only half the screen — picking a larger value grew the
 * content while the chrome around it stayed put. Don't bring it back without a reason that
 * doesn't reproduce that same inconsistency.
 *
 * Rounding to one decimal place is necessary: this number feeds into the materialization
 * version marker, and the system can return a value differing at some far decimal place
 * between reads — which would rewrite every lesson to disk on every single app start.
 */
export function contentBaseSize(systemScale: number): number {
  return Math.round(BASE_CONTENT_SIZE * normalizeSystemScale(systemScale) * 10) / 10;
}

/**
 * Option caption counted in correct answers, not in levels.
 *
 * The number of levels is an implementation detail of the Leitner buckets; the user only
 * cares how many times they need to answer correctly. The label "2 levels" hid the fact
 * that it meant a single correct answer.
 */
export function levelsLabel(levels: number): string {
  const needed = Math.max(1, levels) - 1;
  if (needed <= 1) return '1 poprawna\nzalicza od razu';
  return `${needed} poprawne\npod rząd`;
}

// There are no size captions here, and that's a choice, not an oversight: the option just
// shows the raw pixel count. Names like „Duża" ("Large"), „Bardzo duża" ("Very large") were
// relative, so with a larger system text size several of them landed on the same size with
// no way to tell them apart.
