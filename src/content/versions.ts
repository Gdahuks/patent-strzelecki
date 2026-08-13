/**
 * Choosing which wording of a provision to show: the current one or the future one.
 *
 * The Sejm Chancellery marks both wordings in the consolidated text, but the bracket only
 * says what was future **on the day the file was generated**. The file can be months older
 * than today — in the Code of Petty Offences, art. 89a has been in force since 3 June 2026,
 * and a file dated as of 5 May still brackets it as future. That's why the decision is made
 * by comparing the date in the note against today's date.
 *
 * The decision is made here, not in the scraper, because the bundle ages on the phone:
 * a bundle built on 20 August would keep showing art. 255b as future long after 23 August.
 *
 * **This is a transformation of the string, not a CSS-based hide**, and that's the single
 * most important thing about this module. The losing variant disappears from the tree,
 * because the "obviously natural" path — keeping both wordings in the document and hiding
 * one with a script — breaks three things at once: `actSearch.actText` calls `textNodes` on
 * the raw string and knows nothing about `display: none`; `collectTextNodes` in
 * `findInPage.ts` only skips `SCRIPT`/`STYLE`/`MARK`, so a hidden node would still get
 * a `mark`; and `scrollIntoView` does nothing on an element with no layout box (a „2 / 5"
 * counter and a blocked arrow), while `jumpTo` takes the **first** element with a given
 * `data-id`.
 *
 * For the same reason, the losing wording ends up inside an **attribute**: `textNodes`
 * cuts at `<[^>]+>`, so it never sees attributes.
 *
 * The module is pure — no React Native imports, `today` injected as a parameter, the same
 * way `random` is in the spaced-repetition engine.
 */

import { decodeEntities, stripHtml } from './search';

/** Above this many characters, a future wording doesn't fit a tooltip and goes to the sheet. */
export const SHEET_THRESHOLD = 250;

const MONTHS = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];

/** A date in Polish: „23 sierpnia 2026". */
export function dateLabel(from: string): string {
  const [year, month, day] = from.split('-');
  const name = MONTHS[Number(month) - 1];
  if (!name || !year || !day) return from;
  return `${Number(day)} ${name} ${year}`;
}

/**
 * Two labels, because they carry two **opposite** messages.
 *
 * Both refer to the same date, and for a long time that made them look the same
 * ("od 19 maja 2028" — "from 19 May 2028"). A real user reading it at art. 15c of the
 * firearms act read it backwards from what it says: "this point I'm looking at now is
 * supposed to apply starting then" — i.e. mistook law currently in force for a provision
 * that has yet to take effect.
 *
 * * `changeLabel` stands next to a provision **in force** that's about to get a different
 *   wording. What's shown beside it is today's law, and that's why it stays plain text —
 *   no italics, no dimming. The label says only: this is going to change.
 * * `startLabel` stands next to a provision that **doesn't exist yet**. There, the whole
 *   text isn't law, so the italics and dimming stay — see `.przyszle-tresc` in the act
 *   screen.
 * * `lapseLabel` stands next to a provision **in force** that will be repealed with nothing
 *   taking its place. Plain text for the same reason as `changeLabel`: up to the given day,
 *   it's law. This is the day before what `cleanup` does after the date, leaving
 *   „(uchylony)" in the unit.
 */
export function changeLabel(from: string): string {
  return `zmieni się ${dateLabel(from)}`;
}

export function startLabel(from: string): string {
  return `wejdzie w życie ${dateLabel(from)}`;
}

export function lapseLabel(from: string): string {
  return `traci moc ${dateLabel(from)}`;
}

/**
 * The wording marker exactly as the scraper emits it (`acts_pdf.split_versions`).
 *
 * `data-poz` is the Chancellery's position number, i.e. the same note — it's the only thing
 * that lets us recognise pieces of a single bracket. It's optional because the bundle on the
 * phone can be older than the code; what happens then is described under `blocks`.
 *
 * The content is "tempered": any character, as long as it's not the start of a `span`
 * marker. A plain non-greedy `[\s\S]*?` would close on an inner `</span>` if the scraper ever
 * nested an element there — the tail of the future wording would then leak into the
 * visible text **as law currently in force**, and the orphaned `</span>` would close
 * someone else's element. No error, no trace. A pattern written this way simply won't match
 * a marker like that, and `warnIfUncovered` will notice.
 */
