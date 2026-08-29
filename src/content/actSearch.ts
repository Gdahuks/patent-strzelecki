/**
 * Search across the text of statutes and regulations.
 *
 * One result per act, exactly like one result per lesson: an entry says how many hits can
 * be highlighted in that act, and tapping it opens it with in-page search already active,
 * scrolled to the first one. Splitting into one entry per article produced hundreds of
 * cards, impossible to scroll through to reach the questions — the same mistake we'd
 * already made once with lessons.
 *
 * Kept separate from `search.ts`, because the cost here is a different order of magnitude:
 * the acts together add up to nearly 700 KB of text, so stripping markup and folding Polish
 * diacritics has to be paid for once, not on every keystroke.
 *
 * The dependency direction is one-way: this module uses helpers from `search.ts`, never
 * the other way around. The search screen combines both sets of results.
 *
 * The module is pure — it takes the acts as a parameter instead of reaching for
 * `allActs()`, so it can be tested without the content bundle.
 */

import type { Act } from './acts';
import {
  MIN_QUERY_LENGTH,
  countHighlights,
  type Mark,
  markedExcerptAt,
  findAtWordStart,
  fold,
  normalize,
  textNodes,
} from './search';
import { applyVersions, dayKey, splitFuture } from './versions';

export interface ActHit {
  kind: 'act';
  act: Act;
  excerpt: string;
  mark: Mark;
  /**
   * How many hits the act can highlight. Zero means "the phrase is there, but can't be
   * marked": it crosses a tag, i.e. a text-node boundary.
   */
  count: number;
  /**
   * The effective date, when the excerpt shown sits in a provision that is **not yet in
   * force** — or null when it's law already in effect.
   *
   * Without this, the results card reported a not-yet-binding provision exactly like a
   * binding one: the date label sits next to the unit in the act's content, and an excerpt
   * around a hit in § 3 of art. 255b has no reason to carry it.
   */
  future: string | null;
}

interface ActText {
  text: string;
  /** The same text after `fold` — kept so it isn't rebuilt on every character of a query. */
  folded: string;
  /** Text nodes after `fold` — exactly what the highlighting script looks through. */
  nodes: string[];
  /**
   * Not-yet-effective provisions, as ranges in `text`: from which character, to which, and
   * from when the provision takes effect. There are as many ranges as such provisions in
   * the act — two in the whole bundle — so checking a hit means scanning a two-element
   * list.
   */
  future: { start: number; end: number; from: string }[];
}

/**
 * An act's text is stripped of markup once and memoized.
 *
 * A `WeakMap` keyed on act objects is enough, since `allActs()` always returns the same
 * objects, and swapping the content bundle creates new ones.
 *
 * A memoized entry carries **the day it was built for**, and that's not decoration: which
 * wording of a provision applies is chosen by date, and the act screen recomputes it on
 * every entry. Without a day key, an app left open across the day a provision takes effect
 * would report a hit count on the results card for a wording the open act no longer
 * shows. The cost is nil: the key changes once a day, not on every character typed — that's
 * the whole reason this cache exists (700 KB of text across all the acts).
 */
const cache = new WeakMap<Act, { day: string; parsed: ActText }>();

export function actText(act: Act): ActText {
  const day = dayKey(new Date());
  const known = cache.get(act);
  if (known && known.day === day) return known.parsed;

  // The same transformation the act screen does when building the page. Without it, the
  // search engine would count hits in a wording the user won't see — or the reverse,
  // stay silent about what's actually in front of them.
  const { html } = applyVersions(act.html, new Date());

  // Nodes are assembled piece by piece, so we know which one belongs to a not-yet-effective
  // provision. Piece boundaries fall on tags anyway, exactly where `textNodes` would end a
  // node regardless — so the split comes out identical to doing it as a whole.
  // Raw nodes go into counting hits, collapsed nodes go into the card's excerpt: the
  // highlighting script sees a node's content as it actually is, so a phrase split by a
  // line break isn't a hit for it and can't be counted.
  const rawNodes: string[] = [];
  const collapsedNodes: string[] = [];
  const future: { start: number; end: number; from: string }[] = [];
  let length = 0;

  for (const part of splitFuture(html)) {
    const nodes = textNodes(part.html);
    if (nodes.length === 0) continue;

    const start = length + (collapsedNodes.length > 0 ? 1 : 0);
    for (const node of nodes) {
      // A space joins the nodes, so every one after the first shifts the text by one
      // character.
      if (collapsedNodes.length > 0) length += 1;
      const collapsed = node.replace(/\s+/g, ' ').trim();
      length += collapsed.length;
      rawNodes.push(node);
      collapsedNodes.push(collapsed);
    }

    if (part.from !== null) future.push({ start, end: length, from: part.from });
  }

  const text = collapsedNodes.join(' ');
  const prepared: ActText = { text, folded: fold(text), nodes: rawNodes.map(fold), future };
  cache.set(act, { day, parsed: prepared });
  return prepared;
}

/**
 * Prepares the texts up front, so the first characters typed don't wait on the parsing.
 *
 * The search screen calls this right after mounting, outside the path that reacts to
 * typing: the cost is a fraction of a second, once per app run, and typing three
 * characters takes longer than that.
 */
export function warmActText(acts: Act[]): void {
  for (const act of acts) actText(act);
}

/**
 * Hits across the acts, in the bundle's order.
 *
 * Deliberately without the hit-count sorting that governs lessons: the Kodeks karny is five
 * times longer than the firearms act, so it would win on sheer length alone even where the
 * relevant provision is about firearms. The bundle's order runs from the statute closest to
 * the course outward.
 */
export function searchActs(acts: Act[], query: string): ActHit[] {
  const needle = normalize(query);
  if (needle.length < MIN_QUERY_LENGTH) return [];

  const hits: ActHit[] = [];
  for (const act of acts) {
    if (!act.html) continue;

    const { text, folded, nodes, future } = actText(act);
    const at = findAtWordStart(folded, needle);
    if (at < 0) continue;

    const { text: excerpt, mark } = markedExcerptAt(text, at, needle.length);
    hits.push({
      kind: 'act',
      act,
      excerpt,
      mark,
      // Keyed off the first hit, since its surroundings are what the card shows. Later hits
      // can land in other units — from there on, navigation happens inside the open act,
      // where the label sits next to the provision.
      future: future.find((range) => at >= range.start && at < range.end)?.from ?? null,
      // The act stays on the list even when the phrase falls across a tag: it really is in
      // there, and the excerpt on the card shows it. The hit count, though, comes from what
      // the script can actually mark — counting on the concatenated text promised "1 hit"
      // on the card, while the open act said "no hits" and the arrows did nothing.
      count: countHighlights(nodes, needle),
    });
  }
  return hits;
}
