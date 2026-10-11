// The table of answers from bundles shipped while exam attempts stored letters only.
//
// Until attempts kept answer ids, an attempt recorded the chosen letter, and a letter means
// something only within the bundle it was taken with: the course reshuffles answers on every
// scrape. The first start after an update migrates the history (src/engine/attemptAnswers.ts)
// and needs to know what each letter meant in the bundle the device came from. This builds
// that knowledge from the content copies kept in the releases directory.
//
// Bundles of one scrape carry the same answers under different versions (a change in the
// lessons is enough to change the version), so each distinct table is stored once and the
// versions point at it. Bundles that already carry answer ids (`options`) are skipped — their
// attempts never stored letters.

export type Letter = 'A' | 'B' | 'C';
export type LegacyRow = [string, string, string, Letter];

export interface LegacyAnswers {
  versions: Record<string, string>;
  tables: Record<string, Record<string, LegacyRow>>;
  /** When each version was scraped — an attempt finished earlier was not taken on it. */
  scrapedAt: Record<string, string>;
}

interface ShippedQuestion {
  id: string;
  answers?: Partial<Record<Letter, string>>;
  correct?: Letter;
}

export interface ShippedBundle {
  version: string;
  scrapedAt?: string;
  questions: ShippedQuestion[];
}

/** Whether a bundle is from the letter era — i.e. its attempts need the table. */
export function storesLetters(bundle: ShippedBundle): boolean {
  return bundle.questions.length > 0 && bundle.questions.every((q) => q.answers && q.correct);
}

export function buildLegacyAnswers(bundles: readonly ShippedBundle[]): LegacyAnswers {
  const result: LegacyAnswers = { versions: {}, tables: {}, scrapedAt: {} };
  const keyOf = new Map<string, string>();

  for (const bundle of bundles) {
    if (!storesLetters(bundle) || result.versions[bundle.version]) continue;

    const rows: Record<string, LegacyRow> = {};
    for (const question of [...bundle.questions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const { A = '', B = '', C = '' } = question.answers ?? {};
      rows[question.id] = [A, B, C, question.correct as Letter];
    }

    const serialized = JSON.stringify(rows);
    let key = keyOf.get(serialized);
    if (key === undefined) {
      key = `t${keyOf.size + 1}`;
      keyOf.set(serialized, key);
      result.tables[key] = rows;
    }
    result.versions[bundle.version] = key;
    if (bundle.scrapedAt) result.scrapedAt[bundle.version] = bundle.scrapedAt;
  }
  return result;
}
