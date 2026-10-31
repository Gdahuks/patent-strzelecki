/**
 * Which three answers a question shows.
 *
 * The course keeps more wrong answers than it shows for part of its questions (110 of 656 in
 * October 2026) and draws two of them on every showing, always next to the correct one. The
 * bundle carries the whole pool; this module does the drawing the course does.
 *
 * Two kinds of view. `defaultView` is stable — the correct answer plus the first two wrong
 * ones by id — for places that show a question without asking it: search, the question
 * browser, counts. `drawAnswers` is what asking does: the practice screen and the exam call it
 * on every showing, so the same question comes back with a different pair of wrong answers,
 * the way it does on the course's site. Letters follow id order within the three; the screens
 * shuffle the display order themselves.
 */

import type { AnswerOption, BundleQuestion, Letter, Question } from '../content/types';

const LETTERS: readonly Letter[] = ['A', 'B', 'C'];
const WRONG_SHOWN = 2;

function view(
  base: Omit<Question, 'answers' | 'correct' | 'answerIds'>,
  shown: readonly AnswerOption[],
  correctId: string,
): Question {
  const ordered = [...shown].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const answers: Partial<Record<Letter, string>> = {};
  const answerIds: Partial<Record<Letter, string>> = {};
  let correct: Letter = 'A';
  ordered.forEach((option, index) => {
    const letter = LETTERS[index];
    answers[letter] = option.text;
    answerIds[letter] = option.id;
    if (option.id === correctId) correct = letter;
  });
  return { ...base, answers, correct, answerIds };
}

export function defaultView(question: BundleQuestion): Question {
  const right = question.options.filter((option) => option.id === question.correctId);
  const wrong = question.options.filter((option) => option.id !== question.correctId);
  return view(
    {
      id: question.id,
      question: question.question,
      law: question.law,
      lesson: question.lesson,
      options: question.options,
      correctId: question.correctId,
    },
    [...right, ...wrong.slice(0, WRONG_SHOWN)],
    question.correctId,
  );
}

/**
 * Whether an answer speaks about the other answers — "obie odpowiedzi są poprawne", "żadna
 * z powyższych", "odpowiedzi A i B…". Matched on "odpowiedzi" or "powyższ…", not on the first
 * word: "wszystkie naboje, bez względu na ich przeznaczenie" is an answer of its own.
 */
const ABOUT_OTHER_ANSWERS =
  /^(obie|obydwie|wszystkie|żadna|żadne)\s+(z\s+)?(powyższ\S*\s+)?(odpowiedzi|powyższ\S*)(?!\S)/i;
const LETTER_PAIR = /^odpowiedzi\s+[a-d]\s+i\s+[a-d](?!\S)/i;

export function refersToOtherAnswers(text: string): boolean {
  const trimmed = text.trim();
  return ABOUT_OTHER_ANSWERS.test(trimmed) || LETTER_PAIR.test(trimmed);
}

/**
 * A fresh pair of wrong answers from the pool — the question itself when there is no choice.
 *
 * Also the question itself when its correct answer speaks about the other two: whether "obie
 * odpowiedzi są poprawne" is true depends on the pair beside it, and the course's pools don't
 * keep that promise — "Przemieszczaniem broni jest" had one in which 4 of 10 pairs made the
 * key false. Its stable view is the pair 0.6.0 showed: with an unloaded and a loaded firearm.
 */
export function drawAnswers(question: Question, random: () => number = Math.random): Question {
  const { options, correctId } = question;
  if (!options || correctId === undefined) return question;

  const correctText = options.find((option) => option.id === correctId)?.text;
  if (correctText !== undefined && refersToOtherAnswers(correctText)) return question;

  const wrong = options.filter((option) => option.id !== correctId);
  if (wrong.length <= WRONG_SHOWN) return question;

  const pool = [...wrong];
  const picked: AnswerOption[] = [];
  for (let n = 0; n < WRONG_SHOWN; n++) {
    const index = Math.min(Math.floor(random() * pool.length), pool.length - 1);
    picked.push(...pool.splice(index, 1));
  }
  const right = options.filter((option) => option.id === correctId);
  return view(question, [...right, ...picked], correctId);
}
