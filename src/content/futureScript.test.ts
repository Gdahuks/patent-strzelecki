import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { futureScript, parseFutureMessage } from './futureScript';

describe('parseFutureMessage', () => {
  it('reads the future wording from the message', () => {
    const wiadomosc = JSON.stringify({ type: 'przyszle', od: '2026-08-23', tresc: 'Art. 255b.' });

    assert.deepEqual(parseFutureMessage(wiadomosc), { from: '2026-08-23', content: 'Art. 255b.' });
  });

  it("is not confused by the screen's other messages", () => {
    assert.equal(parseFutureMessage(JSON.stringify({ type: 'find', total: 3, index: 1 })), null);
    assert.equal(parseFutureMessage(JSON.stringify({ type: 'scroll', position: 0.5 })), null);
  });

  it('rejects a message with no content or no date', () => {
    // An empty sheet looks like a provision deleted for no reason.
    assert.equal(parseFutureMessage(JSON.stringify({ type: 'przyszle', od: '2026-08-23' })), null);
    assert.equal(
      parseFutureMessage(JSON.stringify({ type: 'przyszle', od: '', tresc: 'coś' })),
      null,
    );
    assert.equal(
      parseFutureMessage(JSON.stringify({ type: 'przyszle', od: '2026-08-23', tresc: 12 })),
      null,
    );
  });

  it("does not crash on something that isn't JSON", () => {
    assert.equal(parseFutureMessage('nie-json'), null);
    assert.equal(parseFutureMessage(''), null);
  });
});

describe('futureScript', () => {
  it('contains no backticks', () => {
    // The act stylesheet is one big template literal — a backtick ends the string and
    // breaks `tsc`, and `make ios`/`make android` chain through `tsc`, so the build
    // silently fails to happen and the phone keeps running the previous version.
    assert.ok(!futureScript().includes(String.fromCharCode(96)));
  });

  it("ends with the value true, so WebView doesn't raise a warning", () => {
    assert.match(futureScript().trimEnd(), /true;\s*\}\)\(\);$/);
  });
});

/**
 * The script goes to the WebView as a string, so the only way to check it without a device
 * is to run it against a mock DOM — the same approach used for the link script. We check
 * the script's actual text, not a copy of it.
 */
function runScript() {
  const posted: string[] = [];
  let handler: ((event: unknown) => void) | null = null;

  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      assert.equal(type, 'click');
      handler = fn;
    },
  };
  const window = { ReactNativeWebView: { postMessage: (raw: string) => posted.push(raw) } };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('document', 'window', futureScript())(document, window);
  assert.ok(handler, 'the script did not register a listener');

  return {
    posted,
    click: (target: unknown) => {
      let prevented = false;
      handler!({
        target,
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

interface Wezel {
  className: string;
  parentElement: Wezel | null;
  getAttribute: (name: string) => string | null;
  closest: (selector: string) => Wezel | null;
}

/** A node with classes and attributes, whose `closest` searches up the tree by class. */
function node(className: string, attrs: Record<string, string> = {}, parent: Wezel | null = null) {
  const self: Wezel = {
    className,
    parentElement: parent,
    getAttribute: (name) => attrs[name] ?? null,
    closest: (selector) => {
      const klasa = selector.replace(/^[a-z]*\./, '');
      let current: Wezel | null = self;
      while (current) {
        if (current.className.split(' ').includes(klasa)) return current;
        current = current.parentElement;
      }
      return null;
    },
  };
  return self;
}

describe("tapping the sheet's handle", () => {
  const UCHWYT = { 'data-od': '2026-08-23', 'data-przyszle': 'Art. 255b. Kto czyni.' };

  it('reports the date and content of the new wording', () => {
    const { posted, click } = runScript();

    assert.equal(click(node('przyszle-arkusz', UCHWYT)), true);
    assert.deepEqual(JSON.parse(posted[0]), {
      type: 'przyszle',
      od: '2026-08-23',
      tresc: 'Art. 255b. Kto czyni.',
    });
  });

  it('works for a tap on the label inside the handle', () => {
    const { posted, click } = runScript();

    assert.equal(click(node('', {}, node('przyszle-arkusz', UCHWYT))), true);
    assert.equal(JSON.parse(posted[0]).od, '2026-08-23');
  });

  it('leaves the tooltip alone: an abbreviation, a footnote and a short change stay in the page', () => {
    // The tooltip lives entirely inside the WebView and sends nothing to the native layer.
    const { posted, click } = runScript();

    assert.equal(click(node('skrot przyszle', { 'data-def': 'nowe brzmienie' })), false);
    assert.equal(click(node('skrot przypis', { 'data-def': 'przypis' })), false);
    assert.equal(click(node('pro-text')), false);
    assert.deepEqual(posted, []);
  });
});
