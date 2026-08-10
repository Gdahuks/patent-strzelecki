import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { parseScrollMessage, readingScript } from './readingScript';

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

describe('parseScrollMessage', () => {
  it('reads a well-formed message', () => {
    assert.equal(parseScrollMessage('{"type":"scroll","position":0.33}'), 0.33);
  });

  it('clamps the position to range', () => {
    assert.equal(parseScrollMessage('{"type":"scroll","position":1.4}'), 1);
    assert.equal(parseScrollMessage('{"type":"scroll","position":-0.2}'), 0);
  });

  it('rejects a message of an unrelated type', () => {
    assert.equal(parseScrollMessage('{"type":"cokolwiek","position":0.5}'), null);
  });

  it('rejects a missing or non-numeric position', () => {
    assert.equal(parseScrollMessage('{"type":"scroll"}'), null);
    assert.equal(parseScrollMessage('{"type":"scroll","position":"0.5"}'), null);
    assert.equal(parseScrollMessage('{"type":"scroll","position":null}'), null);
  });

  it('rejects NaN', () => {
    assert.equal(parseScrollMessage('{"type":"scroll","position":1e999}'), null);
  });

  it('doesn’t crash on garbage input', () => {
    assert.equal(parseScrollMessage('to nie jest json'), null);
    assert.equal(parseScrollMessage(''), null);
    assert.equal(parseScrollMessage('null'), null);
    assert.equal(parseScrollMessage('[1,2,3]'), null);
  });
});
