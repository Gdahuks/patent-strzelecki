import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom padding that keeps content clear of the system navigation bar.
 *
 * With `targetSdk 36` Android draws the app edge to edge, so the window includes the strip
 * the navigation bar sits in — and that strip swallows touches as well as pixels. A screen
 * pushed onto the stack has to reserve the inset itself. Without it, on a phone with
 * three-button navigation the exam's "Zakończ", the lesson's "Oznacz jako przeczytane" and
 * the practice footer sat **under** the navigation bar and could not be tapped at all: a tap
 * there goes to the system, not to the app. Version 0.1.0 shipped like that.
 *
 * The reason it survived testing: with gesture navigation the bar is a few pixels tall, so
 * the overlap hid nothing but a line of text. Reproduce the bad case on the emulator with
 *
 * ```sh
 * adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton
 * adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural  # back
 * ```
 *
 * **Tab screens must not use this.** React Navigation's tab bar already applies the inset to
 * itself, so a second one leaves an empty strip above the tabs. Only screens with no tab bar
 * under them need it — everything under `app/` except the `(tabs)` group.
 *
 * For scrolling content, add the inset to `contentContainerStyle`: the content may be drawn
 * under a translucent bar, but its end has to be reachable. For a pinned footer, add it to
 * the footer's own padding so the controls sit above the bar.
 *
 * @param base padding the screen wants regardless of the inset
 */
export function useBottomInset(base = 0): number {
  return base + useSafeAreaInsets().bottom;
}
