/**
 * Tooltips for abbreviations in lesson content.
 *
 * The scraper marks the first occurrence of each abbreviation as `<abbr data-term="…">`.
 * Here we add the expanded definition and the tap handling: a tooltip appears right next to
 * the abbreviation, with no navigation and no scrolling, so the reader's place in the text
 * isn't lost.
 */

import type { GlossaryTerm } from './types';

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Writes definitions into the marked abbreviations, so the page is self-contained and the
 * tooltip script doesn't need to know any data itself.
 *
 * Abbreviations with no glossary entry are left without a `data-def` — the script then
 * skips them, so an empty tooltip can never be triggered.
 */
export function withDefinitions(html: string, glossary: GlossaryTerm[]): string {
  const definitions = new Map(glossary.map((term) => [term.abbr, term.definition]));

  return html.replace(/data-term="([^"]+)"/g, (match, abbr: string) => {
    const definition = definitions.get(abbr);
    if (!definition) return match;

    // `title` alongside `data-def`, even though it carries the same text. The glossary
    // definition shows up on tap, and tapping an abbreviation is a hard-to-discover gesture
    // for a screen-reader user — `title` on `<abbr>` is the standard place VoiceOver and
    // TalkBack read the definition from on their own, no gesture needed. The tooltip stays
    // as the sighted-user affordance.
    const escaped = escapeAttribute(definition);
    return `${match} data-def="${escaped}" title="${escaped}"`;
  });
}

/** Script injected into a lesson: handles tapping an abbreviation. */
export function glossaryScript(): string {
  return `(function () {
  var bubble = null;
  var openFor = null;

  function hide() {
    if (bubble) { bubble.remove(); bubble = null; }
    openFor = null;
  }

  function show(target) {
    var definition = target.getAttribute('data-def');
    if (!definition) return;

    hide();
    openFor = target;
    bubble = document.createElement('div');
    bubble.className = 'skrot-dymek';
    bubble.textContent = target.getAttribute('data-term') + ' — ' + definition;
    document.body.appendChild(bubble);

    // Positioned relative to the document, not the viewport: the tooltip has to stay
    // next to the abbreviation when the reader scrolls the page.
    var box = target.getBoundingClientRect();
    var top = box.bottom + window.scrollY + 6;
    var width = Math.min(bubble.offsetWidth, window.innerWidth - 24);
    var left = box.left + window.scrollX + box.width / 2 - width / 2;

    bubble.style.width = width + 'px';
    bubble.style.left = Math.max(12, Math.min(left, window.innerWidth - width - 12)) + 'px';
    bubble.style.top = top + 'px';
  }

  document.addEventListener('click', function (event) {
    var term = event.target.closest ? event.target.closest('abbr.skrot') : null;
    if (term) {
      event.preventDefault();
      // Tapping the same marker again closes the tooltip. We compare the element, not
      // the label: the same label appears many times in an act — every link to
      // footnote 1 reads "Przypis 1", and every reference to one amendment carries the
      // same date. Comparing by label meant tapping a neighbour closed the tooltip
      // instead of moving it.
      //
      // The marker is remembered only by show(), since only it knows whether a tooltip
      // was created at all: an abbreviation with no expansion returns early, and
      // there's nothing to close.
      if (bubble && openFor === term) { hide(); return; }
      show(term);
      return;
    }
    hide();
  }, false);

  window.addEventListener('resize', hide);
  true;
})();`;
}