const WORDING_MARKER = new RegExp(
  '<span class="wersja (wersja-do|wersja-od)" data-od="(\\d{4}-\\d{2}-\\d{2})"' +
    '(?: data-poz="(\\d+)")?>((?:(?!</?span)[\\s\\S])*?)</span>',
  'g',
);

/**
 * The opening of a wording marker — for counting how many the pattern failed to cover.
 *
 * Deliberately looser than `WORDING_MARKER`: the class can stand in any order and with any
 * attributes next to it. This means the guard also counts markers the pattern failed to
 * recognise **because the class order changed** — exactly the ones that a stricter count
 * would let pass silently, since they'd be missing on both sides of the comparison.
 */
const WORDING_MARKER_OPEN = /<span[^>]*\bwersja\b[^>]*>/g;

/** A unit's opening tag, exactly as `_zloz` assembles it in the scraper. */
const UNIT_OPEN = '<div class="unit ';

const DIV = /<div\b[^>]*>|<\/div>/g;

interface Marker {
  start: number;
  end: number;
  kind: string;
  from: string;
  /** The Chancellery's position number, or null when the bundle predates stamping. */
  pos: string | null;
  content: string;
}

/**
 * Today's date in the bundle's own format, computed **locally**.
 *
 * `toISOString` would give the UTC day, and a provision's entry into force is a calendar
 * date: before midnight Polish time it would show a wording a full day late.
 *
 * Exported because the day is a **key** into `applyVersions`'s result: search caches the
 * folded text of an act and needs to know which day it was folded for.
 */
export function dayKey(today: Date): string {
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

/**
 * An attribute value with no way of being cut off halfway through.
 *
 * Like `escapeAttribute` in `glossaryScript.ts`, plus line breaks: a provision spread over
 * several units goes into the sheet paragraph by paragraph, and a literal newline in an
 * attribute is at the mercy of the parser's own normalization.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;');
}

/**
 * A marker's content as plain text.
 *
 * Deliberately not through `stripHtml`: that joins nodes with a space, so a footnote
 * reference used to come out as „nowe 1)" instead of „nowe1)" — in legal text, that shows
 * immediately.
 */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether there's actual content between two markers, or just tags and whitespace. */
function hasText(fragment: string): boolean {
  return stripHtml(fragment).length > 0;
}

function markers(html: string): Marker[] {
  const results: Marker[] = [];
  WORDING_MARKER.lastIndex = 0;

  let found = WORDING_MARKER.exec(html);
  while (found !== null) {
    results.push({
      start: found.index,
      end: found.index + found[0].length,
      kind: found[1],
      from: found[2],
      pos: found[3] ?? null,
      content: found[4],
    });
    found = WORDING_MARKER.exec(html);
  }
  return results;
}

/**
 * Markers assembled into blocks — one block is one Chancellery bracket.
 *
 * A block can cross a unit boundary (the bracket at art. 255b of the Penal Code opens
 * before the article's heading and runs through fifteen fragments), and the scraper then
 * closes the marker at the end of one fragment and reopens it in the next. We glue them
 * back together **by the position stamp**, never by date and adjacency alone: a single
 * amendment gives all its changes the same date, so a changed provision sitting next to
 * an added one would look like a single bracket — and then the added one's content would
 * land as the "new wording" of the previous one and vanish from the text.
 *
 * A bundle from before stamping (`data-poz` empty) produces single-marker blocks and no
 * pairing at all. That's a deliberate choice: it means both wordings stay visible, each
 * future one with its own date next to it. The degradation is then visible to the naked
 * eye, rather than relying on guessing which wording replaces which.
 */
function blocks(items: Marker[]): Marker[][] {
  const groups: Marker[][] = [];

  for (const marker of items) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    const continuation =
      previous !== undefined &&
      previous.pos !== null &&
      previous.pos === marker.pos &&
      previous.kind === marker.kind;

    if (current && continuation) current.push(marker);
    else groups.push([marker]);
  }
  return groups;
}

