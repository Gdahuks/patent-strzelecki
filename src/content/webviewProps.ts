/**
 * WebView properties that are only allowed to be passed on one platform.
 *
 * `decelerationRate="normal"` gives iOS a Safari-like scroll deceleration — the default one
 * feels jerky there. On Android, the same property is generated as a number, so passing
 * a string crashes the app the instant the view is created:
 * `ClassCastException: java.lang.String cannot be cast to java.lang.Double`.
 * The crash is immediate and hits every screen with content in it, so the mismatch is hard
 * to miss — but it's easy to reproduce on the next WebView, which is why this lives here
 * once.
 *
 * `textZoom={100}` turns off a **second** round of text scaling on Android. Android's
 * WebView enlarges HTML text on its own to match the system's "Text Size" setting, and that
 * same enlargement is already baked into the sheet through `contentBaseSize` (see
 * `engine/settingsValues.ts`) — so without this property it would multiply twice: at
 * a system scale of 1.3, the sheet gets 22.1 px, and the WebView would apply another
 * 1.3× on top of that. Android only, since iOS doesn't do this.
 *
 * Scaling therefore lives in exactly one place — the sheet — and works the same way on both
 * platforms. Don't remove this "because Android can handle it anyway": it can, but then iOS
 * falls behind, and content size stops matching the rest of the interface.
 */

import { Platform } from 'react-native';

export const SCROLL_PROPS =
  Platform.OS === 'ios'
    ? ({ decelerationRate: 'normal' } as const)
    : ({ textZoom: 100 } as const);
