/**
 * Legal acts: statutes and regulations that questions' legal bases point to.
 *
 * Texts are loaded **lazily** — they add up to almost 700 KB together, and aren't needed
 * until the act screen is opened. Loading them at startup would slow down launching the
 * app for no reason.
 */

import { fold } from './search';

export interface ActIndexEntry {
  /** The unit's identifier in the content, e.g. `arti_15` — the act screen jumps to it. */
  ref: string;
  title: string;
  /**
   * The unit's level: code part, chapter (also section and subsection — they share a
   * level, distinguished by the `ref` prefix), article, paragraph.
   */
  kind: 'part' | 'chpt' | 'arti' | 'para';
  /** The start of the unit's text — the bare article number says nothing on its own. */
  hint: string;
}

export interface Act {
  slug: string;
  short: string;
  /** The document's name in the course's legal-basis citations, e.g. „UoBiA". */
  lawPrefix: string;
  /**
   * Other spellings of the same name, **by word stem**: the course cites one document
   * several ways ("ws przewożenia" versus "w sprawie przewożenia", "wzorcowego
   * regulaminu bezpiecznego funkcjonowania strzelnic" versus "Wzorcowy regulamin
   * strzelnic"). A stem, not the full word, because the name inflects by grammatical case.
   */
  lawNames: string[];
  /**
   * The act that a basis naming only the article ("art. 23 ust. 1") belongs to.
   * Exactly one entry in the bundle has this set — the statute the course is built
   * around.
   */
  lawDefault: boolean;
  eli: string;
  title: string;
  status: string;
  /**
   * The "as of" date for the text being shown: for a consolidated text, the document's
   * own declaration; for registry HTML, the announcement date. Never the registry's
   * `changeDate` — that's a record-keeping marker, and for a March 2024 announcement it
   * reads 2026. The field appears in the UI as „stan na" ("as of"), so its meaning follows
   * the content, not whatever the API happens to call it.
   *
   * **Empty when `html` is empty**: with no text there's nothing to make a claim about,
   * and the screen has no right to assert something it doesn't know. Don't show it outside
   * the `isReadable` branch.
   */
  changed: string;
  /** Empty when we don't have this item as text. */
  html: string;
  /** Source address — used when we don't have the text. */
  url: string;
  /**
   * Journal-of-laws entries absorbed into the text being shown: the consolidated text plus
   * the amendments applied to it. Empty for items available only as scans.
   */
  sources: string[];
  /**
   * For an act with text: amendments that this wording does **not** cover (drift).
   * For an item with no text: the complete set of amending acts that make up the list of
   * documents to open in the browser. The field's two meanings are deliberate — `isReadable`
   * tells them apart.
   */
  amendments: { eli: string; url: string; date: string }[];
  /**
   * Documents to open in the browser for an item that isn't an act from the Sejm registry,
   * so there's no base-act-plus-amendments list to build. Today this is only the ISSF
   * rules: chapters in the PZSS Judges' Committee's translation plus the full English set.
   *
   * Empty means the scraper failed to read the list off the page, and the item was left
   * with just a link to the listing — see `sourceDocuments`.
   */
  documents: ActDocument[];
  index: ActIndexEntry[];
}

/** An entry in the document list: a name and an address. */
export interface ActDocument {
  /**
   * The name as the source names the document ("Pistolet (8)"). Not "Pobierz" and not
   * "1. dokument": the list has to let you pick the right chapter without opening each one.
   */
  label: string;
  url: string;
}

/**
 * How many amendments didn't make it into the text being shown.
 *
 * A separate function rather than `act.amendments.length` inline in the screen: the bundle
 * on the phone can be older than the code, and a missing field would crash the whole table
 * of contents.
 */
export function driftCount(act: Act): number {
  return act.amendments?.length ?? 0;
}

/** Absorbed entries, in the notation the Dziennik Ustaw itself uses. */
export function sourceLabels(act: Act): string[] {
  return (act.sources ?? []).map((eli) => {
    const found = /^DU\/(\d{4})\/(\d+)$/.exec(eli);
    // We don't guess at a notation we don't recognise: the raw identifier is better than a
    // pretty label pointing at the wrong document.
    return found ? `Dz.U. ${found[1]} poz. ${found[2]}` : eli;
  });
}

let cache: Act[] | null = null;

/** Loads the acts on first use, not at app startup. */
export function allActs(): Act[] {
  if (cache === null) {
    cache = require('../../assets/content/acts.json') as Act[];
  }
  return cache;
}

export function findAct(slug: string): Act | undefined {
  return allActs().find((act) => act.slug === slug);
}

/** An act can be read inside the app only when we have its text. */
export function isReadable(act: Act): boolean {
  return act.html.length > 0;
}

