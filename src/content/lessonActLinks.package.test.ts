import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { resolveLink } from '../navigation/links';
import type { Act } from './acts';

/**
 * Lesson links to acts the app has offline (`act/<slug>#<unit>`), checked against the real
 * bundle. The scraper rewrites the course's ISAP links into this form; here we check the app's
 * side of that contract — every such link opens an act with text, on a unit that exists.
 *
 * Skips itself when there's no bundle: `assets/content/` is outside this repository.
 */
const DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../../assets/content');
const PRESENT = existsSync(join(DIRECTORY, 'acts.json')) && existsSync(join(DIRECTORY, 'content.json'));

function load(): { hrefs: string[]; acts: Act[]; lessons: Set<string> } {
  const content = JSON.parse(readFileSync(join(DIRECTORY, 'content.json'), 'utf8')) as {
    lessons: { slug: string; html: string }[];
  };
  const acts = JSON.parse(readFileSync(join(DIRECTORY, 'acts.json'), 'utf8')) as Act[];
  const hrefs = content.lessons.flatMap((lesson) =>
    [...lesson.html.matchAll(/href="(act\/[^"]*)"/g)].map((match) => match[1]),
  );
  return { hrefs, acts, lessons: new Set(content.lessons.map((lesson) => lesson.slug)) };
}

describe.skipIf(!PRESENT)('lesson links to bundled acts, against the real bundle', () => {
  it('there are links to rewrite at all', () => {
    // 11 on the November 2026 bundle; far fewer means the scraper stopped recognising them.
    assert.ok(load().hrefs.length >= 8, `${load().hrefs.length} links`);
  });

  it('every link opens an act with text, on a unit the act has', () => {
    const { hrefs, acts, lessons } = load();
    for (const href of hrefs) {
      const target = resolveLink(href, lessons);
      assert.equal(target.kind, 'act', href);
      if (target.kind !== 'act') continue;
      const act = acts.find((candidate) => candidate.slug === target.slug);
      assert.ok(act && act.html, `${href}: no act with text`);
      if (target.ref) {
        assert.ok(act.index.some((entry) => entry.ref === target.ref), `${href}: no such unit`);
      }
    }
  });
});
