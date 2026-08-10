/**
 * User settings — persisted, alongside learning progress.
 *
 * The rules themselves — allowed values and labels — live in `engine/settingsValues.ts`,
 * so they can be tested without `expo-sqlite`. What's left here is just database access,
 * and the re-export exists so screens don't need to know about that split.
 */

import { type Settings, parseLevels } from '../engine/settingsValues';
import { db } from './database';

export { levelsLabel } from '../engine/settingsValues';
export type { Settings } from '../engine/settingsValues';

export async function loadSettings(): Promise<Settings> {
  const database = await db();
  // Text size isn't here and never had anywhere to be saved: it follows the system
  // setting, so it isn't app state. The old `fontScale` entry from when it was one is
  // left untouched in the table — deleting someone else's data during an update is worse
  // than a row nobody reads.
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'levels'",
  );

  return {
    levels: parseLevels(row?.value),
  };
}

export async function saveLevels(levels: number): Promise<void> {
  const database = await db();
  await database.runAsync(
    `INSERT INTO settings (key, value) VALUES ('levels', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(levels)],
  );
}