/**
 * Documents for an item we don't have as text — in the order to show them.
 *
 * The list has two sources, because textless items come in two kinds, and that distinction
 * lives in the bundle, not here:
 *
 * * **an act from the Sejm registry** available only as a scan — we build the list from
 *   the base act and its amendments, since a single link would show the original wording
 *   and stay silent about the changes;
 * * **an item outside the registry** (the ISSF rules) — the bundle carries the list itself,
 *   since it's made up of separate files with no "base and amending" relationship linking
 *   them.
 *
 * The order stays as it came from the source. There's deliberately no sorting: for scans,
 * amendment numbering is chronological, while for the ISSF rules, the order from the PZSS
 * site carries the chapter numbers.
 */
export function sourceDocuments(act: Act): ActDocument[] {
  const own = act.documents ?? [];
  if (own.length > 0) return own;

  const url = sourceUrl(act);
  if (!url) return [];

  return [
    { label: 'Akt bazowy', url },
    ...(act.amendments ?? []).map((amendment, position) => ({
      label: `${position + 1}. nowelizacja${amendment.date ? ` · od ${amendment.date}` : ''}`,
      url: amendment.url,
    })),
  ];
}

/**
 * Whether an item needs a document-list screen.
 *
 * A single document isn't a choice — a list screen with one entry would just be a page on
 * the way to the same file, so we open that one straight into the browser instead.
 */
export function needsSourceList(act: Act): boolean {
  return !isReadable(act) && sourceDocuments(act).length > 1;
}

/**
 * Address to open in the browser for items we don't have as text.
 *
 * The address comes exclusively from the bundle. There used to be a fallback here that
 * assembled an ISAP address from the ELI identifier, and it was wrong: the journal-of-laws
 * issue number doesn't follow from the ELI, so for the firearms act it produced
 * "WDU19990549549" instead of "WDU19990530549" — a document that doesn't exist in the
 * registry. The code was dead anyway (every act in the bundle has a `url`), and the test
 * was enshrining the wrong address as correct.
 */
export function sourceUrl(act: Act): string {
  return act.url;
}

/**
 * Items with no text in the app — one per document.
 *
 * The list on the main screen is a list of **documents**, not a list of legal bases: one
 * document can have two entries in the bundle, because the course cites it under two
 * names, and each entry carries one `lawPrefix`. Without merging by address, that would
 * show two cards opening the same thing, which reads like a bug.
 *
 * The ISSF rules used to be exactly that case, cited once as „Skrócone dane regulaminowych
 * ograniczeń broni" and once as „Ogólne przepisy techniczne ISSF" — and it got **resolved
 * in the bundle**, twice in a row. First by merging them into one entry with two names;
 * then it turned out this wasn't one document at all: the first name is the title of an
 * actual table that the course authors publish themselves, so today these are two separate
 * items with two addresses, each with its own questions. The merging here stays in place as
 * a guard — a document cited under two names will come back sooner than a reason to show it
 * twice.
 *
 * Jumps from a question's legal basis aren't affected by this: `resolveLaw` lands on the
 * right entry, and entries merged here share the same address anyway.
 */
