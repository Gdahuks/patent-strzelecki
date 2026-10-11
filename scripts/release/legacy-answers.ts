// Writes assets/content/legacy-answers.json from the content copies in the releases directory.
//
// Usage: node scripts/release/legacy-answers.ts <releases dir> <output file>
// Prints the versions it covered. Stops when a release marked as uploaded to Play has no
// content copy — its testers' history would then be migrated against nothing.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildLegacyAnswers, storesLetters, type ShippedBundle } from './legacyAnswers.ts';

const [releasesDir, output] = process.argv.slice(2);
if (!releasesDir || !output) {
  process.stderr.write('usage: legacy-answers.ts <releases dir> <output file>\n');
  process.exit(2);
}

const bundles: ShippedBundle[] = [];
const missing: string[] = [];
const dirs = existsSync(releasesDir)
  ? readdirSync(releasesDir)
      .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
      .sort()
  : [];

for (const tag of dirs) {
  const file = join(releasesDir, tag, 'content', 'content.json');
  if (!existsSync(file)) {
    if (existsSync(join(releasesDir, tag, '.stage', 'uploaded'))) missing.push(tag);
    continue;
  }
  const bundle = JSON.parse(readFileSync(file, 'utf8')) as ShippedBundle;
  if (storesLetters(bundle)) bundles.push(bundle);
}

if (missing.length > 0) {
  process.stderr.write(
    `uploaded release(s) without a content copy: ${missing.join(', ')} — ` +
      "their testers' exam history could not be migrated\n",
  );
  process.exit(1);
}

const table = buildLegacyAnswers(bundles);
writeFileSync(output, JSON.stringify(table));
const versions = Object.keys(table.versions);
process.stdout.write(
  `legacy answers: ${versions.length} version(s) in ${Object.keys(table.tables).length} table(s)` +
    (versions.length ? ` — ${versions.join(', ')}` : '') +
    '\n',
);
