/**
 * Announcement for the screen reader — for state changes that aren't navigation.
 *
 * The screen reader reads the screen on its own after moving to a new one, but a verdict
 * after an answer, an exam result, or a hit counter replace content **in place** — a screen
 * reader user then hears silence and has to touch the element again to learn the outcome of
 * their own action.
 *
 * Without a screen reader the call is silent (the system ignores it), so there's no branching
 * of the UI into a "screen reader version" here — see the note in `useScreenReader.ts`.
 *
 * A new announcement interrupts the previous one, so the caller doesn't need to queue
 * anything, but the message should stay short: a full descriptive sentence would get cut off
 * by the next one anyway.
 */

import { AccessibilityInfo } from 'react-native';

export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}
