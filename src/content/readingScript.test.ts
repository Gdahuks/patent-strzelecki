import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

import { parseReadingSample, readerPosition, readingScript } from './readingScript';

describe('readingScript', () => {
  it('embeds the starting position', () => {
    assert.match(readingScript(0.42), /var start = 0\.42;/);
  });

  it('clamps the position to the 0..1 range', () => {
    assert.match(readingScript(-3), /var start = 0;/);
    assert.match(readingScript(9), /var start = 1;/);
  });

  it('ends with true, so the WebView doesn’t raise a warning', () => {
    assert.match(readingScript(0).trimEnd(), /true;\s*\}\)\(\);$/);
  });

  it('retries restoring the position, since images change the page height', () => {
    const script = readingScript(0.5);

    assert.equal((script.match(/setTimeout\(restore/g) ?? []).length, 2);
  });

  it('doesn’t scroll when there’s nowhere to return to', () => {
    assert.match(readingScript(0), /if \(start > 0\)/);
  });
});

describe('readingScript reports where scrolling stopped', () => {
  it('resets an idle timer on every scroll event', () => {
    // Without this the last sample is whatever the rate limit caught mid-fling — and at the
    // bottom of a lesson no further scroll event ever arrives.
    const script = readingScript(0);

    assert.match(script, /clearTimeout\(idle\)/);
    assert.match(script, /idle = setTimeout\(report, \d+\)/);
  });

  it('reports the viewport height and the page height alongside the position', () => {
    const script = readingScript(0);

    assert.match(script, /view: /);
    assert.match(script, /height: height/);
  });

  it('marks the samples it sends on load as unasked-for', () => {
    // The screen takes the window from them but leaves the position alone, so opening a lesson
    // and closing it straight away leaves no trace.
    const script = readingScript(0);

    assert.match(script, /report\(true\)/);
    assert.match(script, /initial: initial === true/);
  });

  it('reports once at the start, whatever the page height', () => {
    // The tracker needs a window to measure against before the first scroll, and a lesson
    // shorter than the screen never fires a scroll event at all.
    const script = readingScript(0);

    assert.doesNotMatch(script, /scrollHeight <= window\.innerHeight/);
  });
});

describe('parseReadingSample', () => {
  it('reads a well-formed sample', () => {
    assert.deepEqual(
      parseReadingSample('{"type":"scroll","position":0.33,"view":0.2,"height":8000}'),
      { initial: false, position: 0.33, view: 0.2, height: 8000 },
    );
  });

  it('clamps the fractions to range', () => {
    assert.deepEqual(parseReadingSample('{"type":"scroll","position":1.4,"view":3}'), {
      initial: false,
      position: 1,
      view: 1,
      height: 0,
    });
    assert.deepEqual(parseReadingSample('{"type":"scroll","position":-0.2,"view":-1}'), {
      initial: false,
      position: 0,
      view: 0,
      height: 0,
    });
  });

  it('treats a missing viewport height as unknown, not as the whole page', () => {
    assert.deepEqual(parseReadingSample('{"type":"scroll","position":0.5}'), {
      initial: false,
      position: 0.5,
      view: 0,
      height: 0,
    });
  });

  it('treats a missing page height as unknown, so nothing looks like a reflow', () => {
    assert.equal(parseReadingSample('{"type":"scroll","position":0.5,"view":0.1}')?.height, 0);
  });

  it('carries the unasked-for marker through', () => {
    assert.equal(
      parseReadingSample('{"type":"scroll","position":0,"view":0.3,"initial":true}')?.initial,
      true,
    );
  });

  it('ignores a message of another kind', () => {
    assert.equal(parseReadingSample('{"type":"link","href":"x"}'), null);
  });

  it('ignores anything that is not a message', () => {
    assert.equal(parseReadingSample('nonsense'), null);
    assert.equal(parseReadingSample('{"type":"scroll"}'), null);
  });
});

describe('readerPosition', () => {
  const sample = (initial: boolean) =>
    parseReadingSample(
      JSON.stringify({ type: 'scroll', position: 0.4, view: 0.1, height: 5000, initial }),
    );

  it('gives the position of a sample the reader caused', () => {
    assert.equal(readerPosition(sample(false)!), 0.4);
  });

  it('gives nothing for a sample the page sent on load', () => {
    // Both screens save from this: a lesson opened and closed at once leaves no „zaczęte",
    // and an act opened from a legal basis keeps the bookmark the reader left in it.
    assert.equal(readerPosition(sample(true)!), null);
  });

  it('is the only way a screen takes a position from a sample', () => {
    // The act screen once saved `reading.position` straight from every sample while the
    // lesson screen filtered the load-time ones — and the two drifted apart unnoticed. Read
    // as text, since the screens pull in React Native and stay outside vitest's reach.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    for (const file of ['app/act/[slug].tsx', 'app/learn/[slug].tsx']) {
      const source = readFileSync(join(root, file), 'utf8');
      assert.match(source, /readerPosition\(/, file);
      assert.doesNotMatch(source, /reading\.(position|initial)\b/, file);
    }
  });
});
