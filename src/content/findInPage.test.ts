import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  MIN_FIND_LENGTH,
  findCommands,
  findHelpersScript,
  findLabel,
  findNeedle,
  parseFindMessage,
} from './findInPage';
import { FOLD, WORD_CHAR } from './search';

describe('parseFindMessage', () => {
  it('reads the search state', () => {
    assert.deepEqual(parseFindMessage('{"type":"find","total":91,"index":3}'), {
      total: 91,
      index: 3,
    });
  });

  it('accepts zero hits', () => {
    assert.deepEqual(parseFindMessage('{"type":"find","total":0,"index":0}'), {
      total: 0,
      index: 0,
    });
  });

  it('is not confused by the scroll message', () => {
    // The same channel also carries the reading position — a mix-up would overwrite the
    // counter.
    assert.equal(parseFindMessage('{"type":"scroll","position":0.4}'), null);
  });

  it('rejects non-numeric values', () => {
    assert.equal(parseFindMessage('{"type":"find","total":"91","index":3}'), null);
    assert.equal(parseFindMessage('{"type":"find","total":91}'), null);
  });

  it('clamps negative values', () => {
    assert.deepEqual(parseFindMessage('{"type":"find","total":-5,"index":-2}'), {
      total: 0,
      index: 0,
    });
  });

  it('does not crash on garbage input', () => {
    assert.equal(parseFindMessage('to nie json'), null);
    assert.equal(parseFindMessage(''), null);
    assert.equal(parseFindMessage('null'), null);
  });
});

describe('findNeedle', () => {
  it('tolerates case and Polish diacritics', () => {
    assert.equal(findNeedle('BROŃ'), 'bron');
  });

  it('tolerates a trailing space in the phrase', () => {
    // The phrase used to go to the page raw, so "broń " (with a trailing space) produced no
    // hits at all, even though "broni" appears in the lesson text.
    assert.equal(findNeedle('broń '), 'bron');
  });

  it('collapses a double space in the middle', () => {
    // The results card showed four lessons, and every one of them said "no hits".
    assert.equal(findNeedle('broń  palna'), 'bron palna');
  });

  it("returns an empty phrase when it's too short", () => {
    assert.equal(findNeedle('br'), '');
    assert.equal(findNeedle('  a '), '');
    assert.equal(findNeedle(''), '');
  });
});

describe('findLabel', () => {
  it('stays silent for an empty phrase', () => {
    assert.equal(findLabel('', null), '');
    assert.equal(findLabel('   ', { total: 5, index: 1 }), '');
  });

  it('hints at the minimum length', () => {
    assert.match(findLabel('br', null), new RegExp(String(MIN_FIND_LENGTH)));
  });

  it('measures length the same way the script does', () => {
    // " ab" has two characters once collapsed, so the script isn't searching yet — but a
    // label computed on `trim` saw three and stayed silent about the threshold. The other
    // way round, "bro ": the script is already searching.
    assert.match(findLabel(' ab', null), new RegExp(String(MIN_FIND_LENGTH)));
    assert.equal(findLabel('bro ', { total: 4, index: 1 }), '1 / 4');
  });

  it('shows the position and the total', () => {
    assert.equal(findLabel('bron', { total: 91, index: 3 }), '3 / 91');
  });

  it('states plainly that there are no hits', () => {
    assert.equal(findLabel('czolg', { total: 0, index: 0 }), 'brak trafień');
  });

  it("waits for the page's response", () => {
    assert.equal(findLabel('bron', null), '…');
  });
});

describe('findCommands', () => {
  it('safely embeds a phrase containing quotes', () => {
    const command = findCommands.run('on "powiedzial" tak');

    assert.ok(command.includes('\\"powiedzial\\"'));
    assert.ok(command.endsWith('true;'));
  });

  it('embeds the phrase normalized, the same way global search matches it', () => {
    assert.ok(findCommands.run('Broń ').includes('"bron"'));
    assert.ok(findCommands.run('broń  palna').includes('"bron palna"'));
  });

  it('turns a too-short phrase into an empty one, i.e. just clearing highlights', () => {
    assert.ok(findCommands.run('br').includes('run("")'));
  });

  it('safely embeds newline characters', () => {
    assert.ok(!findCommands.run('a\nb').includes('\n' + 'b'));
  });

  it('checks the API is present before calling it', () => {
    // The helper script mounts after the page loads; calling it before that must not crash
    // the WebView.
    for (const command of [findCommands.run('x'), findCommands.step(1), findCommands.clear()]) {
      assert.match(command, /window\.__psFind &&/);
    }
  });
});

describe('findHelpersScript', () => {
  const script = findHelpersScript();

  it('ends with the value true', () => {
    assert.match(script.trimEnd(), /true;\s*\}\)\(\);$/);
  });

  it('exposes the whole API used by the native layer', () => {
    for (const method of ['run:', 'step:', 'clear:']) {
      assert.ok(script.includes(method));
    }
  });

  it('skips scripts, styles and hits already marked', () => {
    assert.match(script, /'SCRIPT'/);
    assert.match(script, /'STYLE'/);
    assert.match(script, /'MARK'/);
  });

  it('walks nodes from the end, so as not to invalidate positions', () => {
    assert.match(script, /for \(var h = hits\.length - 1; h >= 0; h--\)/);
  });

  it('takes the Polish-character mapping straight from search.ts', () => {
    // Not "the same kind", but the **exact same one**: the script embeds the map from the
    // module, so there are no two copies that could drift apart.
    assert.ok(script.includes(JSON.stringify(FOLD)));
  });

  it('takes the word-boundary rule straight from search.ts', () => {
    assert.ok(script.includes(WORD_CHAR.toString()));
  });

  it('does not highlight when the phrase is too short', () => {
    assert.ok(script.includes(`needle.length < ${MIN_FIND_LENGTH}`));
  });
});
