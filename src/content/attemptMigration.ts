/**
 * One-time migration of exam answers stored as letters only — the disk-facing half of
 * `engine/attemptAnswers.ts`, where the reasons are.
 *
 * Runs on start, **before** `materializeContent`: the stamp that tells which bundle the device
 * came from is the one materialization overwrites. Idempotent — answers that already carry
 * their text are skipped — so after the first start it reads the history and writes nothing.
 */

import { rewriteAttemptAnswers } from '../db/database';
import {
  type LegacyAnswers,
  type Lookup,
  migrateAnswers,
  notBeforeOf,
  tableFor,
} from '../engine/attemptAnswers';
import { materializedVersion } from './materialize';
import { content } from './store';

/**
 * Answers of the bundles shipped before attempts kept ids, loaded lazily — it is only needed
 * once. Generated next to the content bundle (`make legacy-answers`); like the bundle, it is
 * course content and stays out of the repository.
 */
function legacyAnswers(): LegacyAnswers {
  return require('../../assets/content/legacy-answers.json') as LegacyAnswers;
}

let running: Promise<number> | null = null;

/** Rewrites the history once per app start; later calls share the first one's result. */
export function migrateAttemptAnswers(): Promise<number> {
  running ??= (async () => {
    const version = materializedVersion();
    // Loaded on the first attempt that needs it: once the history is migrated, a start reads
    // the attempts and never touches the 150 KB table.
    let loaded: { lookup: Lookup | null; notBefore: number | null } | null = null;
    const findId = (questionId: string, text: string) => content.optionIdByText(questionId, text);

    return rewriteAttemptAnswers((answers, finishedAt) => {
      if (answers.every((answer) => answer.chosenText !== undefined)) {
        return { answers, changed: false };
      }
      if (loaded === null) {
        const legacy = legacyAnswers();
        loaded = { lookup: tableFor(version, legacy), notBefore: notBeforeOf(version, legacy) };
      }
      const takenEarlier = loaded.notBefore !== null && finishedAt < loaded.notBefore;
      return migrateAnswers(answers, takenEarlier ? null : loaded.lookup, findId);
    });
  })().catch((cause: unknown) => {
    // A failed run must be retried on the next attempt, not replayed from memory.
    running = null;
    throw cause;
  });
  return running;
}