/**
 * The whole block's content, for showing in a tooltip or a sheet.
 *
 * The unit's number sits on the same line as its content, just like in the act's text —
 * separated by `</h3>`. The boundary between paragraphs is kept as a line break, since in
 * the sheet those are separate paragraphs of the provision.
 */
function blockText(block: Marker[], html: string): string {
  let out = plainText(block[0].content);
  for (let i = 1; i < block.length; i += 1) {
    const between = html.slice(block[i - 1].end, block[i].start);
    out += (between.includes('</h3>') ? ' ' : '\n') + plainText(block[i].content);
  }
  return out;
}

/**
 * A reference to a wording that isn't in force yet: a tooltip or a sheet handle.
 *
 * Stands **inline, right after the content of the unit it refers to** — not wherever the
 * consolidated text happens to place the new wording. A Chancellery bracket covers a unit
 * together with its number, so the new wording of point 1 is a separate unit under the
 * same number: a label inserted in its place used to land on an empty line **between**
 * point 1 and point 2, and looked like a caption for the whole provision, or the heading of
 * the next one.
 */
function reference(from: string, content: string, nested: boolean): string {
  const label = changeLabel(from);
  // A whole article of the code doesn't fit a tooltip, and a provision spread across
  // several units is an article by definition — the length of a single paragraph means
  // nothing there.
  const sheet = nested || content.length > SHEET_THRESHOLD;
  const value = escapeAttribute(content);

  if (sheet) {
    // `role` and `aria-label`, because the sheet is the **only** way to reach the new
    // wording: a marker with no role is announced by a screen reader as an abbreviation,
    // i.e. something you don't tap. No `tabindex` — the CLAUDE.md warning about the focus
    // ring is about SVG, not `abbr`.
    const description = `${label} — dotknij, aby zobaczyć nowe brzmienie`;
    return (
      `<abbr class="przyszle-arkusz" role="button" data-od="${from}" data-przyszle="${value}"` +
      ` aria-label="${escapeAttribute(description)}" title="${escapeAttribute(description)}">` +
      `<sup>${label}</sup></abbr>`
    );
  }

  // `data-def` and `data-term` are handled by `glossaryScript`, the same one that shows
  // abbreviations and footnotes. `title` repeats the content, because a screen reader reads
  // it straight off the `abbr` on its own, without the gesture that tapping the tooltip
  // would require anyway.
  return (
    `<abbr class="skrot przyszle" data-od="${from}" data-term="${escapeAttribute(label)}"` +
    ` data-def="${value}" data-przyszle="${value}" title="${escapeAttribute(`${label} — ${content}`)}">` +
    `<sup>${label}</sup></abbr>`
  );
}

/**
 * An announcement of a repeal with no replacement — just the label, with no handle.
 *
 * Stands where `reference` does: inline, right after the content of the unit it refers to.
 * There's exactly one difference, and it follows directly from what this state actually is
 * — **nothing opens here**. `reference` leads to a new wording, because such a wording
 * exists; on a repeal with no replacement there's nothing to show, and a handle that does
 * nothing when tapped, or opens an empty sheet, reads like it's broken. Hence a plain
 * `<sup>`: no `role`, no `aria-label`, because a screen reader is meant to announce exactly
 * what's visible here.
 *
 * The date sits in an attribute, even though it's already in the label's text — it's the
 * only thing the unit index (`futureUnits`) uses to recognise this state; parsing the Polish
 * date back apart into `2028-05-19` would be a second parser for the same thing.
 */
function lapseMarker(from: string): string {
  return `<sup class="przyszle-moc" data-od="${from}">${lapseLabel(from)}</sup>`;
}

/**
 * A warning about a marker the pattern failed to cover.
 *
 * The scraper is meant to be loud, and the app side of the same contract can't stay silent
 * either. We don't throw here: this is a wording-selection path, so a crash would take out
 * the whole act instead of a single provision. An uncovered marker is left in the document
 * exactly as it was — meaning both wordings stay visible, neither disappears, and neither
 * pretends to be in force.
 *
 * Who is this warning for? Not the user's: `acts.json` is `require`d from the app's own
 * bundled assets, there's no over-the-air update, so the bundle on the phone is always the
 * one the code was built with. Only someone who changes one side of the contract without
 * rebuilding the other can cause a mismatch — and then the warning shows up in Metro and in
 * `logcat`. The guard against a green run despite that is the test over the real bundle in
 * `versions.package.test.ts`.
 */
