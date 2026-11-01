import { plural } from './plural';

/**
 * Counts of the bundle's contents as they appear in running text.
 *
 * The screens used to write „{n} pytań" with the noun fixed in place, which reads right only
 * while the bundle holds a number that takes the genitive plural. A content refresh that
 * lands on 652 or 654 produced „652 pytań". These go through `plural` instead, in the two
 * cases the screens need: nominative („jest 652 pytania") and genitive after a noun
 * („treść 652 pytań").
 */
export function questionCount(n: number): string {
  return `${n} ${plural(n, 'pytanie', 'pytania', 'pytań')}`;
}

/** „treść 1 pytania", „treść 652 pytań" — the genitive has no separate few-form. */
export function questionCountGenitive(n: number): string {
  return `${n} ${plural(n, 'pytania', 'pytań', 'pytań')}`;
}

export function lessonCount(n: number): string {
  return `${n} ${plural(n, 'lekcja', 'lekcje', 'lekcji')}`;
}

export function setCount(n: number): string {
  return `${n} ${plural(n, 'zestaw', 'zestawy', 'zestawów')}`;
}