export function externalActs(acts: Act[] = allActs()): Act[] {
  const seen = new Set<string>();
  return acts.filter((act) => {
    if (isReadable(act)) return false;
    const url = sourceUrl(act);
    // An item with no address isn't a duplicate of any other one — merging on emptiness
    // would swallow unrelated entries.
    if (!url) return true;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

export interface LawTarget {
  slug: string;
  /** The unit to scroll to, or null when the basis doesn't point at a specific one. */
  ref: string | null;
  readable: boolean;
}

/**
 * Words from a legal basis or a document name: letters and digits only, run through `fold`.
 *
 * This makes „przewożenia" and „przewozenia" the same word, and makes a comma or a "§"
 * between words irrelevant.
 */
function words(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** Whether every stem of the name sits at the start of some word in the basis. */
function nameMatches(stems: string[], lawWords: string[]): boolean {
  return stems.every((stem) => lawWords.some((word) => word.startsWith(stem)));
}

/**
 * Words the course uses to describe a unit — everything besides the document's name.
 *
 * „rozdz." is **deliberately not here**: „Rozdział 1 ust. 2" without a document name
 * belongs to the model firing-range regulations, not to the statute, and guessing that
 * would be wrong.
 */
const UNIT_WORDS = new Set(['art', 'ust', 'pkt', 'lit']);

/**
 * Whether a basis names only the article, with no document ("art. 23 ust. 1").
 *
 * Article only: a paragraph with no name ("§ 4 ust. 1") would belong to a regulation, and
 * the course cites several of those with nothing to decide which one by. After a "§" there
 * is anyway no word left, so such a basis drops out of here on its own.
 */
function isBareArticle(lawWords: string[]): boolean {
  return (
    lawWords.includes('art') &&
    lawWords.every((word) => UNIT_WORDS.has(word) || /^\d+[a-z]?$/.test(word))
  );
}

/**
 * Words that **name the document** — no conjunctions, no unit markers.
 *
 * Three letters is the threshold against "w", "i", "ws": words that short would match the
 * start of almost anything, since matching goes by stem. Unit markers are excluded
 * separately, because "ust." is three letters long and sits at the start of the word
 * "ustawa".
 */
function namingWords(text: string): string[] {
  return words(text).filter((word) => word.length >= 3 && !UNIT_WORDS.has(word));
}

/**
 * The target's name for the legal-basis affordance — or null when the basis already
 * carries it.
 *
 * The affordance used to say „źródło ↗" for **every** textless item in the app, but the
 * name the course cites a document under can fail to be the name of its target: „Skrócone
 * dane regulaminowych ograniczeń broni" opened the „Przepisy ISSF" card with seven
 * documents, and **none** of them was named the way the label promised.
 *
 * That particular case is gone now — it turned out to be the title of a real table that
 * the course authors themselves publish, so the basis got its own item and the label went
 * back to „źródło ↗" with no exception left. The rule stays anyway: solving it through a
 * bundle entry requires the document to exist, and the next basis named in its own way
 * might not be so lucky. `acts.package.test.ts` verifies that, today, none of them need it.
 *
 * The rule: we show the target's name only when the basis shares **not a single word**
 * with it. A shared word means the user will recognise the target in what they're already
 * reading, and the name would just repeat it — „Ogólne zasady bezpieczeństwa w strzelectwie
 * §3 pkt 7" leads to „Zasad bezpieczeństwa PZSS", and adding their name would be pure noise.
 *
 * Words are compared by stem, in both directions ("przewożenia" against "przewożenie"),
 * since a basis inflects the document's name by grammatical case. This is the same rule
 * `nameMatches` and content search rest on — there is no exception list here, and there
 * shouldn't be one.
 */
export function sourceName(law: string, act: Act): string | null {
  const lawWords = namingWords(law);
  return namingWords(act.short).some((name) =>
    lawWords.some((word) => word.startsWith(name) || name.startsWith(word)),
  )
    ? null
    : act.short;
}

/**
 * Translates a question's legal basis into an act and a unit.
 *
 * The course writes it loosely: "UoBiA - Art. 15 ust. 2", "KK - Art. 263, § 2",
 * "Wzorcowy regulamin strzelnic - rozdz. 3, ust. 4" — but also starting from the unit,
 * with the document's name only in the middle: "§8 ust. 1 rozporządzenia w sprawie
 * przechowywania, noszenia oraz ewidencjonowania broni i amunicji". That's why we search
 * for the name **across the whole basis**, not just at its start: matching from the start
 * left 30 questions without a target even though they point to documents the app has.
 *
 * A name matches when every one of its stems sits at the start of some word in the basis —
 * order doesn't matter, since the course writes both "noszenia i przechowywania" and
 * "przechowywania, noszenia". The longest matching name wins, so a spelling that matches
 * two entries lands on the one it describes more precisely.
 */
export function resolveLaw(law: string, acts: Act[] = allActs()): LawTarget | null {
  const text = law.trim();
  if (!text) return null;

  const lawWords = words(text);
  let match: Act | null = null;
  let best = 0;

  for (const act of acts) {
    for (const name of [act.lawPrefix, ...(act.lawNames ?? [])]) {
      const stems = name ? words(name) : [];
      if (stems.length === 0 || !nameMatches(stems, lawWords)) continue;
      const score = stems.reduce((sum, stem) => sum + stem.length, 0);
      // Strictly greater, so a tie is won by the entry earlier in the bundle — the same on
      // both sides of the rule.
      if (score > best) {
        best = score;
        match = act;
      }
    }
  }

  // A basis with no document name belongs to the statute the course is built around.
  if (!match && isBareArticle(lawWords)) {
    match = acts.find((act) => act.lawDefault) ?? null;
  }

  if (!match) return null;

  // A statute's article or a regulation's paragraph. The number may carry a letter ("15a").
  const article = /\bart\.?\s*(\d+[a-z]?)/i.exec(text);
  const paragraph = /§\s*(\d+[a-z]?)/.exec(text);

  let ref: string | null = null;
  if (article) ref = `arti_${article[1].toLowerCase()}`;
  else if (paragraph) ref = `para_${paragraph[1].toLowerCase()}`;

  // There's no point looking in the content for a unit that isn't in the index.
  if (ref && !match.index.some((entry) => entry.ref === ref)) ref = null;

  return { slug: match.slug, ref, readable: isReadable(match) };
}
