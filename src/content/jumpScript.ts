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
 * `ref` comes from a route parameter, and the route is also reachable through a deep link
 * (`patentstrzelecki://act/uobia?ref=…`) — a value from outside the app. It goes through
 * `JSON.stringify`: inserted raw, it could close the string early and let arbitrary code run
 * inside the WebView. The unit is then matched by comparing `data-id` values, never by
 * pasting the ref into a selector: a ref starting with a digit, or containing a dot or a
 * `]`, made `querySelector` throw and aborted the whole function.
 */
export function jumpScript(ref: string): string {
  return `(function () {
  var want = ${JSON.stringify(ref)};
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
    var units = document.querySelectorAll('[data-id]');
    for (var i = 0; i < units.length; i += 1) {
      if (units[i].getAttribute('data-id') === want) return units[i];
    }
    return null;
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
