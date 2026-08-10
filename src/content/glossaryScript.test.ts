import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { glossaryScript, withDefinitions } from './glossaryScript';
import type { GlossaryTerm } from './types';

const GLOSSARY: GlossaryTerm[] = [
  { abbr: 'UoBiA', definition: 'Ustawa o Broni i Amunicji', source: 'kurs' },
  { abbr: 'WPA', definition: 'Wydział Postępowań Administracyjnych, dział Policji', source: 'kurs' },
  { abbr: 'PN-EN', definition: 'Polska Norma wdrażająca normę "europejską"', source: 'wlasne' },
];

function abbrTag(term: string): string {
  return `<abbr class="skrot" data-term="${term}">${term}</abbr>`;
}

describe('withDefinitions', () => {
  it('adds the definition to a marked abbreviation', () => {
    const html = withDefinitions(`<p>Zgodnie z ${abbrTag('UoBiA')}.</p>`, GLOSSARY);

    assert.match(html, /data-term="UoBiA" data-def="Ustawa o Broni i Amunicji"/);
  });

  it('handles multiple abbreviations in one lesson', () => {
    const html = withDefinitions(`${abbrTag('UoBiA')} i ${abbrTag('WPA')}`, GLOSSARY);

    assert.equal((html.match(/data-def=/g) ?? []).length, 2);
  });

  it('adds a title attribute so a screen reader reads the definition without a tap', () => {
    // The tooltip opens on tap, and a screen-reader user has no way to discover that gesture.
    // `title` on `<abbr>` is read by VoiceOver and TalkBack on their own.
    const html = withDefinitions(abbrTag('UoBiA'), GLOSSARY);

    assert.match(html, /title="Ustawa o Broni i Amunicji"/);
  });

  it('escapes quotes so they don’t break the attribute', () => {
    const html = withDefinitions(abbrTag('PN-EN'), GLOSSARY);
    const escaped = 'Polska Norma wdrażająca normę &quot;europejską&quot;';

    // Comparing the whole tag, not just fragments of it: a raw quote in the definition would
    // close the attribute, and the rest of the definition would land in the tag as separate
    // attributes of its own — and that's only visible once you look at the tag as a whole.
    assert.equal(
      /<abbr[^>]*>/.exec(html)?.[0],
      `<abbr class="skrot" data-term="PN-EN" data-def="${escaped}" title="${escaped}">`,
    );
  });

  it('skips an abbreviation with no glossary entry', () => {
    // No data-def means the script won't open an empty tooltip.
    const html = withDefinitions(abbrTag('XYZ'), GLOSSARY);

    assert.match(html, /data-term="XYZ"/);
    assert.ok(!html.includes('data-def'));
    assert.ok(!html.includes('title='));
  });

  it('leaves content with no abbreviations untouched', () => {
    const source = '<p>Zwykły akapit.</p><img src="assets/a.jpg"/>';

    assert.equal(withDefinitions(source, GLOSSARY), source);
  });

  it('handles an empty glossary', () => {
    const source = abbrTag('UoBiA');

    assert.equal(withDefinitions(source, []), source);
  });

  it('keeps the marker’s other attributes', () => {
    const html = withDefinitions(abbrTag('UoBiA'), GLOSSARY);

    assert.match(html, /class="skrot"/);
    assert.match(html, />UoBiA<\/abbr>/);
  });
});

describe('glossaryScript', () => {
  it('ends with true, so the WebView doesn’t raise a warning', () => {
    assert.match(glossaryScript().trimEnd(), /true;\s*\}\)\(\);$/);
  });

  it('doesn’t open a tooltip without a definition', () => {
    assert.match(glossaryScript(), /if \(!definition\) return;/);
  });

  it('blocks the click’s default action, to prevent navigation', () => {
    assert.match(glossaryScript(), /event\.preventDefault\(\)/);
  });

  it('contains no backticks', () => {
    // The script is a template literal, so a backtick anywhere — even inside a comment
    // around a function name — closes the string and breaks `tsc`. This came up in the very
    // function being fixed here.
    assert.ok(!glossaryScript().includes(String.fromCharCode(96)));
  });

  it('positions the tooltip relative to the document, not the window', () => {
    // Otherwise the tooltip would drift away from the abbreviation when the page scrolls.
    assert.match(glossaryScript(), /window\.scrollY/);
    assert.match(glossaryScript(), /window\.scrollX/);
  });
});

/**
 * The script goes into the WebView as a string, so we test it against a DOM stub — the same
 * way the link script is tested. The real script text is run, not a copy of it.
 */
function runGlossary() {
  let handler: ((event: unknown) => void) | null = null;
  let children: Record<string, unknown>[] = [];

  const document = {
    body: { appendChild: (el: Record<string, unknown>) => children.push(el) },
    createElement: () => {
      const el: Record<string, unknown> = {
        className: '',
        textContent: '',
        style: {},
        dataset: {},
        offsetWidth: 200,
        remove: () => {
          children = children.filter((other) => other !== el);
        },
      };
      return el;
    },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (type === 'click') handler = fn;
    },
  };
  const window = { scrollX: 0, scrollY: 0, innerWidth: 390, addEventListener: () => {} };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('document', 'window', glossaryScript())(document, window);
  assert.ok(handler, 'the script did not register a listener');

  return {
    dymek: () => children[0],
    click: (target: unknown) => handler!({ target, preventDefault: () => {} }),
  };
}

interface Wezel {
  className: string;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { bottom: number; left: number; width: number };
  closest: (selector: string) => Wezel | null;
}

/** A marker in the content: classes, attributes, and as much geometry as the script reads. */
function marker(className: string, attrs: Record<string, string>) {
  const el: Wezel = {
    className,
    getAttribute: (name) => attrs[name] ?? null,
    getBoundingClientRect: () => ({ bottom: 100, left: 20, width: 40 }),
    closest: (selector) => {
      const klasa = selector.replace(/^[a-z]*\./, '');
      return className.split(' ').includes(klasa) ? el : null;
    },
  };
  return el;
}

describe('tapping a marker in content', () => {
  it('moves the tooltip between markers with the same label', () => {
    // The same label recurs many times in an act: every reference to footnote 1 carries
    // „Przypis 1", and references to one amendment all carry the same date. Comparing by
    // label closed the tooltip instead of moving it.
    const { dymek, click } = runGlossary();
    const pierwszy = marker('skrot przyszle', { 'data-term': 'od 19 maja 2028', 'data-def': 'A' });
    const drugi = marker('skrot przyszle', { 'data-term': 'od 19 maja 2028', 'data-def': 'B' });

    click(pierwszy);
    click(drugi);

    assert.match(String(dymek()?.textContent), /od 19 maja 2028 — B/);
  });

  it('tapping the same marker again closes the tooltip', () => {
    const { dymek, click } = runGlossary();
    const skrot = marker('skrot', { 'data-term': 'UoBiA', 'data-def': 'Ustawa o broni' });

    click(skrot);
    click(skrot);

    assert.equal(dymek(), undefined);
  });

  it('doesn’t open a tooltip on the sheet’s handle', () => {
    // The sheet's handle deliberately doesn't carry the `skrot` class: a tooltip with a whole
    // code article would run off the screen, since `.skrot-dymek` has neither `max-height`
    // nor scrolling.
    const { dymek, click } = runGlossary();

    click(marker('przyszle-arkusz', { 'data-od': '2026-08-23', 'data-przyszle': 'Art. 255b.' }));

    assert.equal(dymek(), undefined);
  });
});
