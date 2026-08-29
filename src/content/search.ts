/**
 * Search over questions and lessons.
 *
 * No index — scanning 656 questions and 11 lessons takes a few milliseconds, and any index
 * would need invalidating on every content bundle swap anyway.
 *
 * The module is pure: it takes data, returns results, and knows nothing about React Native
 * or the database.
 */

import type { Lesson, Question } from './types';

/** Shorter queries produce hundreds of hits and add nothing useful. */
export const MIN_QUERY_LENGTH = 3;

/**
 * Where the phrase sits **inside the excerpt** — `[start, end)` in the excerpt's own
 * characters, leading ellipsis included — or null when the excerpt has no match to show
 * (a lesson found only by its title). The card bolds this range; without it the matched
 * word was set exactly like the words around it and had to be found by eye.
 */
export type Mark = readonly [number, number] | null;

export interface QuestionHit {
  kind: 'question';
  question: Question;
  /**
   * Where the phrase sits in the question's own text, which the card shows whole — or null
   * when the match landed in the correct answer or in the legal basis.
   */
  questionMark: Mark;
  /**
   * Where the phrase sits in the correct answer, which the card also shows — or null when
   * it isn't there. With both this and `questionMark` null, the match fell in the legal
   * basis, which the card shows as the link under the answer.
   */
  answerMark: Mark;
}

export interface LessonHit {
  kind: 'lesson';
  lesson: Lesson;
  excerpt: string;
  mark: Mark;
  /**
   * How many matches the lesson can actually highlight. Zero means "the phrase is there,
   * but can't be marked": it falls in the title, or straddles a tag.
   */
  count: number;
}

export type SearchHit = QuestionHit | LessonHit;

/**
 * Map from Polish letters to their diacritic-free equivalents, one character at a time.
 *
 * Deliberately not `normalize('NFD')`: Unicode decomposition changes the string's length,
 * and we need a one-to-one mapping so a match position in the folded text lines up with the
 * position in the original. The highlighting script in the WebView applies the exact same
 * mapping.
 */
export const FOLD: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/**
 * A word character — this is how we tell that a match doesn't start in the middle of a word.
 *
 * This pattern is **shipped from here** into the WebView's highlighting script
 * (`findInPage.ts`), instead of being retyped there. Two copies of this rule would mean the
 * results card could count a match that the lesson can't highlight — the worst possible kind
 * of drift, because both sides would look correct.
 */
export const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Folds text for comparison **while preserving length**: lowercase, no Polish diacritics,
 * but whitespace left untouched.
 *
 * Anything that uses a match position to slice the original text must go through this
 * function, not `normalize` — there, collapsing whitespace throws the indices out of sync.
 */
export function fold(value: string): string {
  let out = '';
  for (const char of value.toLowerCase()) {
    out += FOLD[char] ?? char;
  }
  return out;
}

/**
 * Normalizes a whole string: like `fold`, plus collapsed whitespace.
 * Not suitable for computing a position inside the text.
 */
export function normalize(value: string): string {
  return fold(value).replace(/\s+/g, ' ').trim();
}

/**
 * Turns the entities the scraper writes act content with (`html.escape`) back into
 * characters.
 *
 * Exported because `versions.ts` has to strip them before writing the content into an
 * attribute: double-escaping would show „broń &amp; amunicja" inside the tooltip.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Splits the document's content the same way a browser does: one entry per text node.
 *
 * Needed because the highlighting script searches **inside a single node** — a phrase that
 * straddles a tag ("patentowy <abbr>PZSS</abbr>") is present in the lesson's text but can't
 * be highlighted. Counting matches on the flattened text used to promise hits on the results
 * card that the lesson would then fail to show („1 trafienie" versus „brak trafień").
 *
 * Whitespace stays untouched — the script also sees the raw content of a node, so a phrase
 * split by a line break isn't a match for it and can't be counted. A `<script>` block is
 * replaced with an empty comment rather than removed: the browser splits the surrounding
 * text into two nodes around it either way.
 */
export function textNodes(html: string): string[] {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '<!---->')
    .split(/<[^>]+>/g)
    .map(decodeEntities)
    .filter((node) => node.trim().length > 0);
}

/** The document's plain text, with whitespace collapsed — for excerpts and matching. */
export function stripHtml(html: string): string {
  return textNodes(html)
    .map((node) => node.replace(/\s+/g, ' ').trim())
    .join(' ');
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}

