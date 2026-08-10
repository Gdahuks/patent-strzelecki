/**
 * Script injected into a lesson: restores the reading position and reports scroll events.
 *
 * A WebView offers no way from the outside to set the scroll position, so code running on
 * the page itself is the only route. The content is local and entirely ours, and navigation
 * is intercepted by the router regardless, so enabling JavaScript doesn't open anything up
 * to the outside.
 */

/** How often the page reports its position. Less often than a frame, more often than a blink. */
const REPORT_INTERVAL_MS = 400;

export function readingScript(startPosition: number): string {
  const start = Math.min(1, Math.max(0, startPosition));

  return `(function () {
  var start = ${start};

  function maxScroll() {
    return Math.max(1, document.body.scrollHeight - window.innerHeight);
  }

  function report() {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'scroll',
      position: window.scrollY / maxScroll()
    }));
  }

  if (start > 0) {
    var restore = function () { window.scrollTo(0, start * maxScroll()); };
    restore();
    // Images finish loading after the first render and change the page's height,
    // so a single scroll would land in the wrong place.
    setTimeout(restore, 250);
    setTimeout(restore, 1000);
  }

  var last = 0;
  window.addEventListener('scroll', function () {
    var now = Date.now();
    if (now - last < ${REPORT_INTERVAL_MS}) return;
    last = now;
    report();
  }, { passive: true });

  // A lesson shorter than the screen never fires a single scroll event, and yet it
  // counts as read the moment it's opened.
  if (document.body.scrollHeight <= window.innerHeight + 8) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'scroll', position: 1 }));
  }

  true;
})();`;
}

/** Reads the position from a message posted by the page. Returns null for anything else. */
export function parseScrollMessage(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { type?: unknown }).type !== 'scroll'
    ) {
      return null;
    }

    const position = (parsed as { position?: unknown }).position;
    if (typeof position !== 'number' || !Number.isFinite(position)) return null;

    return Math.min(1, Math.max(0, position));
  } catch {
    return null;
  }
}
