import { plural } from './plural';

/**
 * What a screen reader says for a row of the practice list.
 *
 * The row is five separate labels plus a bar, so the label turns it into one sentence. It
 * lives here, not in the screen, so its wording can be tested: written inline it read
 * „33 pytań" while the row showed „33 pytania".
 */
export function practiceRowLabel(row: {
  title: string;
  count: number;
  ratio: number;
  needsWork: number;
  learning: number;
  mastered: number;
  untouched: number;
  weak: boolean;
}): string {
  const questions = `${row.count} ${plural(row.count, 'pytanie', 'pytania', 'pytań')}`;
  return (
    `${row.title}. ${questions}${row.weak ? ' z pomyłkami' : ''}, `
    + `${Math.round(row.ratio * 100)} procent. `
    + `Do poprawy ${row.needsWork}, w trakcie ${row.learning}, opanowane ${row.mastered}`
    + (row.weak ? '' : `, nietknięte ${row.untouched}`)
  );
}