/**
 * The position of a phrase, but only where a word starts — or -1.
 *
 * A plain substring search produced hits inside other words: „bron" (gun) matched „obrona"
 * (defence), which with 656 questions cluttered up the results. Matching from the start of
 * a word still catches inflected forms („broni", „bronią"), since the phrase is a prefix,
 * not a whole word.
 *
 * Deliberately without a regex lookbehind — the Hermes engine's support for it has been
 * unreliable.
 */
export function findAtWordStart(haystack: string, needle: string, from = 0): number {
  if (!needle) return -1;

  let cursor = Math.max(0, from);
  while (cursor <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, cursor);
    if (at < 0) return -1;
    // We check the character before the match in the whole string, not in a slice — that's
    // why searching for further matches moves the cursor instead of slicing the text.
    if (!isWordChar(haystack[at - 1])) return at;
    cursor = at + 1;
  }
  return -1;
}

/** Positions of every match that starts at a word boundary. */
export function findAllAtWordStart(haystack: string, needle: string): number[] {
  const positions: number[] = [];
  if (!needle) return positions;

  let from = 0;
  for (;;) {
    const at = findAtWordStart(haystack, needle, from);
    if (at < 0) break;
    positions.push(at);
    from = at + needle.length;
  }
  return positions;
}

function matches(text: string, needle: string): boolean {
  return findAtWordStart(fold(text), needle) >= 0;
}

/**
 * An excerpt around a known match position, trimmed to word boundaries, plus where the
 * phrase landed in it.
 *
 * It takes a position, not a phrase: the caller has already `fold`-ed the text and found the
 * match, and for acts that folding — 700 KB of it — is the one thing that must not happen
 * again on every keystroke. The mark is recomputed from that position rather than searched
 * for: the excerpt is cut and gets an ellipsis, so `at` in the source text is not `at` in
 * the excerpt. It's a range in the excerpt exactly because `fold` keeps the character count —
 * the matched phrase is as long in the original as in the folded text, so `length` carries
 * over unchanged.
 */
export function markedExcerptAt(
  text: string,
  at: number,
  length: number,
  radius = 60,
): { text: string; mark: Mark } {
  // With no match, only the beginning is left — that's what a lesson found only by its
  // title looks like. The ellipsis is mandatory here: without it, the excerpt read like a
  // paragraph cut off mid-sentence, i.e. like a data bug.
  if (at < 0) {
    const head = text.slice(0, radius * 2).trim();
    return { text: head.length < text.trim().length ? `${head}…` : head, mark: null };
  }

  let start = Math.max(0, at - radius);
  let end = Math.min(text.length, at + length + radius);

  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    // The space has to sit **after the whole phrase**. The condition "after the start of the
    // match" used to pull the end back to a space inside a multi-word phrase, whenever a long
    // word with no space followed right after it — „broni palnej" was left as just „broni",
    // i.e. an excerpt without the very thing that was searched for.
    if (space >= at + length) end = space;
  }

  // `trimEnd()`, not `trim()`: dropping leading whitespace would shift the mark. The slice
  // never starts with whitespace anyway — either at 0 in a text whose whitespace `stripHtml`
  // and `actText` have already collapsed and trimmed, or right after a space found above.
  const body = text.slice(start, end).trimEnd();
  const lead = start > 0 ? '…' : '';
  const excerpt = `${lead}${body}${end < text.length ? '…' : ''}`;
  const from = lead.length + (at - start);
  return { text: excerpt, mark: [from, from + length] };
}

/**
 * What a question is searched by: its text, the correct answer and the legal basis — the
 * three things its result card shows. Wrong answers used to be in here too, and a hit in
 * one of them put the question on the list with nothing on the card to explain why; it also
 * pointed the learner at the very thing not to remember.
 */
function questionHaystack(question: Question): string {
  return [question.question, question.answers[question.correct], question.law]
    .filter(Boolean)
    .join(' ');
}

