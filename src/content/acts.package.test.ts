import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { type Act, resolveLaw, sourceName } from './acts';

/**
 * The legal-basis affordance checked against **every** basis in the bundle.
 *
 * The rule for picking the label (the target's name, or the word «źródło») rests on words
 * that come from the course — both the rule and the words can change on every scraper run.
 * The tests on made-up acts guard the rule itself; this file guards its **result on real
 * content**, since that's where you can tell whether the label starts repeating what the
 * user is already reading.
 *
 * The test **skips itself** when there's no bundle: the whole `assets/content/` directory
 * is outside this repository, because it also carries the course's lesson and question
 * content, not because these particular acts (public law text from the Sejm API, not
 * subject to copyright) are anyone's property.
 */
const DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../../assets/content');
const PRESENT = existsSync(join(DIRECTORY, 'acts.json')) && existsSync(join(DIRECTORY, 'content.json'));

function acts(): Act[] {
  return JSON.parse(readFileSync(join(DIRECTORY, 'acts.json'), 'utf8')) as Act[];
}

/** Questions' legal bases, deduplicated — one basis is one label to evaluate. */
function bases(): string[] {
  const content = JSON.parse(readFileSync(join(DIRECTORY, 'content.json'), 'utf8')) as {
    questions: { law?: string }[];
  };
  return [...new Set(content.questions.map((q) => (q.law ?? '').trim()).filter(Boolean))];
}

/** Bases pointing at an item with no text in the app, together with the name they get. */
function external(): { law: string; name: string | null }[] {
  const allActs = acts();
  const result: { law: string; name: string | null }[] = [];

  for (const law of bases()) {
    const target = resolveLaw(law, allActs);
    if (!target || target.readable) continue;
    const act = allActs.find((candidate) => candidate.slug === target.slug);
    if (act) result.push({ law, name: sourceName(law, act) });
  }
  return result;
}

describe.skipIf(!PRESENT)('legal-basis affordance against the real bundle', () => {
  it("target's name does not repeat any word from the basis", () => {
    for (const { law, name } of external()) {
      if (!name) continue;

      // The same threshold as in the rule: shorter words would match the start of anything.
      const words = law.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
      for (const word of words) {
        assert.ok(
          !name.toLowerCase().includes(word),
          `„${law}" gets the name „${name}", and both say „${word}"`,
        );
      }
    }
  });

  it("no basis needs the target's name today", () => {
    // The report that started the `sourceName` rule: 46 questions from „Skrócone dane
    // regulaminowych ograniczeń broni" opened the „Przepisy ISSF" card, whose name wasn't
    // in the basis. A label with the target's name was a **patch** for that — the real fix
    // turned out to be giving that basis its own document, since one exists and the course
    // authors themselves publish it (`ograniczenia-broni` in `ACT_SOURCES`).
    //
    // Hence this test, in the other direction: today **every** basis that leads outside the
    // app already carries its target's name, so the rule has nothing to do and every label
    // reads „źródło ↗". That's the intended end state, not a coincidence — and it's frozen
    // here.
    //
    // Red here means: a basis showed up whose card is named differently from what that
    // basis promises. Before trusting the patch (the label with the target's name **works**
    // and stays in the code for exactly this situation), check first whether that document
    // doesn't have its own entry somewhere — the way the weapons-restrictions table did.
    const named = external().filter(({ name }) => name !== null);

    assert.deepEqual(
      named,
      [],
      'a basis opens a card with a different name — check whether this document already has its own entry',
    );
  });
});
