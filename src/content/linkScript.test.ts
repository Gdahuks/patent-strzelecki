import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { linkClickScript, parseLinkMessage } from './linkScript';

describe('parseLinkMessage', () => {
  it('reads the link from a click message', () => {
    assert.equal(parseLinkMessage(JSON.stringify({ type: 'link', href: '/pzss' })), '/pzss');
  });

  it('isn’t confused by a scroll or find message', () => {
    assert.equal(parseLinkMessage(JSON.stringify({ type: 'scroll', position: 0.5 })), null);
    assert.equal(parseLinkMessage(JSON.stringify({ type: 'find', total: 3, index: 1 })), null);
  });

  it('rejects an empty link and a wrong type', () => {
    assert.equal(parseLinkMessage(JSON.stringify({ type: 'link', href: '' })), null);
    assert.equal(parseLinkMessage(JSON.stringify({ type: 'link', href: 12 })), null);
    assert.equal(parseLinkMessage(JSON.stringify({ type: 'link' })), null);
  });

  it('doesn’t crash on something that isn’t JSON', () => {
    assert.equal(parseLinkMessage('nie-json'), null);
    assert.equal(parseLinkMessage(''), null);
  });
});

describe('linkClickScript', () => {
  it('listens in the capture phase, before the default navigation', () => {
    assert.match(linkClickScript(), /addEventListener\('click'[\s\S]*, true\)/);
  });

  it('doesn’t stop propagation, so an abbreviation tooltip has time to close', () => {
    // The word itself appears in a comment inside the script, so we search for a call instead.
    assert.doesNotMatch(linkClickScript(), /stopPropagation\(/);
  });
});

/**
 * The script goes into the WebView as a string, so the only way to check it without a
 * device is running it against a DOM stub. The real script text is run, not a copy of it.
 */
function runScript() {
  const posted: string[] = [];
  let handler: ((event: unknown) => void) | null = null;

  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void, capture: boolean) => {
      assert.equal(type, 'click');
      assert.equal(capture, true);
      handler = fn;
    },
  };
  const window = { ReactNativeWebView: { postMessage: (raw: string) => posted.push(raw) } };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('document', 'window', linkClickScript())(document, window);
  assert.ok(handler, 'the script did not register a listener');

  return { posted, click: (target: unknown) => {
    let prevented = false;
    handler!({ target, preventDefault: () => { prevented = true; } });
    return prevented;
  } };
}

/** A node like in the DOM: `tagName`, `parentElement`, `getAttribute`. */
function node(tagName: string, href?: string, parent?: unknown) {
  return {
    tagName,
    parentElement: parent ?? null,
    getAttribute: (name: string) => (name === 'href' && href !== undefined ? href : null),
  };
}

describe('listening for clicks in content', () => {
  it('forwards the raw root-relative link, not a file:// address', () => {
    const { posted, click } = runScript();
    assert.equal(click(node('A', '/pzss')), true);
    assert.deepEqual(JSON.parse(posted[0]), { type: 'link', href: '/pzss' });
  });

  it('works for a click on a link’s content, not just the link itself', () => {
    const { posted, click } = runScript();
    const link = node('A', '/testy/uobia');
    assert.equal(click(node('SPAN', undefined, link)), true);
    assert.deepEqual(JSON.parse(posted[0]), { type: 'link', href: '/testy/uobia' });
  });

  it('lets an anchor through: the browser handles in-page scrolling', () => {
    const { posted, click } = runScript();
    assert.equal(click(node('A', '#rozdzial-2')), false);
    assert.deepEqual(posted, []);
  });

  it('doesn’t react to a click outside a link', () => {
    const { posted, click } = runScript();
    assert.equal(click(node('P', undefined, node('DIV'))), false);
    assert.equal(click(node('ABBR', undefined)), false);
    assert.deepEqual(posted, []);
  });

  it('skips a link with no href, since there’s nothing to open', () => {
    const { posted, click } = runScript();
    assert.equal(click(node('A')), false);
    assert.deepEqual(posted, []);
  });
});