function warnIfUncovered(html: string, covered: number): void {
  WORDING_MARKER_OPEN.lastIndex = 0;
  const total = html.match(WORDING_MARKER_OPEN)?.length ?? 0;
  if (total === covered) return;

  console.warn(
    `applyVersions: recognised ${covered} of ${total} wording markers. ` +
      'The marker layout in the bundle has changed — provisions that were not recognised ' +
      'show both wordings at once.',
  );
}

interface Removed {
  /** Offset in the result, at the spot left after the content was removed. */
  at: number;
  /** Whether this wording has a replacement — i.e. whether the bracket had a matching pair. */
  paired: boolean;
  /**
   * The unit's number: the content of the bracket's first part, since it covers the heading
   * too.
   */
  number: string;
}

/**
 * Units left with nothing in them after a wording has been chosen.
 *
 * A Chancellery bracket covers a unit together with its number, so a pair of wordings is, in
 * the finished document, **two units sharing the same `data-id`** — point 1 in art. 15c of
 * the firearms act looks exactly like that. Once the change takes effect, the first of them
 * becomes an empty shell, and `jumpTo` takes the first matching element: a jump from
 * a question's legal basis would land on emptiness, with the provision in force sitting
 * below the fold.
 *
 * Whether to remove the shell is decided by **the pair found through the stamp**, never by
 * the presence of the same `data-id` somewhere else. Sub-unit identifiers repeat in every
 * article (`pint_1` shows up in art. 7 and in art. 8), so looking for them in the document
 * answered "has a replacement" almost always — and a point repealed with no replacement
 * used to vanish entirely, leaving an article that starts at „2)". The same criterion got
 * it wrong for a replacement taking effect later than the repeal: between one date and the
 * other, only the wording not yet in force was left standing.
 *
 * Without a pair, the unit is left with its number and „(uchylony)" — that's how the
 * official text reads it, and a jump from the index has somewhere to land. The number comes
 * from the bracket's first part: this branch is only reachable when nothing at all was left
 * in the unit, i.e. when the heading, too, was inside the bracket.
 */
function cleanup(html: string, removed: Removed[]): string {
  if (removed.length === 0) return html;

  const stack: { start: number; openTag: string; isUnit: boolean }[] = [];
  const ranges: { start: number; end: number; openTag: string; taken: Removed }[] = [];

  DIV.lastIndex = 0;
  let token = DIV.exec(html);
  while (token !== null) {
    if (token[0] === '</div>') {
      const open = stack.pop();
      const end = token.index + token[0].length;
      // The first removed content in this unit — the one that carried its number.
      const taken = open
        ? removed.find((entry) => entry.at >= open.start && entry.at <= end)
        : undefined;

      if (open?.isUnit && taken && !hasText(html.slice(open.start, end))) {
        ranges.push({
          start: open.start,
          end,
          openTag: open.openTag,
          taken,
        });
      }
    } else {
      stack.push({
        start: token.index,
        openTag: token[0],
        isUnit: token[0].startsWith(UNIT_OPEN),
      });
    }
    token = DIV.exec(html);
  }

  if (ranges.length === 0) return html;

  let out = '';
  let cursor = 0;
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    // A unit nested inside an empty unit disappears along with it — the ranges overlap,
    // so we only keep the outer one.
    if (range.start < cursor) continue;

    // The heading is a sibling of `unit-inner`, not its child — that's how the scraper
    // assembles a unit, and it's what lets the act sheet pull a sub-unit's number onto the
    // same line as its content.
    const heading = range.taken.number ? `<h3>${range.taken.number}</h3>` : '';
    const repealedHtml =
      `${range.openTag}${heading}` +
      '<div class="unit-inner"><div class="pro-text">(uchylony)</div></div></div>';

    out += html.slice(cursor, range.start) + (range.taken.paired ? '' : repealedHtml);
    cursor = range.end;
  }
  return out + html.slice(cursor);
}

