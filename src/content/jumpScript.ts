/** How long a jump keeps re-checking its target before it stops trying. */
export const JUMP_DEADLINE_MS = 2000;
/** How often it re-checks. */
export const JUMP_TICK_MS = 100;

/**
 * Script that scrolls an act to one unit — and keeps it there while the page settles.
 *
 * A single `scrollIntoView` in `onLoadEnd` was not enough. On iOS "loaded" means the
 * document arrived, not that its layout is final: WKWebView learns the content size
 * asynchronously from its content process, and a scroll request is clipped to the size it
 * knows at that moment. On the first act opened after a fresh install — the first WebView in
 * the process, with the database still being created and the acts bundle parsed for the
 * first time — that window was wide enough for a jump to 80 % of the Criminal Code to land
 * on 0. Later opens were fine, which is exactly what made it look like a phantom.
 *
 * So the page decides, not the screen: after scrolling, the script re-checks where the
 * target sits and how tall the document is, and scrolls again while either is still
 * moving. It stops once two consecutive ticks agree that nothing moves — one quiet tick is
 * not enough, since a layout can pause for a moment and then grow. `readingScript` has done
 * the same for the restored reading position from the start (its retries at +250 ms and
 * +1000 ms); the jump never got that lesson. A fixed delay instead would guess the cold-start
 * time and slow down every warm open.
 *
 * Only one jump runs at a time: every injection takes a fresh token and the previous loop
 * sees it and quits, so two taps in the unit list within two seconds don't fight over the
 * page. The reader's first touch bumps the same token, which ends the current loop.
 *
 * The ref is a **path** — `arti_18/pass_5/pint_6` — and each step is searched **inside** the
 * one before it, never across the whole document. Identifiers below an article repeat: the
 * firearms act alone has fifty `pass_1` and forty-nine `pint_1`, so a document-wide search
 * for `pass_5` would land in art. 1. A step that the document doesn't have stops the walk
 * and the deepest step found so far wins — a bundle where a point has been renumbered still
 * takes the reader to the right paragraph instead of to the top of the act.
 *
 * `ref` comes from a route parameter, and the route is also reachable through a deep link
 * (`patentstrzelecki://act/uobia?ref=…`) — a value from outside the app. It goes through
 * `JSON.stringify`: inserted raw, it could close the string early and let arbitrary code run
 * inside the WebView. The steps are then matched by comparing `data-id` values, never by
 * pasting them into a selector: a step starting with a digit, or containing a dot or a
 * `]`, made `querySelector` throw and aborted the whole function.
 */
export function jumpScript(ref: string): string {
  const path = ref.split('/').filter((step) => step.length > 0);

  return `(function () {
  var path = ${JSON.stringify(path)};
  var token = (window.__psJump = (window.__psJump || 0) + 1);
  if (!window.__psJumpTouch) {
    window.__psJumpTouch = true;
    window.addEventListener('touchstart', function () { window.__psJump += 1; }, { passive: true });
  }
  var deadline = Date.now() + ${JUMP_DEADLINE_MS};
  var lastHeight = -1;
  var lastY = -1;
  var quiet = 0;
  function target() {
    var scope = document;
    var found = null;
    for (var s = 0; s < path.length; s += 1) {
      var units = scope.querySelectorAll('[data-id]');
      var step = null;
      for (var i = 0; i < units.length; i += 1) {
        if (units[i].getAttribute('data-id') === path[s]) { step = units[i]; break; }
      }
      if (!step) break;
      found = step;
      scope = step;
    }
    return found;
  }
  function settle() {
    if (token !== window.__psJump) return;
    var unit = target();
    if (!unit) return;
    var top = unit.getBoundingClientRect().top;
    var height = document.body.scrollHeight;
    var y = window.scrollY;
    // In place, or as close as the page allows — a unit near the end can't reach the top,
    // and then the scroll position itself stops changing.
    var inPlace = Math.abs(top) <= 2 || y === lastY;
    if (!inPlace) unit.scrollIntoView({ block: 'start' });
    quiet = inPlace && height === lastHeight ? quiet + 1 : 0;
    lastHeight = height;
    lastY = y;
    if (quiet < 2 && Date.now() < deadline) setTimeout(settle, ${JUMP_TICK_MS});
  }
  settle();
  true;
})();`;
}
