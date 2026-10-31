import type { AnswerOption, Letter, Question } from '../content/types';
import { refersToOtherAnswers } from './answerDraw';

/**
 * A question laid out for reading rather than asking: the correct answer, then the wrong ones.
 *
 * Every wrong answer of the pool is listed, not the three a session happens to draw — this is
 * where someone looks up a question they found, and any of them may come up on the exam.
 *
 * The exception is a correct answer that speaks about the others ("obie odpowiedzi są
 * poprawne", "…są błędne"): whether the two statements it refers to are true is the key's to
 * say, not a mark's — under "both are correct" a ✗ on each would contradict it — and the rest
 * of the pool means nothing to it. Those questions show their stable three, with the two
 * statements unmarked in `referred`.
 */
export interface QuestionSheet {
  correct: AnswerOption;
  wrong: AnswerOption[];
  referred: AnswerOption[];
}

export function questionSheet(question: Question): QuestionSheet {
  const shown = (Object.keys(question.answers) as Letter[]).map((letter) => ({
    id: question.answerIds?.[letter] ?? letter,
    text: question.answers[letter] ?? '',
  }));
  const options = question.options ?? shown;
  const correctId =
    question.correctId ?? question.answerIds?.[question.correct] ?? question.correct;
  const correct = options.find((option) => option.id === correctId) ?? {
    id: correctId,
    text: question.answers[question.correct] ?? '',
  };

  if (refersToOtherAnswers(correct.text)) {
    return { correct, wrong: [], referred: shown.filter((option) => option.id !== correct.id) };
  }
  return { correct, wrong: options.filter((option) => option.id !== correct.id), referred: [] };
}