/** The marker for a provision that stands in the text but isn't in force yet. */
const FUTURE_CONTENT = /<span class="przyszle-tresc" data-od="(\d{4}-\d{2}-\d{2})">/;

/** The same marker together with its content — for checking what's left in the unit beyond it. */
const FUTURE_CONTENT_SPAN =
  /<span class="przyszle-tresc" data-od="\d{4}-\d{2}-\d{2}">[\s\S]*?<\/span>/g;

/**
 * What's coming for a unit: a change of wording, an entry into force, or a lapse.
 *
 * The distinction exists here for the same reason as `changeLabel` and `startLabel` — the
 * unit index is a second surface where the article is visible, and one label for two
 * opposite states used to read backwards from what it actually meant.
 */
export interface FutureUnit {
  from: string;
  kind: 'zmiana' | 'nowy' | 'moc';
}

/** The index row's label — the very same one shown inline next to the provision in the text. */
export function unitLabel(unit: FutureUnit): string {
  if (unit.kind === 'nowy') return startLabel(unit.from);
  if (unit.kind === 'moc') return lapseLabel(unit.from);
  return changeLabel(unit.from);
}

export interface AppliedVersions {
  html: string;
  /**
   * Index units carrying a date: `data-id` → what and when.
   *
   * The act screen has what it needs to attach the same label to the index row. Without
   * this, the index used to present a provision not yet in force exactly like one that is,
   * and said nothing at all about a change in wording.
   */
  units: Map<string, FutureUnit>;
}

/**
 * The document cut into binding and non-binding pieces, in order.
 *
 * Needed by search: a piece's boundary falls exactly on a marker, which is where
 * `textNodes` ends a text node anyway. That means gluing the nodes from successive pieces
 * back together gives **exactly** the same split as `textNodes` would for the whole
 * document, and along the way it's known which node belongs to a provision not yet in
 * force. Without this, the results card has no way to tell a hit in law currently in force
 * apart from a hit in a provision-in-waiting.
 */
export function splitFuture(html: string): { html: string; from: string | null }[] {
  const parts: { html: string; from: string | null }[] = [];
  let rest = html;

  for (;;) {
    const found = FUTURE_CONTENT.exec(rest);
    if (!found) break;

    const end = rest.indexOf('</span>', found.index);
    if (end < 0) break;

    parts.push({ html: rest.slice(0, found.index), from: null });
    parts.push({
      html: rest.slice(found.index + found[0].length, end),
      from: found[1],
    });
    rest = rest.slice(end + '</span>'.length);
  }

  parts.push({ html: rest, from: null });
  return parts;
}

/** The label with the date, attached to the first part of a provision-in-waiting. */
const FUTURE_DATE_LABEL = /<sup class="przyszle-data">[\s\S]*?<\/sup>/g;

