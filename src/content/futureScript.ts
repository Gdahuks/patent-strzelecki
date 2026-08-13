/**
 * A reference to a passage that isn't in force yet — the route to the sheet starts down in
 * the page.
 *
 * A short change is shown as a tooltip, handled entirely inside the page (`glossaryScript`),
 * without a single byte sent to the native layer. A longer change doesn't fit a tooltip:
 * `.skrot-dymek` has neither `max-height` nor scrolling, and its content is inserted as flat
 * `textContent` — a whole code article would run off the screen with no way to reach the rest
 * of it. That's why the sheet's handle reports out to the native layer, and a `Modal` on the
 * act screen does the rest.
 *
 * The handle **doesn't carry the `skrot` class**, and that's the non-obvious part here:
 * `glossaryScript` opens a tooltip for every element matching `abbr.skrot`, so sharing the
 * class would mean a tooltip carrying the whole provision's text popping up next to the sheet.
 */

export interface FuturePassage {
  /** Effective date, in the bundle's format, e.g. „2026-08-23". */
  from: string;
  /** The new wording, already stripped of markup. */
  content: string;
}

/** Script injected into an act: tapping the handle reports to the native layer. */
export function futureScript(): string {
  return `(function () {
  document.addEventListener('click', function (event) {
    var handle = event.target.closest ? event.target.closest('.przyszle-arkusz') : null;
    if (!handle) return;

    // Without this, tapping the handle would try to navigate, since the handle sits
    // inside the act's own content.
    event.preventDefault();
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'przyszle',
      od: handle.getAttribute('data-od') || '',
      tresc: handle.getAttribute('data-przyszle') || ''
    }));
  }, false);

  true;
})();`;
}

/**
 * Reads a future passage from a message posted by the page. Returns null for anything else
 * — the act screen receives three kinds of messages on one channel: search, scroll, and
 * this one.
 */
export function parseFutureMessage(raw: string): FuturePassage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { type?: unknown }).type !== 'przyszle'
    ) {
      return null;
    }

    const { od, tresc } = parsed as { od?: unknown; tresc?: unknown };
    if (typeof od !== 'string' || typeof tresc !== 'string') return null;
    // An empty sheet is worse than no sheet at all: it looks like a provision deleted for
    // no reason.
    if (!od || !tresc) return null;

    return { from: od, content: tresc };
  } catch {
    return null;
  }
}
