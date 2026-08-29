/**
 * Search inside lesson content — highlighting and stepping between hits.
 *
 * The same pattern as a browser or an ebook reader: hits marked in the text, the current
 * one emphasised, arrows step through them in order. This solves two problems at once:
 * jumping from a global search result straight to a specific spot in a lesson, and
 * searching the page while already reading it.
 *
 * We deliberately don't split global results into a separate entry per occurrence — the
 * „Budowa broni" lesson alone has 91 hits for the phrase „bro", i.e. 91 cards to scroll
 * through.
 */

import { FOLD, WORD_CHAR, normalize } from './search';
import { JUMP_DEADLINE_MS, JUMP_TICK_MS } from './jumpScript';

/** Below this phrase length, highlighting buries the text and adds nothing. */
export const MIN_FIND_LENGTH = 3;

/**
 * A phrase reduced to the form the script searches with: lower case, no Polish diacritics,
 * whitespace collapsed. Empty when it's too short — the script then only clears previous
 * highlights.
 *
 * Without this, the phrase went to the page raw, even though global search has always run
 * it through `normalize`: „broń " (a trailing keyboard space) produced no hits at all in a
 * lesson, and „broń  palna" with a double space made the card promise four lessons, each
 * of them saying „brak trafień".
 */
export function findNeedle(query: string): string {
  const needle = normalize(query);
  return needle.length >= MIN_FIND_LENGTH ? needle : '';
}

export interface FindState {
  total: number;
  /** The current hit's number, counting from 1. Zero when nothing was found. */
  index: number;
}

/**
 * The script injected together with the lesson. It does nothing on its own — it exposes
 * `window.__psFind`, which the native layer calls through `injectJavaScript`.
 *
 * The character map and the word-boundary rule **come from search.ts**, not copied here.
 * They have to match character for character, since the hit count on the results card is
 * computed on one side and highlighting happens on the other — and both copies would look
 * correct even if they drifted apart. The map also has to preserve length, so hit positions
 * line up with the text.
 */
