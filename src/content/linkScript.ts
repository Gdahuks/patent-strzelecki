/**
 * Intercepting clicks on links inside the content.
 *
 * Why `onShouldStartLoadWithRequest` isn't enough: lessons are loaded from a file, so a
 * root-relative link from the course content („/pzss") gets resolved by the browser to
 * `file:///pzss` — outside the directory the WebView is sandboxed to. WebKit rejects that
 * navigation itself („Ignoring request to load this main resource because it is outside the
 * sandbox") and shows an error page instead of the lesson — there's nothing left for the
 * app's router to intercept.
 *
 * That's why the decision is made one step earlier, inside the page itself: a listener in
 * the capture phase blocks the default action and forwards the **raw `href` attribute**.
 * This also simplifies routing, since there's no need to reconstruct the link from a
 * `file://` address.
 *
 * In-page anchor jumps are let through — the browser handles those on its own, and
 * intercepting them would only break scrolling.
 */

/** Script injected together with the content. */
export function linkClickScript(): string {
  return `(function () {
  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node.tagName !== 'A') node = node.parentElement;
    if (!node) return;

    var href = node.getAttribute('href');
    if (!href) return;

    // An in-page anchor: let the browser handle the scroll.
    if (href.charAt(0) === '#') return;

    // No stopPropagation: the glossary tooltip closes on its own bubble-phase
    // listener, and blocking propagation would leave it open after returning from
    // the browser.
    event.preventDefault();
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'link', href: href }));
  }, true);
  true;
})();`;
}

/** Reads a link from a message posted by the page. Returns null for other messages. */
export function parseLinkMessage(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { type?: unknown }).type !== 'link'
    ) {
      return null;
    }

    const { href } = parsed as { href?: unknown };
    return typeof href === 'string' && href.length > 0 ? href : null;
  } catch {
    return null;
  }
}