/** A reference to a future wording — a tooltip or a sheet handle, both carrying a date. */
const REFERENCE_MARKER = /<abbr class="[^"]*przyszle[^"]*"[^>]*data-od="(\d{4}-\d{2}-\d{2})"/g;

/** An announcement of a repeal with no replacement — see `lapseMarker`. */
const LAPSE_MARKER = /<sup class="przyszle-moc" data-od="(\d{4}-\d{2}-\d{2})"/g;

/**
 * The kinds of units that make it into the index (`acts.build_index`).
 *
 * The label only gets attached to these, because only they have a row of their own in the
 * index. Points and sub-paragraphs drop out: the change in art. 15c of the firearms act
 * lives in point 1, and the index has a row for the article — a label attached to the
 * point would have nowhere to show up.
 *
 * A paragraph (`§`) is in the index only when it's a top-level unit, i.e. in a regulation.
 * In an act, `§` is a sub-unit of an article and doesn't go into the index — that's exactly
 * how `build_index` splits them, and exactly why identifiers like `para_1` repeat in the
 * code at every article.
 */
const INDEXED_KINDS = ['unit_part', 'unit_chpt', 'unit_arti'];

/**
 * Index units that carry a date — and what that date means.
 *
 * Two sources, one pass over the document:
 *
 * * **provision-in-waiting** (`nowy`) — a unit that holds **only** content not yet in
 *   force. The word "only" matters: chapter XXXII of the Penal Code contains art. 255b, so
 *   "contains a provision-in-waiting" on its own would date-stamp the whole chapter, and
 *   above it the whole special part of the code — in the index it would look like an
 *   announcement that half the code stops being in force come August;
 * * **an announced change of wording** (`zmiana`) and **an announced repeal** (`moc`) —
 *   a unit that holds a reference to a new wording, or a lapse label. Here we take the
 *   **deepest index unit**, i.e. the article, not the chapter above it: the announcement
 *   gets "claimed" by the first such unit to close, and units close from the inside out.
 */
function futureUnits(html: string): Map<string, FutureUnit> {
  const units = new Map<string, FutureUnit>();
  const stack: { start: number; openTag: string; isUnit: boolean }[] = [];

  const announcements: { at: number; from: string; kind: 'zmiana' | 'moc'; claimed: boolean }[] = [];
  for (const [pattern, kind] of [
    [REFERENCE_MARKER, 'zmiana'],
    [LAPSE_MARKER, 'moc'],
  ] as const) {
    pattern.lastIndex = 0;
    for (let found = pattern.exec(html); found !== null; found = pattern.exec(html)) {
      announcements.push({ at: found.index, from: found[1], kind, claimed: false });
    }
  }
  // Document order, because a unit's label is decided by whichever announcement stands
  // first inside it — and they're gathered in two passes, one per pattern.
  announcements.sort((a, b) => a.at - b.at);

  DIV.lastIndex = 0;
  let token = DIV.exec(html);
  while (token !== null) {
    if (token[0] === '</div>') {
      const open = stack.pop();
      const end = token.index;
      if (open?.isUnit) {
        const inside = html.slice(open.start, end);
        const ref = /data-id="([^"]*)"/.exec(open.openTag)?.[1] ?? '';
        const inIndex =
          INDEXED_KINDS.some((kind) => open.openTag.includes(kind)) ||
          (open.openTag.includes('unit_para') &&
            !stack.some((higher) => higher.openTag.includes('unit_arti')));

        // The claiming step stands **outside** the `data-id` condition: an index unit with
        // no identifier has no row in the index for a label to stand on, so letting its
        // announcement float upward saves nothing — it would just date-stamp the chapter,
        // and above it the part.
        if (inIndex) {
          // The announcement gets "claimed" by the first index unit to close, i.e. the
          // deepest one — the article, not the chapter above it. We claim **all** of them
          // within range, not just the first: one article can have two changed units (two
          // Chancellery brackets, two positions), and then the extra announcement used to
          // float upward and get scooped up by the chapter, and above that the code's part.
          const ours = announcements.filter(
            (entry) => !entry.claimed && entry.at >= open.start && entry.at < end,
          );
          for (const entry of ours) entry.claimed = true;

          const from = FUTURE_CONTENT.exec(inside)?.[1];
          // Whether any content besides the provision-in-waiting was left in this unit.
          const binding = hasText(
            inside.replace(FUTURE_CONTENT_SPAN, '').replace(FUTURE_DATE_LABEL, ''),
          );

          // First entry wins: `data-id` can repeat within an act, and the index then shows
          // one row for it — the first one. Same for two announcements inside one unit: the
          // row is singular, so the label speaks about whichever comes first in the
          // article.
          if (ref && !units.has(ref)) {
            if (from && !binding) units.set(ref, { from, kind: 'nowy' });
            else if (ours[0]) units.set(ref, { from: ours[0].from, kind: ours[0].kind });
          }
        }
      }
    } else {
      stack.push({
        start: token.index,
        openTag: token[0],
        isUnit: token[0].startsWith(UNIT_OPEN),
      });
    }
    token = DIV.exec(html);
  }
  return units;
}

const NO_FUTURE_UNITS: Map<string, FutureUnit> = new Map();

