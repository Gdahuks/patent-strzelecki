/**
 * Polish plural inflection for a noun, by count.
 *
 * The same rule used to be duplicated in four places (twice in search, twice in the
 * question review) and each copy was hardcoded to one specific noun — so "pytanie"
 * (question), the most common word in this app, had no rule for it at all and every
 * place fell back to a fixed „N pytań". Hence one helper for word forms instead of
 * another copy.
 *
 * The module is pure — no React Native, no database — so it's tested with plain vitest.
 */

/**
 * Form for a given count: 1 → `one`, 2–4 → `few`, everything else → `many`.
 *
 * The 12–14 exception is what this rule is actually built around: the last digit alone
 * isn't enough, because „13 pytań" ends in the same digit as „3 pytania". So the check
 * runs on `n % 100` instead, which also puts 112 and 213 in the genitive form, while 111
 * falls into it separately — through its own last digit of 1.
 *
 * It's not just the noun that inflects: with the genitive form the verb reverts to
 * singular too („2 pytania wrócą" but „5 pytań wróci"), so the verb forms are supplied
 * through the same call.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const last = count % 10;
  const teen = count % 100 >= 12 && count % 100 <= 14;

  if (count === 1) return one;
  if (!teen && last >= 2 && last <= 4) return few;
  return many;
}
