/** Shape of the content bundle produced by the scraper (separate private repository). */

export type Letter = 'A' | 'B' | 'C';

/** One answer of a question, with the id the course gives it (`fc-AHash`…). */
export interface AnswerOption {
  id: string;
  text: string;
}

/**
 * A question as the bundle carries it: the correct answer and every wrong one collected.
 *
 * For part of the questions the course keeps more wrong answers than it shows and draws two
 * per showing; the scraper collects the whole pool. Letters are not stored at all — the course
 * reshuffles them on every page load, so they mean nothing across bundles.
 */
export interface BundleQuestion {
  id: string;
  question: string;
  /** In id order. */
  options: AnswerOption[];
  correctId: string;
  law: string;
  lesson: string;
}

/**
 * A question as shown: three answers under letters (`answerDraw.ts`).
 *
 * The pool fields are optional only so that test fixtures can stay three-answer literals;
 * every question coming from the bundle has them.
 */
export interface Question {
  id: string;
  question: string;
  answers: Partial<Record<Letter, string>>;
  correct: Letter;
  /** Legal basis, e.g. "UoBiA art. 4" — shown when discussing a mistake. */
  law: string;
  /** Lesson slug, or an empty string when the question isn't assigned to one. */
  lesson: string;
  /** The id behind each shown letter. */
  answerIds?: Partial<Record<Letter, string>>;
  /** The whole pool, in id order — what a fresh draw picks from. */
  options?: AnswerOption[];
  correctId?: string;
}

export interface Lesson {
  slug: string;
  title: string;
  order: number;
  html: string;
  sets: string[];
}

export interface QuestionSet {
  slug: string;
  title: string;
  questionIds: string[];
}

export interface GlossaryTerm {
  abbr: string;
  definition: string;
  /** "kurs" — from the course's own glossary, "wlasne" — our own addition. */
  source: 'kurs' | 'wlasne';
}

export interface ContentBundle {
  version: string;
  scrapedAt: string;
  source: string;
  lessons: Lesson[];
  sets: QuestionSet[];
  questions: BundleQuestion[];
  glossary: GlossaryTerm[];
  assets: { path: string; sha256: string }[];
}
