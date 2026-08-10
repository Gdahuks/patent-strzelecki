import * as WebBrowser from 'expo-web-browser';

import type { Theme } from '../theme';

/**
 * Opens an address in a browser **inside the app**.
 *
 * That's `SFSafariViewController` on iOS — the same mechanism Messenger uses: the page
 * appears as a sheet over the app and closes with a single gesture, with no switching to
 * Safari and no losing your place in the material.
 *
 * Every call site in the app has to go through this function rather than calling
 * `openBrowserAsync` directly — otherwise presentation style and colors drift apart, and it
 * starts looking like two different mechanisms.
 *
 * A failed open is swallowed silently: no reaction at all is better than crashing the screen
 * the user was just studying on.
 */
export function openInAppBrowser(url: string, theme: Theme): void {
  if (!url) return;

  void WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    toolbarColor: theme.surface,
    controlsColor: theme.accent,
    enableBarCollapsing: true,
  }).catch(() => undefined);
}