export function findHelpersScript(): string {
  return `(function () {
  var FOLD = ${JSON.stringify(FOLD)};
  var WORD = ${WORD_CHAR.toString()};

  function fold(text) {
    var out = '';
    var lower = text.toLowerCase();
    for (var i = 0; i < lower.length; i++) {
      var ch = lower[i];
      out += FOLD[ch] || ch;
    }
    return out;
  }

  function isWordChar(ch) {
    return ch !== undefined && WORD.test(ch);
  }

  function positions(haystack, needle) {
    var found = [];
    var from = 0;
    while (from <= haystack.length - needle.length) {
      var at = haystack.indexOf(needle, from);
      if (at < 0) break;
      if (!isWordChar(haystack[at - 1])) { found.push(at); from = at + needle.length; }
      else { from = at + 1; }
    }
    return found;
  }

  function collectTextNodes() {
    var nodes = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.data || !node.data.trim()) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        while (parent) {
          var name = parent.tagName;
          if (name === 'SCRIPT' || name === 'STYLE' || name === 'MARK') {
            return NodeFilter.FILTER_REJECT;
          }
          parent = parent.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  var marks = [];
  var current = -1;

  function post() {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'find',
      total: marks.length,
      index: marks.length === 0 ? 0 : current + 1
    }));
  }

  function clear() {
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    }
    marks = [];
    current = -1;
    settling += 1;
  }

  // Same trouble as the unit jump (see jumpScript): on a cold start the page reports
  // "loaded" before its layout is final, and one scrollIntoView on the first hit lands
  // short. After scrolling, watch the document height for a while and scroll again when it
  // changes; two quiet ticks in a row end the watch. Only the newest highlight is watched
  // (the token), and clearing the marks retires the watch too.
  //
  // The reader's first touch ends watching for good, not just for the current run. The
  // only case that needs it is the first hit after opening an act from a search result,
  // before any touch; from then on every scrollIntoView is the reader's own arrow tap.
  var settling = 0;
  var touched = false;
  window.addEventListener('touchstart', function () { touched = true; }, { once: true, passive: true });
  function settle(mark, height, quiet, deadline, token) {
    if (touched || token !== settling) return;
    var now = document.body.scrollHeight;
    if (now !== height) mark.scrollIntoView({ block: 'center' });
    quiet = now === height ? quiet + 1 : 0;
    if (quiet < 2 && Date.now() < deadline) {
      setTimeout(function () { settle(mark, now, quiet, deadline, token); }, ${JUMP_TICK_MS});
    }
  }

  function highlight() {
    for (var i = 0; i < marks.length; i++) {
      if (i === current) marks[i].className = 'psx psx-now';
      else marks[i].className = 'psx';
    }
    if (current >= 0 && marks[current]) {
      var mark = marks[current];
      mark.scrollIntoView({ block: 'center' });
      settling += 1;
      settle(mark, document.body.scrollHeight, 0, Date.now() + ${JUMP_DEADLINE_MS}, settling);
    }
  }

  window.__psFind = {
    run: function (query) {
      clear();
      var needle = fold(query || '');
      if (needle.length < ${MIN_FIND_LENGTH}) { post(); return; }

      var nodes = collectTextNodes();
      for (var n = 0; n < nodes.length; n++) {
        var node = nodes[n];
        var hits = positions(fold(node.data), needle);
        // From the end, since splitting a node invalidates positions further along.
        for (var h = hits.length - 1; h >= 0; h--) {
          var tail = node.splitText(hits[h]);
          var rest = tail.splitText(needle.length);
          var mark = document.createElement('mark');
          mark.className = 'psx';
          mark.textContent = tail.textContent;
          tail.parentNode.replaceChild(mark, tail);
          marks.unshift(mark);
          if (rest) { /* left as plain text */ }
        }
      }

      // unshift inserts each node's hits in reverse order; we sort them by document
      // position so the arrows step through them in reading order.
      marks.sort(function (a, b) {
        return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
      });

      current = marks.length ? 0 : -1;
      highlight();
      post();
    },

    step: function (delta) {
      if (!marks.length) { post(); return; }
      current = (current + delta + marks.length) % marks.length;
      highlight();
      post();
    },

    clear: function () {
      clear();
      post();
    }
  };
  true;
})();`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/** Commands injected into an already-loaded page. */
export const findCommands = {
  // The phrase travels normalized, i.e. in exactly the form global search matches against.
  run: (query: string) =>
    `window.__psFind && window.__psFind.run(${quote(findNeedle(query))}); true;`,
  step: (delta: number) => `window.__psFind && window.__psFind.step(${delta}); true;`,
  clear: () => `window.__psFind && window.__psFind.clear(); true;`,
};

/** Reads the search state out of a message from the page. Returns null for other messages. */
export function parseFindMessage(raw: string): FindState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { type?: unknown }).type !== 'find'
    ) {
      return null;
    }

    const { total, index } = parsed as { total?: unknown; index?: unknown };
    if (typeof total !== 'number' || typeof index !== 'number') return null;
    if (!Number.isFinite(total) || !Number.isFinite(index)) return null;

    return { total: Math.max(0, total), index: Math.max(0, index) };
  } catch {
    return null;
  }
}

/** The hit-count label: „3 / 91", or a message saying there are none. */
export function findLabel(query: string, state: FindState | null): string {
  // The same length measure as in `findNeedle`. On `query.trim()`, the label used to say
  // „min. 3 znaki" for „ ab", even though the script had already received the phrase and
  // was searching.
  const needle = normalize(query);
  if (needle.length === 0) return '';
  if (needle.length < MIN_FIND_LENGTH) return `min. ${MIN_FIND_LENGTH} znaki`;
  if (!state) return '…';
  if (state.total === 0) return 'brak trafień';
  return `${state.index} / ${state.total}`;
}
