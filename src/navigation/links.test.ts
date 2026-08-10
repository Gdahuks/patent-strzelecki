import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { fileUrlToHref, isSameDocument, resolveLink, routeFor } from './links';

const LESSONS = new Set([
  'uobia',
  'pzss',
  'bezpieczenstwo',
  'budowa-broni',
  'obrona-konieczna',
  'patent-egzamin',
]);

function resolve(href: string) {
  return resolveLink(href, LESSONS);
}

describe('resolveLink — lessons', () => {
  it('recognises a link to another lesson', () => {
    assert.deepEqual(resolve('/pzss'), { kind: 'lesson', slug: 'pzss' });
  });

  it('strips slashes at the edges', () => {
    assert.deepEqual(resolve('/uobia/'), { kind: 'lesson', slug: 'uobia' });
  });

  it('trims the anchor off a lesson address', () => {
    assert.deepEqual(resolve('/uobia#gora'), { kind: 'lesson', slug: 'uobia' });
  });
});

describe('resolveLink — practice', () => {
  it('recognises a quiz', () => {
    assert.deepEqual(resolve('/testy/uobia'), { kind: 'test', sets: ['uobia'] });
  });

  it('recognises flashcards', () => {
    assert.deepEqual(resolve('/fiszki/prawo-karne'), {
      kind: 'flashcards',
      sets: ['prawo-karne'],
    });
  });

  it('splits a compound set into its parts', () => {
    assert.deepEqual(resolve('/testy/rozp-noszenie,reg-strzelnicy,rozp-transport'), {
      kind: 'test',
      sets: ['rozp-noszenie', 'reg-strzelnicy', 'rozp-transport'],
    });
  });

  it('skips empty members in a compound set', () => {
    assert.deepEqual(resolve('/fiszki/uobia,,pzss'), {
      kind: 'flashcards',
      sets: ['uobia', 'pzss'],
    });
  });
});

describe('resolveLink — native screens', () => {
  it('maps the table of contents', () => {
    assert.deepEqual(resolve('/spis-tresci'), { kind: 'contents' });
    assert.deepEqual(resolve('/spis-tresci#spis'), { kind: 'contents' });
  });

  it('maps practice and the exam', () => {
    assert.deepEqual(resolve('/cwiczenia'), { kind: 'exercises' });
    assert.deepEqual(resolve('/konto'), { kind: 'exam' });
  });

  it('treats the root as the table of contents', () => {
    assert.deepEqual(resolve('/'), { kind: 'contents' });
    assert.deepEqual(resolve(''), { kind: 'contents' });
  });
});

describe('resolveLink — assets and anchors', () => {
  it('recognises an image rewritten by the scraper', () => {
    assert.deepEqual(resolve('assets/glock_19_budowa.jpg'), {
      kind: 'image',
      name: 'glock_19_budowa.jpg',
    });
  });

  it('recognises an image written from the root', () => {
    // "/assets/x.jpg" points at the same file as "assets/x.jpg", but used to fall through
    // to the browser as an unknown course sub-page.
    assert.deepEqual(resolve('/assets/glock_19_budowa.jpg'), {
      kind: 'image',
      name: 'glock_19_budowa.jpg',
    });
  });

  it('trims the anchor and query parameters off an image name', () => {
    assert.deepEqual(resolve('assets/schemat.png?v=2#gora'), {
      kind: 'image',
      name: 'schemat.png',
    });
  });

  it('recognises an anchor within a lesson', () => {
    assert.deepEqual(resolve('#przypisy'), { kind: 'anchor', id: 'przypisy' });
  });
});

describe('resolveLink — hardening', () => {
  it("does not reach for an object's inherited properties", () => {
    // The route table used to be a plain object literal, so "/toString" returned a
    // function, and "/__proto__" — the prototype itself. There are no such paths in the
    // bundle today, but it's one course content change away from a crash.
    assert.equal(resolve('/toString').kind, 'external');
    assert.equal(resolve('/__proto__').kind, 'external');
    assert.equal(resolve('/constructor').kind, 'external');
    assert.equal(resolve('/hasOwnProperty').kind, 'external');
  });

  it('sends a schemeless address out to the browser', () => {
    // "//cdn.example.com/a.js" gets completed by the browser with the page's own scheme;
    // here the "page" is a file, so without this the address carried on as a path on the
    // course site.
    assert.deepEqual(resolve('//cdn.example.com/a.js'), {
      kind: 'external',
      url: 'https://cdn.example.com/a.js',
    });
  });

  it("strips query parameters off a set's path", () => {
    // Without this, the set's slug read "uobia?utm=1" and the practice screen came up empty.
    assert.deepEqual(resolve('/testy/uobia?utm=1'), { kind: 'test', sets: ['uobia'] });
    assert.deepEqual(resolve('/uobia?utm=1'), { kind: 'lesson', slug: 'uobia' });
  });

  it('keeps query parameters on an external address', () => {
    assert.deepEqual(resolve('/nowa-lekcja-2027?utm=1'), {
      kind: 'external',
      url: 'https://patentstrzelecki.eu/nowa-lekcja-2027?utm=1',
    });
  });
});

