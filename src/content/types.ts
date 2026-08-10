/** Shape of the content bundle produced by the scraper (separate private repository). */

export type Letter = 'A' | 'B' | 'C';

export interface Question {
  id: string;
  question: string;
  answers: Partial<Record<Letter, string>>;
  correct: Letter;
  /** Legal basis, e.g. "UoBiA art. 4" — shown when discussing a mistake. */
  law: string;
  /** Lesson slug, or an empty string when the question isn't assigned to one. */
  lesson: string;
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
  questions: Question[];
  glossary: GlossaryTerm[];
  assets: { path: string; sha256: string }[];
}
