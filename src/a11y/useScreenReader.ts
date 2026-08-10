/**
 * Whether the screen reader is running (VoiceOver on iOS, TalkBack on Android).
 *
 * Needed for a single purpose: **disabling automatic transitions**. Practice mode advances to
 * the next question 550 ms after a correct answer, the exam 220 ms after picking an option.
 * For a sighted user that's a convenience — across ten questions it saves ten taps. For a
 * screen reader user it's lost content: announcing the verdict takes longer than half a
 * second, so the screen changes mid-sentence and there's no way to tell whether the answer was
 * right.
 *
 * The state is tracked, not read once on mount: the screen reader can be toggled with a
 * shortcut (triple-clicking the side button) while studying, without leaving the app.
 *
 * There's no reason to use this anywhere else — the rest of accessibility should behave the
 * same way always, and an interface branching into a "screen reader version" drifts apart at
 * the first change.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // The read is asynchronous, so the first render goes out with `false`. That's a good
    // starting value: if it were briefly the other way around, the transition after an answer
    // would disappear for a sighted user and look like a freeze.
    void AccessibilityInfo.isScreenReaderEnabled().then((active) => {
      if (!cancelled) setEnabled(active);
    });

    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return enabled;
}