describe('resolveLink — external', () => {
  it('sends out http(s) addresses', () => {
    assert.deepEqual(resolve('https://isap.sejm.gov.pl/x'), {
      kind: 'external',
      url: 'https://isap.sejm.gov.pl/x',
    });
  });

  it('sends out other schemes', () => {
    assert.equal(resolve('mailto:kontakt@example.com').kind, 'external');
    assert.equal(resolve('tel:+48123456789').kind, 'external');
  });

  it('sends out course PDFs that are not in the bundle', () => {
    assert.deepEqual(resolve('https://patentstrzelecki.eu/ui/docs/zasady.pdf'), {
      kind: 'external',
      url: 'https://patentstrzelecki.eu/ui/docs/zasady.pdf',
    });
  });

  it('routes an unknown internal path to the course site', () => {
    // The course may have added a sub-page after the bundle was last updated — better to
    // open it in the browser than show an empty screen.
    assert.deepEqual(resolve('/nowa-lekcja-2027'), {
      kind: 'external',
      url: 'https://patentstrzelecki.eu/nowa-lekcja-2027',
    });
  });

  it('does not confuse an unknown lesson with a known one', () => {
    assert.equal(resolveLink('/pzss', new Set()).kind, 'external');
  });
});

describe('fileUrlToHref', () => {
  const DIR = '/var/mobile/Containers/Data/Application/ABC/Documents/tresc';

  it("reduces a root link to the site's path", () => {
    // "/pzss" inside a file:// document resolves to the filesystem root, not to the
    // content directory.
    assert.equal(fileUrlToHref('file:///pzss', DIR), '/pzss');
  });

  it("reduces a relative link to an asset's path", () => {
    assert.equal(
      fileUrlToHref(`file://${DIR}/assets/glock_19_budowa.jpg`, DIR),
      'assets/glock_19_budowa.jpg',
    );
  });

  it('decodes escaped characters in the address', () => {
    assert.equal(fileUrlToHref(`file://${DIR}/assets/tabela%20ograniczen.jpg`, DIR), 'assets/tabela ograniczen.jpg');
  });

  it('tolerates a trailing slash in the base directory', () => {
    assert.equal(fileUrlToHref(`file://${DIR}/assets/a.jpg`, `${DIR}/`), 'assets/a.jpg');
  });

  it('accepts a base directory given as file://', () => {
    assert.equal(fileUrlToHref(`file://${DIR}/assets/a.jpg`, `file://${DIR}`), 'assets/a.jpg');
  });

  it('leaves addresses outside the file scheme untouched', () => {
    assert.equal(fileUrlToHref('https://isap.sejm.gov.pl/x', DIR), 'https://isap.sejm.gov.pl/x');
  });

  it('does not throw on an address that cannot be decoded', () => {
    // A literal percent sign in a filename is an invalid escape sequence, and `decodeURI`
    // throws a URIError — it used to escape from the WebView's navigation-guard callback
    // instead of a decision being returned.
    assert.doesNotThrow(() => fileUrlToHref(`file://${DIR}/100%.html`, DIR));
    assert.equal(fileUrlToHref(`file://${DIR}/100%.html`, DIR), '100%.html');
  });

  it('composes with resolveLink into a full route', () => {
    assert.deepEqual(resolve(fileUrlToHref('file:///testy/uobia', DIR)), {
      kind: 'test',
      sets: ['uobia'],
    });
    assert.deepEqual(resolve(fileUrlToHref(`file://${DIR}/assets/schemat.png`, DIR)), {
      kind: 'image',
      name: 'schemat.png',
    });
  });
});

describe('isSameDocument', () => {
  const URI = 'file:///Documents/tresc/uobia.html';

  it('recognises loading the same lesson', () => {
    assert.equal(isSameDocument(URI, URI), true);
  });

  it('recognises a jump to an anchor within the lesson', () => {
    assert.equal(isSameDocument(`${URI}#przypisy`, URI), true);
  });

  it('rejects a different lesson', () => {
    assert.equal(isSameDocument('file:///Documents/tresc/pzss.html', URI), false);
  });
});

describe('routeFor', () => {
  it('builds screen paths', () => {
    assert.equal(routeFor({ kind: 'lesson', slug: 'uobia' }), '/learn/uobia');
    assert.equal(routeFor({ kind: 'test', sets: ['uobia'] }), '/practice/test/uobia');
    assert.equal(routeFor({ kind: 'contents' }), '/');
    assert.equal(routeFor({ kind: 'exam' }), '/exam');
  });

  it('joins a compound set back into one parameter', () => {
    assert.equal(
      routeFor({ kind: 'flashcards', sets: ['a', 'b'] }),
      '/practice/flashcards/a,b',
    );
  });

  it('has no route for targets handled differently', () => {
    assert.equal(routeFor({ kind: 'external', url: 'https://x' }), null);
    assert.equal(routeFor({ kind: 'image', name: 'a.jpg' }), null);
    assert.equal(routeFor({ kind: 'anchor', id: 'x' }), null);
  });
});