export function applyVersions(html: string, today: Date): AppliedVersions {
  const found = markers(html);
  if (found.length === 0 && !html.includes('<span class="wersja ')) {
    return { html, units: NO_FUTURE_UNITS };
  }

  warnIfUncovered(html, found.length);
  if (found.length === 0) return { html, units: NO_FUTURE_UNITS };

  const todayKey = dayKey(today);
  const grouped = blocks(found);
  const replacements = new Map<number, string>();
  // Whether a block has a pair sharing the same stamp — the one and only way we recognise
  // a replacement.
  const descriptors = new Map<number, Omit<Removed, 'at'>>();

  /** The other half of the bracket: the same stamp, the opposite class — or null. */
  const pairOf = (index: number): Marker[] | null => {
    const { pos, kind } = grouped[index][0];
    if (pos === null) return null;
    return (
      [grouped[index - 1], grouped[index + 1]].find(
        (neighbor) =>
          neighbor !== undefined && neighbor[0].pos === pos && neighbor[0].kind !== kind,
      ) ?? null
    );
  };

  grouped.forEach((block, index) => {
    const { from, kind } = block[0];
    const inForce = from <= todayKey;
    const pair = pairOf(index);

    if (kind === 'wersja-do') {
      // The current wording disappears only once the new one has taken effect. Without
      // a pair (a provision repealed with no replacement), it behaves the same way: it
      // stands until its day.
      for (const part of block) {
        replacements.set(part.start, inForce ? '' : part.content);
        if (inForce) {
          descriptors.set(part.start, {
            paired: pair !== null,
            number: plainText(block[0].content),
          });
        }
      }

      // The label goes at the end of the **last** part of the current wording, i.e.
      // inline right after the content of the unit it refers to. The new wording stands
      // separately in the document, under the same number — a label placed there used to
      // look like the heading of the next point.
      //
      // Without a pair, the label is needed even more: a provision repealed with no
      // replacement used to carry **no** signal at all, so a reader took for permanent law
      // something that would stop being in force in six months. After the date, this spot
      // is left with „(uchylony)" via `cleanup` — that's exactly the other half of the
      // same sentence.
      if (!inForce) {
        const last = block[block.length - 1];
        replacements.set(
          last.start,
          last.content +
            (pair
              ? reference(from, blockText(pair, html), pair.length > 1)
              : lapseMarker(from)),
        );
      }
      return;
    }

    if (inForce) {
      for (const part of block) replacements.set(part.start, part.content);
      return;
    }

    if (!pair) {
      // A unit added that isn't in force yet (Penal Code art. 255b, Code of Petty
      // Offences art. 89a). It stays visible, marked with a date: hiding it would put the
      // unit index out of sync with the text, since a jump from the index would land on
      // nothing. **Every** part carries the class, because the signal distinguishing this
      // provision from ones in force can't be limited to just the first paragraph.
      block.forEach((part, position) => {
        const content = `<span class="przyszle-tresc" data-od="${from}">${part.content}</span>`;
        replacements.set(
          part.start,
          position === 0 ? `${content}<sup class="przyszle-data">${startLabel(from)}</sup>` : content,
        );
      });
      return;
    }

    // The future wording leaves the text entirely: the label has already been placed by
    // the current half, and `cleanup` cleans up units left with nothing after that.
    // Leaving them would leave a second `data-id` for the same unit, i.e. a jump landing on
    // an empty shell.
    for (const part of block) {
      replacements.set(part.start, '');
      descriptors.set(part.start, { paired: true, number: '' });
    }
  });

  let result = '';
  let cursor = 0;
  const removed: Removed[] = [];
  for (const part of found) {
    const replacement = replacements.get(part.start) ?? part.content;
    result += html.slice(cursor, part.start);
    // Spots left after removed content — they're the only ones that can leave an empty
    // unit behind, so the cleanup only checks their surroundings. Without this, every act
    // would pay for it on every single open, and 890 KB for the Penal Code isn't a price
    // worth paying for nothing.
    const descriptor = descriptors.get(part.start);
    if (replacement === '' && part.content !== '' && descriptor) {
      removed.push({ at: result.length, ...descriptor });
    }
    result += replacement;
    cursor = part.end;
  }
  result += html.slice(cursor);

  const ready = cleanup(result, removed);
  return {
    html: ready,
    // A pass over the document isn't free, and 890 KB for the Penal Code isn't a price to
    // pay for nothing: an act with not a single future marker has nothing to compute.
    units: ready.includes('przyszle') ? futureUnits(ready) : NO_FUTURE_UNITS,
  };
}
