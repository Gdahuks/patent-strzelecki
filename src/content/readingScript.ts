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

/**
 * How long after the last scroll event the page reports where it came to rest.
 *
 * Without this the saved position was whatever the rate limit happened to catch mid-fling —
 * and at the bottom of a lesson no further scroll event ever arrives, so a fling ended with
 * a position from halfway down and the lesson resumed there.
 */
const IDLE_MS = 250;

export function readingScript(startPosition: number): string {
  const start = Math.min(1, Math.max(0, startPosition));

  return `(function () {
  var start = ${start};

  function maxScroll() {
    return Math.max(1, document.body.scrollHeight - window.innerHeight);
  }

  function report(initial) {
    var height = document.body.scrollHeight;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'scroll',
      // A sample the reader didn't ask for: sent on load, so the tracker has a window to
      // measure time against. The screen takes the window and leaves the position alone —
      // opening a lesson and closing it must not leave a trace.
      initial: initial === true,
      position: window.scrollY / maxScroll(),
      // The screen's height as a fraction of the page: the reader sees a band of text, not a
      // point, and the whole band is what counts as time on screen.
      view: height > 0 ? Math.min(1, window.innerHeight / height) : 1,
      // The page height itself, so the screen can tell the text has been reflowed. A rotation
      // or a change of system font size moves every place in the document.
      height: height
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
  var idle = null;
  window.addEventListener('scroll', function () {
    var now = Date.now();
    // The stream stays rate-limited; the idle timer adds one report per scroll, so where the
    // reader came to rest is known even when it falls between two samples.
    if (idle !== null) clearTimeout(idle);
    idle = setTimeout(report, ${IDLE_MS});
    if (now - last < ${REPORT_INTERVAL_MS}) return;
    last = now;
    report();
  }, { passive: true });

  // One report before any scrolling: the reading tracker needs a window to measure time
  // against, and a lesson shorter than the screen never fires a scroll event at all. The
  // repeat covers images settling, which changes the page height. Both are marked as
  // unasked-for, so neither writes a reading position.
  report(true);
  setTimeout(function () { report(true); }, 1000);

  true;
})();`;
}

/** One reading of where the page is. */
export interface ReadingSample {
  /** True for a sample the page sent on load, not one the reader caused by scrolling. */
  initial: boolean;
  /** Scroll fraction, 0..1. */
  position: number;
  /** The screen's height as a fraction of the page. Zero when the page didn't say. */
  view: number;
  /** The page's total height in pixels. Zero when the page didn't say. */
  height: number;
}

function fraction(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Reads a sample posted by the page. Returns null for anything else. */
export function parseReadingSample(raw: string): ReadingSample | null {
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

    const height = (parsed as { height?: unknown }).height;

    return {
      initial: (parsed as { initial?: unknown }).initial === true,
      position: Math.min(1, Math.max(0, position)),
      view: fraction((parsed as { view?: unknown }).view),
      height: typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 0,
    };
  } catch {
    return null;
  }
}
