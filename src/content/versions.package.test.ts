import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import type { Act } from './acts';
import { applyVersions } from './versions';

/**
 * A guard against the contract drifting from the bundle — the only place that looks at the
 * real acts.
 *
 * `applyVersions` doesn't throw on an unrecognised marker, because that's a rendering path:
 * a crash there would take out the whole act instead of a single provision. It warns via
 * `console.warn`, which shows up in Metro and in `logcat`, but not in a green `make check`
 * run — and that's exactly the gap this file closes. A marker change on the scraper's side
 * that isn't matched by rebuilding this side is meant to turn this test red.
 *
 * The test **skips itself** when there's no bundle: the whole `assets/content/` directory
 * is outside this repository, because it also carries the course's lesson and question
 * content, not because these particular acts (public law text from the Sejm API, not
 * subject to copyright) are anyone's property. A fresh clone has nothing to check until
 * it runs `make content`.
 */
const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '../../assets/content/acts.json');
const PRESENT = existsSync(BUNDLE);

function acts(): Act[] {
  return JSON.parse(readFileSync(BUNDLE, 'utf8')) as Act[];
}

describe.skipIf(!PRESENT)('the real acts bundle', () => {
  it('every wording marker is recognised by the pattern', () => {
    for (const act of acts()) {
      const openings = act.html.match(/<span[^>]*\bwersja\b[^>]*>/g)?.length ?? 0;
      if (openings === 0) continue;

      // After the transformation, no marker is allowed to remain in the document: each one
      // either disappeared along with the losing rendering, or gave way to content or a link.
      const { html } = applyVersions(act.html, new Date());

      assert.doesNotMatch(html, /class="wersja/, `${act.slug}: unrecognised wording marker`);
    }
  });

  it('every marker carries a Chancellery position stamp', () => {
    // Without `data-poz`, the app can't glue together the pieces of one bracket and doesn't
    // know the pairs — it keeps working, but shows both renderings at once. That's a
    // degraded state, not the intended one.
    for (const act of acts()) {
      const openings = act.html.match(/<span[^>]*\bwersja\b[^>]*>/g) ?? [];

      for (const marker of openings) {
        assert.match(marker, /data-poz="\d+"/, `${act.slug}: marker with no stamp`);
      }
    }
  });
});
