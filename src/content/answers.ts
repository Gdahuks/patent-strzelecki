/**
 * Answer labels are counted from position on the list, not from the source's own letter.
 *
 * Answer order is shuffled, and the letter in the content bundle describes the variant's
 * position in the course, not its position on screen — which produced sequences like
 * "B, C, A" that read like a bug. The letters are just row labels: first is A, second B,
 * third C.
 *
 * Grading still goes by the source letter, so answer evaluation doesn't change. Wherever a
 * single answer is shown with no list (a flashcard, the question review screen, the exam
 * summary), there is no letter at all — there's nothing on screen for it to refer to.
 */

const LABELS = ['A', 'B', 'C', 'D', 'E'];

export function positionLabel(index: number): string {
  return LABELS[index] ?? String(index + 1);
}