export function searchQuestions(questions: Question[], query: string): QuestionHit[] {
  const needle = normalize(query);
  if (needle.length < MIN_QUERY_LENGTH) return [];

  const hits: QuestionHit[] = [];
  for (const question of questions) {
    const haystack = questionHaystack(question);
    if (!matches(haystack, needle)) continue;

    // The card shows the question and the correct answer whole, so each gets its own mark
    // rather than an excerpt; a match in the legal basis is visible in the link under them.
    const inQuestion = findAtWordStart(fold(question.question), needle);
    const correct = question.answers[question.correct] ?? '';
    const inAnswer = findAtWordStart(fold(correct), needle);
    hits.push({
      kind: 'question',
      question,
      questionMark: inQuestion >= 0 ? [inQuestion, inQuestion + needle.length] : null,
      answerMark: inAnswer >= 0 ? [inAnswer, inAnswer + needle.length] : null,
    });
  }
  return hits;
}

interface LessonText {
  /** Text with markup stripped — for the excerpt shown on the results card. */
  text: string;
  /** The same text after `fold`, character for character, so positions line up with `text`. */
  folded: string;
  /** Text nodes after `fold` — exactly what the highlighting script scans. */
  nodes: string[];
}

/**
 * Lesson breakdown computed once per lesson object, the same way act texts are cached in
 * `actSearch`.
 *
 * Without this, every keystroke re-ground through 243 KB of HTML: stripping markup and
 * folding Polish diacritics, in a single pass on the search screen. In Node that's ~15 ms;
 * on Hermes it's several times that — i.e. visible keyboard lag.
 *
 * A `WeakMap` keyed on lesson objects is enough: `content.lessons` always returns the same
 * objects, and swapping the bundle creates new ones.
 */
const lessonCache = new WeakMap<Lesson, LessonText>();

export function lessonText(lesson: Lesson): LessonText {
  const known = lessonCache.get(lesson);
  if (known) return known;

  const nodes = textNodes(lesson.html);
  const text = nodes.map((node) => node.replace(/\s+/g, ' ').trim()).join(' ');
  const prepared: LessonText = { text, folded: fold(text), nodes: nodes.map(fold) };
  lessonCache.set(lesson, prepared);
  return prepared;
}

/** Pre-computes the breakdown so the first keystrokes don't wait on 243 KB of HTML. */
export function warmLessonText(lessons: Lesson[]): void {
  for (const lesson of lessons) lessonText(lesson);
}

/**
 * How many matches can actually be **highlighted**, i.e. how many fit entirely within
 * a single node.
 *
 * @param nodes text nodes already passed through `fold`
 */
export function countHighlights(nodes: readonly string[], needle: string): number {
  let total = 0;
  for (const node of nodes) total += findAllAtWordStart(node, needle).length;
  return total;
}

export function searchLessons(lessons: Lesson[], query: string): LessonHit[] {
  const needle = normalize(query);
  if (needle.length < MIN_QUERY_LENGTH) return [];

  const hits: LessonHit[] = [];
  for (const lesson of lessons) {
    const { text, folded, nodes } = lessonText(lesson);
    const at = findAtWordStart(folded, needle);
    // A lesson makes the list even when the phrase only appears in the title, or only
    // straddles a tag: it really is in there, and the excerpt on the card shows it. The
    // match count, though, comes from what the script can actually highlight — the search
    // screen stops offering to step through matches once that count is zero.
    if (at < 0 && !matches(lesson.title, needle)) continue;

    const { text: excerpt, mark } = markedExcerptAt(text, at, needle.length);
    hits.push({
      kind: 'lesson',
      lesson,
      excerpt,
      mark,
      count: countHighlights(nodes, needle),
    });
  }
  // The lesson where the phrase occurs more often is usually the right one.
  return hits.sort((a, b) => b.count - a.count);
}

export interface SearchResults {
  lessons: LessonHit[];
  questions: QuestionHit[];
  /** Total matching questions — the list below is truncated, but the count should be true. */
  questionTotal: number;
  tooShort: boolean;
}

export function search(
  lessons: Lesson[],
  questions: Question[],
  query: string,
  questionLimit = 60,
): SearchResults {
  if (normalize(query).length < MIN_QUERY_LENGTH) {
    return {
      lessons: [],
      questions: [],
      questionTotal: 0,
      tooShort: query.trim().length > 0,
    };
  }

  const questionHits = searchQuestions(questions, query);
  return {
    lessons: searchLessons(lessons, query),
    // A limit on questions: a generic phrase can produce several hundred hits, at which
    // point the list becomes useless and scrolling through all of them gains nothing. The
    // total is returned separately, because „60 w pytaniach" against 458 matches looks like
    // the complete count.
    questions: questionHits.slice(0, questionLimit),
    questionTotal: questionHits.length,
    tooShort: false,
  };
}
